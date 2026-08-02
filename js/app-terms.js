/**
 * App terms - «Kilder og vilkår»-dialogen bak footer-lenken.
 *
 * Innholdet er tredelt: ansvarsfraskrivelse, kildehenvisningsplikt og en
 * lisensliste. Lisenslisten HARDKODES IKKE — den bygges fra
 * listSourceBrandings() (js/utils.js), samme kilde som footeren brukte før,
 * slik at en kilde som aktiveres i AppConfig.sources dukker opp av seg selv med
 * riktig navn, hjemmeside og lisens.
 *
 * En kilde uten licenseName/licenseUrl vises uten lisensetikett (det er en
 * bevisst konfigurasjonsbeslutning per kilde, ikke en feil her).
 *
 * Krever js/utils.js (listSourceBrandings, escapeHtml), js/translations.js og
 * js/dialog.js.
 */

/** Én linje i lisenslisten: navn (lenket til kilden) + evt. lisens. */
function termsSourceLineHTML(src) {
  const name = escapeHtml(src.nameFull || src.name || src.url || '');
  let html = src.url
    ? `<a href="${escapeHtml(src.url)}" target="_blank" rel="noopener noreferrer">${name}</a>`
    : name;

  if (src.licenseName && src.licenseUrl) {
    html += ` — <a href="${escapeHtml(src.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.licenseName)}</a>`;
  } else if (src.licenseName) {
    html += ` — ${escapeHtml(src.licenseName)}`;
  }
  return html;
}

/**
 * Åpne «Kilder og vilkår»-dialogen.
 * Bevisst ikke URL-adresserbar — den er et vedlegg til footeren, ikke en rute.
 */
function showTermsDialog() {
  const sourceItems = listSourceBrandings()
    .map(src => `<li>${termsSourceLineHTML(src)}</li>`)
    .join('');

  const bodyHtml = `
    <div class="terms-section">
      <h4>${escapeHtml(t('terms.liabilityHeading'))}</h4>
      <p>${escapeHtml(t('terms.liabilityBody'))}</p>
    </div>

    <div class="terms-section">
      <h4>${escapeHtml(t('terms.attributionHeading'))}</h4>
      <p>${escapeHtml(t('terms.attributionBody'))}</p>
    </div>

    <div class="terms-section">
      <h4>${escapeHtml(t('terms.sourcesHeading'))}</h4>
      <ul class="terms-source-list">${sourceItems}</ul>
    </div>
  `;

  openDialog({
    id: 'terms-dialog',
    title: t('terms.title'),
    maxWidth: '560px',
    bodyHtml
  });
}
