/**
 * Hybrid Cache System - localStorage + IndexedDB
 *
 * Automatically routes small items to localStorage and large items to IndexedDB.
 * This solves the localStorage quota issue for large datasets like the table list.
 *
 * Architecture:
 * - Small items (<1MB): localStorage (fast, synchronous)
 * - Large items (≥1MB): IndexedDB (large quota, asynchronous)
 * - Automatic fallback if IndexedDB is unavailable
 */

/**
 * IndexedDB wrapper for large cache items
 */
class IndexedDBCache {
  constructor(dbName = 'ssb_cache', storeName = 'cache') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
    this.isAvailable = false;
  }

  /**
   * Initialize IndexedDB connection
   */
  async init() {
    if (this.db) return true;

    try {
      return await new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 1);

        request.onerror = () => {
          logger.error('[IndexedDBCache] Failed to open database:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.isAvailable = true;
          logger.log('[IndexedDBCache] Database opened successfully');
          resolve(true);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
            logger.log('[IndexedDBCache] Object store created');
          }
        };
      });
    } catch (error) {
      logger.error('[IndexedDBCache] Initialization failed:', error);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Store a value in IndexedDB
   */
  async set(key, value, ttlMs) {
    if (!this.isAvailable) {
      await this.init();
      if (!this.isAvailable) {
        throw new Error('IndexedDB not available');
      }
    }

    return new Promise((resolve, reject) => {
      try {
        const item = {
          value: value,
          expires: Date.now() + ttlMs,
          stored: Date.now()
        };

        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(item, key);

        request.onsuccess = () => {
          logger.log('[IndexedDBCache] Stored: ' + key + ' (TTL: ' + Math.round(ttlMs / 1000 / 60) + ' minutes)');
          resolve();
        };

        request.onerror = () => {
          logger.error('[IndexedDBCache] Failed to store:', key, request.error);
          reject(request.error);
        };
      } catch (error) {
        logger.error('[IndexedDBCache] Store error:', error);
        reject(error);
      }
    });
  }

  /**
   * Retrieve the raw cache entry (with stored/expires metadata) from IndexedDB.
   * Returns the full item object or null.
   */
  async _getRaw(key) {
    if (!this.isAvailable) {
      await this.init();
      if (!this.isAvailable) return null;
    }

    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch (error) {
        resolve(null);
      }
    });
  }

  /**
   * Retrieve a value from IndexedDB
   */
  async get(key) {
    if (!this.isAvailable) {
      await this.init();
      if (!this.isAvailable) {
        return null;
      }
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = () => {
          const item = request.result;

          if (!item) {
            resolve(null);
            return;
          }

          // Check if expired
          if (Date.now() > item.expires) {
            logger.log('[IndexedDBCache] Expired: ' + key);
            this.delete(key); // Don't await, fire and forget
            resolve(null);
            return;
          }

          const age = Math.round((Date.now() - item.stored) / 1000 / 60);
          logger.log('[IndexedDBCache] Hit: ' + key + ' (age: ' + age + ' minutes)');
          resolve(item.value);
        };

        request.onerror = () => {
          logger.error('[IndexedDBCache] Failed to retrieve:', key, request.error);
          resolve(null); // Return null on error, don't break the app
        };
      } catch (error) {
        logger.error('[IndexedDBCache] Get error:', error);
        resolve(null);
      }
    });
  }

  /**
   * Delete a specific cache entry
   */
  async delete(key) {
    if (!this.isAvailable) return;

    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);

        request.onsuccess = () => {
          logger.log('[IndexedDBCache] Deleted: ' + key);
          resolve();
        };

        request.onerror = () => {
          logger.error('[IndexedDBCache] Failed to delete:', key, request.error);
          resolve(); // Don't throw
        };
      } catch (error) {
        logger.error('[IndexedDBCache] Delete error:', error);
        resolve();
      }
    });
  }

  /**
   * Clear all cache entries
   */
  async clear() {
    if (!this.isAvailable) return;

    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.clear();

        request.onsuccess = () => {
          logger.log('[IndexedDBCache] Cleared all entries');
          resolve();
        };

        request.onerror = () => {
          logger.error('[IndexedDBCache] Failed to clear:', request.error);
          resolve();
        };
      } catch (error) {
        logger.error('[IndexedDBCache] Clear error:', error);
        resolve();
      }
    });
  }
}

/**
 * Hybrid CacheManager - Automatically routes to localStorage or IndexedDB
 */
class CacheManager {
  constructor(prefix = 'ssb_') {
    this.prefix = prefix;
    this.indexedDBCache = new IndexedDBCache('ssb_cache', 'cache');
    this.largeSizeThreshold = 1024 * 1024; // 1MB threshold
    this._initPromise = this.indexedDBCache.init();
    this._lastSSBUpdate = null; // cached result of _getLastSSBUpdateTimestamp()
    this._lastSSBUpdateCheckedAt = 0;
  }

  /**
   * Get the UTC timestamp of the most recent SSB metadata update.
   * SSB updates metadata at the times defined in AppConfig.ssbUpdateTimes
   * (Norwegian time / Europe/Oslo). Result is cached for 60 seconds.
   */
  _getLastSSBUpdateTimestamp() {
    // Cache the result for 60 seconds to avoid recalculating on every get()
    if (this._lastSSBUpdate && (Date.now() - this._lastSSBUpdateCheckedAt) < 60000) {
      return this._lastSSBUpdate;
    }

    const now = new Date();
    const updateTimes = (typeof AppConfig !== 'undefined' && AppConfig.ssbUpdateTimes)
      ? AppConfig.ssbUpdateTimes
      : [{ hour: 5, minute: 0 }, { hour: 11, minute: 30 }];

    // Calculate offset between UTC and Norwegian time (handles DST automatically)
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const norwayDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
    const offsetMs = norwayDate - utcDate;

    // Current time shifted to Norwegian civil time (use UTC methods to read)
    const norwayNow = new Date(now.getTime() + offsetMs);
    const currentMinutes = norwayNow.getUTCHours() * 60 + norwayNow.getUTCMinutes();

    // Sort update times descending (latest first)
    const sorted = [...updateTimes].sort((a, b) => (b.hour * 60 + b.minute) - (a.hour * 60 + a.minute));

    // Find the most recent update that has already occurred
    for (let daysBack = 0; daysBack <= 1; daysBack++) {
      for (const { hour, minute } of sorted) {
        const updateMinutes = hour * 60 + minute;
        if (daysBack === 0 && updateMinutes > currentMinutes) continue;

        // Construct the timestamp in "Norwegian UTC" then convert to real UTC
        const updateNorway = new Date(norwayNow);
        updateNorway.setUTCDate(updateNorway.getUTCDate() - daysBack);
        updateNorway.setUTCHours(hour, minute, 0, 0);
        const result = updateNorway.getTime() - offsetMs;

        this._lastSSBUpdate = result;
        this._lastSSBUpdateCheckedAt = Date.now();
        return result;
      }
    }

    return 0;
  }

  /**
   * Check if a cache entry is stale because SSB has updated since it was stored.
   */
  _isStaleBySSBSchedule(storedTimestamp) {
    const lastUpdate = this._getLastSSBUpdateTimestamp();
    return storedTimestamp < lastUpdate;
  }

  /**
   * Store a value in cache with automatic storage selection
   * @param {string} key - Cache key
   * @param {any} value - Value to store
   * @param {number} ttlMs - Time-to-live in milliseconds
   */
  async set(key, value, ttlMs) {
    try {
      const item = {
        value: value,
        expires: Date.now() + ttlMs,
        stored: Date.now()
      };

      const serialized = JSON.stringify(item);
      const sizeBytes = serialized.length;
      const sizeKB = Math.round(sizeBytes / 1024);

      // Decide which storage to use based on size
      if (sizeBytes >= this.largeSizeThreshold) {
        logger.log('[Cache] Large item (' + sizeKB + ' KB): ' + key + ' - using IndexedDB');

        try {
          // Ensure IndexedDB is initialized
          await this._initPromise;
          await this.indexedDBCache.set(key, value, ttlMs);

          // Store a reference in localStorage so we know it's in IndexedDB
          try {
            localStorage.setItem(
              this.prefix + key + '_ref',
              JSON.stringify({ storage: 'indexeddb', size: sizeKB })
            );
          } catch (e) {
            // Ignore localStorage errors for references
          }

          return;
        } catch (error) {
          logger.warn('[Cache] IndexedDB storage failed, item will not be cached:', key);
          return;
        }
      }

      // Small item - use localStorage
      try {
        localStorage.setItem(
          this.prefix + key,
          serialized
        );

        logger.log('[Cache] Stored: ' + key + ' (' + sizeKB + ' KB, TTL: ' + Math.round(ttlMs / 1000 / 60) + ' minutes)');
      } catch (error) {
        // Handle QuotaExceededError
        if (error.name === 'QuotaExceededError' || error.code === 22) {
          logger.warn('[Cache] localStorage quota exceeded for: ' + key);
          logger.warn('[Cache] Attempting cleanup and retry...');

          // Try to free up space
          const removed = this.cleanup();

          if (removed > 0) {
            // Retry once
            try {
              localStorage.setItem(this.prefix + key, serialized);
              logger.log('[Cache] Stored after cleanup: ' + key);
              return;
            } catch (retryError) {
              logger.warn('[Cache] Still unable to cache after cleanup: ' + key);
            }
          }

          // Try IndexedDB as fallback
          logger.log('[Cache] Falling back to IndexedDB for: ' + key);
          try {
            await this._initPromise;
            await this.indexedDBCache.set(key, value, ttlMs);
            localStorage.setItem(
              this.prefix + key + '_ref',
              JSON.stringify({ storage: 'indexeddb', size: sizeKB })
            );
            logger.log('[Cache] Stored in IndexedDB (fallback): ' + key);
          } catch (idbError) {
            logger.warn('[Cache] Both localStorage and IndexedDB failed for: ' + key);
          }
        } else {
          logger.error('[Cache] Failed to store item:', key, error);
        }
      }
    } catch (error) {
      logger.error('[Cache] Unexpected error in set():', key, error);
    }
  }

  /**
   * Retrieve a value from cache (checks both localStorage and IndexedDB)
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} - Cached value or null if not found/expired
   */
  async get(key) {
    try {
      // Check if there's a reference indicating IndexedDB storage
      const refKey = this.prefix + key + '_ref';
      const ref = localStorage.getItem(refKey);

      if (ref) {
        try {
          const refData = JSON.parse(ref);
          if (refData.storage === 'indexeddb') {
            // Item is in IndexedDB
            await this._initPromise;

            // Peek at the stored timestamp to check SSB schedule staleness
            const item = await this.indexedDBCache._getRaw(key);
            if (item && item.stored && this._isStaleBySSBSchedule(item.stored)) {
              logger.log('[Cache] Stale (SSB updated since stored): ' + key + ' (IndexedDB)');
              localStorage.removeItem(refKey);
              await this.indexedDBCache.delete(key);
              return null;
            }

            const value = await this.indexedDBCache.get(key);

            if (!value) {
              // Item not found or expired, clean up reference
              localStorage.removeItem(refKey);
            }

            return value;
          }
        } catch (e) {
          // Invalid reference, clean it up
          localStorage.removeItem(refKey);
        }
      }

      // Try localStorage
      const itemStr = localStorage.getItem(this.prefix + key);
      if (!itemStr) {
        return null;
      }

      const item = JSON.parse(itemStr);

      // Check if expired
      if (Date.now() > item.expires) {
        logger.log('[Cache] Expired: ' + key);
        this.delete(key);
        return null;
      }

      // Check if stale due to SSB metadata update
      if (item.stored && this._isStaleBySSBSchedule(item.stored)) {
        logger.log('[Cache] Stale (SSB updated since stored): ' + key);
        this.delete(key);
        return null;
      }

      const age = Math.round((Date.now() - item.stored) / 1000 / 60);
      logger.log('[Cache] Hit: ' + key + ' (age: ' + age + ' minutes)');
      return item.value;

    } catch (error) {
      logger.error('[Cache] Failed to retrieve item:', key, error);
      this.delete(key); // Clear corrupted cache entry
      return null;
    }
  }

  /**
   * Delete a specific cache entry (from both storages)
   * @param {string} key - Cache key
   */
  async delete(key) {
    try {
      // Remove from localStorage
      localStorage.removeItem(this.prefix + key);

      // Check if it's in IndexedDB
      const refKey = this.prefix + key + '_ref';
      const ref = localStorage.getItem(refKey);

      if (ref) {
        localStorage.removeItem(refKey);

        try {
          const refData = JSON.parse(ref);
          if (refData.storage === 'indexeddb') {
            await this._initPromise;
            await this.indexedDBCache.delete(key);
          }
        } catch (e) {
          // Ignore errors
        }
      }

      logger.log('[Cache] Deleted: ' + key);
    } catch (error) {
      logger.error('[Cache] Failed to delete item:', key, error);
    }
  }

  /**
   * Clear all cache entries (both storages)
   */
  async clear() {
    try {
      // Clear localStorage
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith(this.prefix));

      keys.forEach(k => localStorage.removeItem(k));
      logger.log('[Cache] Cleared ' + keys.length + ' localStorage items');

      // Clear IndexedDB
      await this._initPromise;
      await this.indexedDBCache.clear();
    } catch (error) {
      logger.error('[Cache] Failed to clear cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    try {
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith(this.prefix) && !k.endsWith('_ref'));

      let totalSize = 0;
      let validCount = 0;
      let expiredCount = 0;
      let indexedDBCount = 0;

      keys.forEach(k => {
        const itemStr = localStorage.getItem(k);
        totalSize += itemStr.length;

        try {
          const item = JSON.parse(itemStr);
          if (Date.now() > item.expires) {
            expiredCount++;
          } else {
            validCount++;
          }
        } catch (e) {
          expiredCount++;
        }
      });

      // Count IndexedDB references
      const refKeys = Object.keys(localStorage)
        .filter(k => k.startsWith(this.prefix) && k.endsWith('_ref'));
      indexedDBCount = refKeys.length;

      return {
        localStorage: {
          totalEntries: keys.length,
          validEntries: validCount,
          expiredEntries: expiredCount,
          totalSizeKB: Math.round(totalSize / 1024)
        },
        indexedDB: {
          entriesCount: indexedDBCount,
          isAvailable: this.indexedDBCache.isAvailable
        }
      };
    } catch (error) {
      logger.error('[Cache] Failed to get stats:', error);
      return null;
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    try {
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith(this.prefix) && !k.endsWith('_ref'));

      let removedCount = 0;

      keys.forEach(k => {
        try {
          const itemStr = localStorage.getItem(k);
          const item = JSON.parse(itemStr);

          if (Date.now() > item.expires) {
            localStorage.removeItem(k);
            removedCount++;
          }
        } catch (e) {
          // Remove corrupted entries
          localStorage.removeItem(k);
          removedCount++;
        }
      });

      // Clean up orphaned references
      const refKeys = Object.keys(localStorage)
        .filter(k => k.startsWith(this.prefix) && k.endsWith('_ref'));

      refKeys.forEach(k => {
        try {
          const ref = JSON.parse(localStorage.getItem(k));
          // Could verify if the IndexedDB entry exists, but skip for now
        } catch (e) {
          localStorage.removeItem(k);
          removedCount++;
        }
      });

      logger.log('[Cache] Cleanup removed ' + removedCount + ' expired entries');
      return removedCount;
    } catch (error) {
      logger.error('[Cache] Failed to cleanup:', error);
      return 0;
    }
  }
}

// Make CacheManager available globally
window.CacheManager = CacheManager;
