/**
 * Dialog - delt skall for appens modale vinduer.
 *
 * Alle dialoger deler CSS-chromet i css/main.css (.dialog-overlay/
 * .dialog-container/.dialog-header/.dialog-close/.dialog-content/
 * .dialog-footer). Denne filen eier oppførselen som hørte til det chromet, og
 * som tidligere var kopiert per dialog: fjern gammel instans, bygg, ESC,
 * bakgrunnsklikk, opprydding.
 *
 * Tilgjengelighet ligger her ett sted: role/aria-modal/aria-labelledby på
 * containeren og aria-label på lukkeknappen.
 *
 * Innholdet (`bodyHtml`/`footerHtml`) settes inn som RÅ HTML — kalleren har
 * ansvar for escapeHtml() på alt som stammer fra API-data. `title` escapes her.
 *
 * Et hvilket som helst element i dialogen med `data-dialog-close` lukker den
 * (delegert), så avbryt-knapper i footeren ikke trenger egen lytter.
 *
 * Krever js/utils.js (addEscapeHandler, escapeHtml) og js/translations.js.
 */

/**
 * Åpne en modal dialog.
 * @param {Object} options
 * @param {string} options.id - DOM-id på overlayet (unik per dialogtype)
 * @param {string} options.title - Overskrift (escapes)
 * @param {string} [options.bodyHtml] - Innhold i .dialog-content (rå HTML)
 * @param {string} [options.footerHtml] - Innhold i .dialog-footer (rå HTML);
 *                 utelates footeren helt når tom
 * @param {string} [options.maxWidth] - Overstyrer .dialog-container sin
 *                 standardbredde, f.eks. '800px'
 * @param {string} [options.className] - Ekstra klasse(r) på containeren
 * @param {Function} [options.onClose] - Kalles etter at dialogen er lukket
 * @returns {{dialog: HTMLElement, close: Function}}
 */
function openDialog({ id, title, bodyHtml = '', footerHtml = '', maxWidth = '', className = '', onClose = null }) {
  // En allerede åpen instans av samme dialog erstattes (dobbeltklikk på en
  // åpneknapp skal ikke stable overlays oppå hverandre).
  document.getElementById(id)?.remove();

  const titleId = `${id}-title`;
  const containerClass = className ? `dialog-container ${className}` : 'dialog-container';
  const styleAttr = maxWidth ? ` style="max-width: ${escapeHtml(maxWidth)};"` : '';

  const html = `
    <div class="dialog-overlay" id="${escapeHtml(id)}">
      <div class="${escapeHtml(containerClass)}" role="dialog" aria-modal="true"
           aria-labelledby="${escapeHtml(titleId)}"${styleAttr}>
        <div class="dialog-header">
          <h3 id="${escapeHtml(titleId)}">${escapeHtml(title)}</h3>
          <button class="dialog-close" type="button" data-dialog-close
                  aria-label="${escapeHtml(t('dialog.close'))}">&times;</button>
        </div>
        <div class="dialog-content">${bodyHtml}</div>
        ${footerHtml ? `<div class="dialog-footer">${footerHtml}</div>` : ''}
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  const dialog = document.getElementById(id);
  let removeEscape = null;
  let closed = false;

  const close = () => {
    if (closed) return; // close() kan nås både via ESC, knapp og kaller
    closed = true;
    if (removeEscape) { removeEscape(); removeEscape = null; }
    dialog.remove();
    if (typeof onClose === 'function') onClose();
  };

  removeEscape = addEscapeHandler(close);

  // Delegert, så knapper som legges inn ved senere re-rendring av innholdet
  // fortsatt lukker dialogen.
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-dialog-close]')) close();
  });

  // Lukk kun når mousedown OG click begge traff selve overlayet — hindrer
  // utilsiktet lukking når man drar for å markere tekst inne i dialogen og
  // slipper museknappen utenfor.
  let mouseDownOnOverlay = false;
  dialog.addEventListener('mousedown', (e) => {
    mouseDownOnOverlay = e.target === dialog;
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && mouseDownOnOverlay) close();
  });

  return { dialog, close };
}
