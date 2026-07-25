/**
 * Minimal statisk filserver for E2E-kjøringene — Statistikkportalen.
 *
 * HVORFOR: appen er laget for å kunne åpnes rett fra disk (file://), og den
 * modusen testes eksplisitt. Men produksjon serveres over http, og noen ting
 * oppfører seg bare riktig der: History API-ruting, relative stier fra
 * forhåndsrendrede undersider, og cross-origin-regler som ikke gjelder for
 * origin 'null'. Røyktesten kjører derfor i begge modi.
 *
 * node:http holder — å dra inn http-server/serve ville vært den eneste
 * npm-avhengigheten i repoet utover playwright-core.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HELPER_DIR, '..', '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

/**
 * Starter en server på en ledig port (0 = OS velger, så parallelle
 * testfiler ikke kolliderer).
 *
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function serve({ root = REPO_ROOT } = {}) {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';

    // Stopp sti-traversering ut av rota.
    const target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(target, (err, body) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 ${pathname}`);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        // Ingen caching: testene bytter innhold mellom kjøringer.
        'Cache-Control': 'no-store'
      });
      res.end(body);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
