// sw-client.js — enregistrement du service worker, côté page.
//
// Extrait des deux <script> inline qui vivaient dans index.html et dans
// chaque page sortie : ils portaient la MÊME logique dupliquée, et surtout
// du code inline interdit toute CSP stricte (il aurait fallu autoriser
// 'unsafe-inline' pour les scripts, ce qui vide la protection de son sens,
// ou maintenir des hachages à la main — intenable sans étape de build).

// Vite transforme les fichiers à la volée : un service worker qui sert des
// ressources déjà transformées d'une session précédente (HTML avec
// html-proxy, modules réécrits) casse le chargement. On le détecte par la
// présence de /@vite/client, injecté par Vite dans chaque page, et on
// désenregistre alors tout SW résiduel. En production (GitHub Pages) ou
// derrière un serveur statique simple, l'enregistrement se fait normalement.
function servieParVite() {
  return Array.from(document.querySelectorAll('script[src]'))
    .some((s) => (s.getAttribute('src') || '').includes('/@vite/'));
}

export function enregistrerServiceWorker(chemin, options) {
  if (!('serviceWorker' in navigator)) return;
  if (servieParVite()) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()));
    return;
  }
  navigator.serviceWorker.register(chemin, options);
}
