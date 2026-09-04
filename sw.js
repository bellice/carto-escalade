// sw.js — une stratégie par type de ressource, pour tenir sur réseau lent :
// - CSS/JS locaux, data.geojson, routes/*.json : pré-cachés à l'install puis
//   stale-while-revalidate — démarrage sans attendre le réseau, rafraîchi en
//   arrière-plan ;
// - navigations HTML : réseau d'abord, repli cache — indispensable avec un
//   serveur de dev qui transforme le HTML (Vite) ;
// - fond de carte OpenFreeMap : cache d'abord, les tuiles étant versionnées
//   donc immuables. C'est le principal gain de bande passante du site.
// Bumper CACHE_NAME force un renouvellement IMMÉDIAT (correctif urgent), mais
// n'est plus obligatoire à chaque déploiement depuis le passage en
// stale-while-revalidate.
const CACHE_PREFIXE = 'sorties-escalade-v';
// v7 : ajout des modules hors-ligne.js, sw-client.js et demarrer-*.js à la
// coquille. Un nouveau module ne peut PAS attendre le rafraîchissement
// paresseux — s'il n'est pas pré-caché, le premier chargement hors ligne
// échoue à l'import et fait tomber toute la carte (constaté en test). C'est
// le cas type qui justifie encore un bump.
const CACHE_NAME = `${CACHE_PREFIXE}8`;

// Cache SÉPARÉ du fond de carte, à ne surtout pas fusionner avec la coquille :
// il n'est pas versionné par CACHE_NAME, sans quoi bumper la coquille pour
// livrer du code effacerait une zone pré-chargée avant une sortie.
const CACHE_TUILES = 'sorties-escalade-tuiles-v1';

// Liste MANUELLE : une entrée par dossier sortie/ (page + data.geojson) — un
// oubli casse le hors-ligne de cette sortie, en silence. maplibre-gl vient du
// CDN mais ses 4 fichiers sont pré-cachés ici, sans quoi la lib dépendrait du
// réseau. Les routes/*.json, elles, sont ajoutées dynamiquement (precacherRoutes).
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/style.css',
  './assets/style-carte.css',
  './assets/js/carte.js',
  './assets/js/actions-fiche.js',
  './assets/js/carte-utils.js',
  './assets/js/demarrer-accueil.js',
  './assets/js/demarrer-sortie.js',
  './assets/js/donnees.js',
  './assets/js/hors-ligne.js',
  './assets/js/labels.js',
  './assets/js/sw-client.js',
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
  './vallee-drome-diois/index.html',
  './vallee-drome-diois/data.geojson',
  './presquile-crozon/index.html',
  './presquile-crozon/data.geojson',
];

// Sans ce pré-cache, la première ouverture d'une fiche paie une latence
// réseau pleine pour ~2 Ko — très visible sur réseau faible. Le total d'une
// sortie est négligeable (~170 Ko), autant tout prendre à l'install.
// Les identifiants viennent de data.geojson : aucune liste à maintenir.
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

// Le ménage à l'activation ne touche QUE les anciennes versions de la
// coquille (préfixe CACHE_PREFIXE). Avant, il supprimait tout cache dont le
// nom différait de CACHE_NAME — donc aussi les tuiles du fond, qui vivaient
// dans le même cache : bumper la version pour livrer une correction de code
// effaçait au passage la zone que l'utilisateur avait pré-chargée avant de
// partir. Un déploiement de routine ne doit jamais coûter la préparation
// hors-ligne de quelqu'un.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIXE) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
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

// Promesse jamais rejetée, résolue après l'écriture RÉELLE : le waitUntil du
// fetch handler doit garder le worker vivant jusque-là, pas seulement jusqu'à
// l'appel de cache.open.
// Seules les tuiles, glyphes et sprites vont dans CACHE_TUILES ; le style JSON
// reste avec la coquille, dont il partage le cycle de vie.
function cachePour(request) {
  const url = new URL(request.url);
  const estFondDeCarte = url.hostname === 'tiles.openfreemap.org'
    && !url.pathname.startsWith('/styles/');
  return estFondDeCarte ? CACHE_TUILES : CACHE_NAME;
}

function mettreEnCache(request, response) {
  if (!reponseCachable(response)) return Promise.resolve();
  const copie = response.clone();
  return caches.open(cachePour(request)).then((cache) => cache.put(request, copie));
}

// Sert le cache immédiatement, rafraîchit en arrière-plan pour la PROCHAINE
// visite. Couvre coquille locale, données et style du fond : sans ça, un
// cache-first pur servait le code indéfiniment tant que CACHE_NAME n'était
// pas bumpé — des visiteurs ne recevaient plus aucune mise à jour.
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
    // Le repli tente aussi index.html : les liens du site pointent vers des
    // RÉPERTOIRES (/sorties/x/) alors que PRECACHE contient des fichiers
    // (/sorties/x/index.html). Sans cette seconde tentative, la clé de cache
    // ne correspond pas et la page est introuvable hors ligne — alors qu'elle
    // est bel et bien en cache. Générique : couvre chaque future sortie.
    if (event.request.mode === 'navigate') {
      event.respondWith(
        fetch(event.request)
          .then((reponse) => mettreEnCache(event.request, reponse).then(() => reponse))
          .catch(() => caches.match(event.request)
            .then((r) => r || caches.match(new URL('index.html', event.request.url).href)))
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

  // Fond de carte : cache d'abord. Les URL de tuiles embarquent le numéro de
  // build, elles sont donc immuables — une fois vues, plus aucun octet réseau.
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
