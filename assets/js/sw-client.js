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
  navigator.serviceWorker.register(chemin, options).then((registration) => {
    // Le navigateur ne revérifie sw.js que de temps en temps de lui-même
    // (mécanisme interne, hors du contrôle de cette page) : sans cet appel,
    // une mise à jour déployée pouvait mettre longtemps à être détectée,
    // même en rechargeant normalement (pas un hard refresh). skipWaiting +
    // clients.claim (déjà dans sw.js) prennent le relais dès que le
    // navigateur DÉTECTE la nouvelle version ; il ne restait qu'à
    // déclencher cette détection plus tôt, pas à changer ce qui se passe
    // une fois détectée.
    registration.update();
    // Revérifie aussi au retour sur l'onglet : ce site se prépare parfois la
    // veille et se rouvre plusieurs jours après, au pied d'une falaise —
    // sans ça, un déploiement survenu entre-temps n'était détecté qu'à la
    // prochaine fermeture/réouverture complète du navigateur.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update();
    });
  });
}
