// sw.js — stratégie par type de ressource : coquille offline + faible bande
// passante (contexte réseau lent en falaise) :
// - sous-ressources locales (CSS, JS) + data.geojson + routes/<id>.json :
//   PRÉ-CACHÉES à l'install puis servies en stale-while-revalidate — l'app
//   démarre sans attendre le réseau (réponse cache immédiate), tout en se
//   rafraîchissant en arrière-plan à chaque visite (voir repondreEnRevalidant) ;
// - navigations (pages HTML) : réseau d'abord avec repli cache — indispensable
//   avec un serveur de dev qui transforme le HTML (Vite et ses html-proxy),
//   et l'offline sert le HTML déjà vu ;
// - fond de carte (cross-origin OpenFreeMap) : cache d'abord — les tuiles
//   sont versionnées (immuables) : une fois vues, plus aucun octet réseau aux
//   visites suivantes (le principal gain de bande passante du site). Le style
//   seul suit stale-while-revalidate (voir le fetch handler).
// Bump CACHE_NAME pour forcer un renouvellement IMMÉDIAT (utile pour un
// correctif urgent) — plus une obligation à chaque déploiement de routine
// depuis que toute la coquille locale passe en stale-while-revalidate (voir
// repondreEnRevalidant plus bas) : un simple cache-first sans revalidation
// la servait indéfiniment tant que CACHE_NAME ne changeait pas, ce qui a
// fini par arriver (plusieurs vagues de JS/CSS déployées sans y penser —
// bug réel constaté : les visiteurs déjà passés ne recevaient plus AUCUNE
// mise à jour tant qu'ils ne vidaient pas leur cache à la main).
const CACHE_NAME = 'sorties-escalade-v6';

// Coquille pré-cachée à l'install. Liste manuelle : une entrée par dossier
// sortie/ (page + data.geojson). maplibre-gl reste servi par le CDN (voir
// README — le build ESM 6.4.1 ne charge pas ses tuiles en same-origin) mais
// ses 4 fichiers sont PRÉ-CACHÉS ici : l'offline de la lib est garanti dès
// l'install, sans dépendre du réseau. Les routes/<id>.json (détail des
// voies) sont pré-cachées DYNAMIQUEMENT à l'install (voir precacherRoutes) :
// l'histogramme d'une fiche sort du cache instantanément, sans aller-retour
// réseau, même à la première ouverture (contexte faible réseau). Elles
// restent servies en stale-while-revalidate par la suite (mise à jour en
// arrière-plan).
const PRECACHE = [
  './',
  './index.html',
  './assets/style.css',
  './assets/style-carte.css',
  './assets/js/carte.js',
  './assets/js/carte-utils.js',
  './assets/js/donnees.js',
  './assets/js/labels.js',
  './assets/js/marqueurs.js',
  './assets/js/popups.js',
  './assets/js/symboles.js',
  './assets/js/utils.js',
  // maplibre-gl (CDN, pré-caché pour l'offline) :
  'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl-shared.mjs',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl-worker.mjs',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.css',
  // Style du fond de carte (OpenFreeMap) : pré-caché pour charger sans
  // attendre le réseau à la 1re ouverture. Les tuiles ne sont PAS pré-cachées
  // (leurs URLs dépendent du modèle du jour) : mises en cache au fil des vues.
  'https://tiles.openfreemap.org/styles/positron',
  // Sorties (une entrée par dossier) :
  './sorties/2026-10-drome-saou/index.html',
  './sorties/2026-10-drome-saou/data.geojson',
];

// Pré-cache du détail des voies (routes/<slug-site>.json, un fichier par
// SITE — plusieurs falaises dedans) de chaque sortie, à l'install.
// L'histogramme d'une fiche est chargé à la demande à l'ouverture de la
// popup (voir marqueurs.js) : sans ce pré-cache, sa première ouverture
// déclenche un aller-retour réseau — ~2 Ko en moyenne, mais une LATENCE
// pleine sur réseau faible (le motif exact du "ça met du temps à afficher la
// dataviz"). Le total d'une sortie est négligeable (~170 Ko) : on pré-cache
// donc tout à l'install, et la dataviz sort du cache instantanément (même
// hors-ligne). Les identifiants sont lus depuis data.geojson (déjà dans
// PRECACHE) : pas de liste à maintenir — chaque nouveau dossier sortie/ est
// pris en compte automatiquement.
function precacherRoutes() {
  const sorties = PRECACHE.filter((u) => u.endsWith('/data.geojson'));
  return Promise.allSettled(
    sorties.map((dataUrl) => {
      const abs = new URL(dataUrl, self.location.href).href;
      return caches.match(abs)
        .then((reponse) => (reponse ? reponse.json() : null))
        .then((geo) => {
          if (!geo || !geo.features) return;
          const base = abs.slice(0, abs.lastIndexOf('/') + 1);
          // new Set(...) : plusieurs falaises d'un même site partagent
          // désormais la même URL routes/<slug>.json — sans dédup, ce fichier
          // serait mis en cache une fois par falaise plutôt qu'une fois.
          const urls = [...new Set(
            geo.features
              .filter((f) => f.properties && f.properties.categorie === 'falaise' && f.properties.routes)
              .map((f) => base + 'routes/' + f.properties.routes + '.json')
          )];
          if (!urls.length) return;
          // allSettled : un fichier manquant (404) ne fait pas échouer le
          // pré-cache des autres.
          return caches.open(CACHE_NAME).then((cache) =>
            Promise.allSettled(urls.map((u) => cache.add(u)))
          );
        });
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => precacherRoutes())
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Ne met en cache que les réponses réellement exploitables : response.ok
// exclut les erreurs (404/500...) — une erreur transitoire ne doit pas rester
// servie hors-ligne jusqu'au prochain succès réseau. response.type ===
// 'opaque' est nécessaire EN PLUS (pas à la place) : une ressource
// cross-origin chargée sans CORS (ex. tuiles OpenFreeMap) a un statut
// toujours à 0 et .ok toujours à false alors qu'elle est bien exploitable —
// l'exclure casserait son cache hors-ligne.
function reponseCachable(response) {
  return response.ok || response.type === 'opaque';
}

// Renvoie une promesse qui se résout une fois la tentative de mise en cache
// terminée (jamais rejetée) : le fetch handler s'en sert à la fois pour son
// event.waitUntil (garder le service worker vivant jusqu'à l'écriture
// réelle, pas juste jusqu'à l'appel de cache.open) et pour renvoyer la
// réponse une fois cette écriture lancée.
function mettreEnCache(request, response) {
  if (!reponseCachable(response)) return Promise.resolve();
  const copie = response.clone();
  return caches.open(CACHE_NAME).then((cache) => cache.put(request, copie));
}

// Sert le cache immédiatement (latence nulle, hors-ligne inclus) tout en
// rafraîchissant en arrière-plan pour la PROCHAINE visite — même mécanique
// pour 3 catégories de ressources (coquille locale, données, style du fond
// de carte, voir le fetch handler plus bas), qui ne diffèrent que par CE QUI
// déclenche cette stratégie, jamais par son comportement. Factorisé ici
// plutôt que dupliqué 3 fois : avant, seules data.geojson/routes en
// bénéficiaient — la coquille locale (JS/CSS) restait en cache-first PUR,
// sans jamais se rafraîchir tant que CACHE_NAME n'était pas bumpé à la main
// (oubli constaté en pratique : des visiteurs déjà passés ne recevaient plus
// aucune mise à jour de code tant qu'ils ne vidaient pas leur cache).
function repondreEnRevalidant(event) {
  // cache: 'no-cache' force la revalidation reseau (avec le serveur, pas
  // avec le cache HTTP du navigateur) : sans ça, le HTTP cache du navigateur
  // (Cache-Control/heuristique sur Last-Modified — GitHub Pages en envoie)
  // peut renvoyer une reponse deja obsolete sans le moindre aller-retour
  // reseau, ce qui annulerait le rafraichissement voulu ici.
  const rafraichir = fetch(event.request, { cache: 'no-cache' })
    .then((reponse) => mettreEnCache(event.request, reponse).then(() => reponse))
    .catch(() => null);
  event.waitUntil(rafraichir);
  event.respondWith(
    caches.match(event.request).then((enCache) => enCache || rafraichir)
  );
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Ressources locales (coquille + données) : c'est ici que l'offline est
  // garanti — rien à attendre du réseau pour faire tourner l'app.
  if (url.origin === location.origin) {
    // Navigation (chargement d'une page HTML) : réseau d'abord avec repli
    // cache. Un cache-first casserait un serveur de dev qui transforme le
    // HTML en vol (ex. Vite et ses proxies html-proxy — erreur "No matching
    // HTML proxy module") en lui renvoyant un HTML périmé ; en offline, le
    // cache sert le HTML déjà vu.
    if (event.request.mode === 'navigate') {
      event.respondWith(
        fetch(event.request)
          .then((reponse) => mettreEnCache(event.request, reponse).then(() => reponse))
          .catch(() => caches.match(event.request))
      );
      return;
    }
    // Données ET reste de la coquille (CSS, JS, maplibre local) :
    // stale-while-revalidate pour les deux (voir repondreEnRevalidant) — la
    // coquille suivait avant un cache-first PUR, sans jamais se rafraîchir
    // tant que CACHE_NAME n'était pas bumpé à la main (voir le commentaire
    // sur CACHE_NAME en tête de fichier pour le pourquoi de ce changement).
    repondreEnRevalidant(event);
    return;
  }

  // Ressources cross-origin (fond de carte OpenFreeMap : tuiles, style,
  // glyphes, sprites) : cache d'abord — l'objectif est de minimiser la bande
  // passante (contexte faible réseau), et ces ressources sont versionnées :
  // les URL de tuiles embarquent le numéro de modèle (immuables), les
  // glyphes/sprites sont statiques. Une fois en cache, plus aucun octet
  // réseau pour le fond aux visites suivantes. Repli réseau si pas encore en
  // cache (1re vue).
  if (!url.pathname.includes('/styles/')) {
    // Tuiles / glyphes / sprites : PURE cache-first — immutables, pas de
    // revalidation en arrière-plan (ça re-téléchargerait tout le fond à
    // chaque visite, à l'encontre de l'objectif bande passante).
    event.respondWith(
      caches.match(event.request).then((enCache) =>
        enCache || fetch(event.request).then((response) => mettreEnCache(event.request, response).then(() => response))
      )
    );
    return;
  }
  // Style : stale-while-revalidate (petit fichier, il porte le modèle
  // courant du fond) — l'affichage ne bloque pas, et les tuiles du nouveau
  // modèle seront téléchargées aux prochaines visites.
  repondreEnRevalidant(event);
});
