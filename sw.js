// sw.js — une stratégie par type de ressource, pour tenir sur réseau lent :
// - CSS/JS locaux, data.geojson, routes/*.json : pré-cachés à l'install puis
//   stale-while-revalidate — démarrage sans attendre le réseau, rafraîchi en
//   arrière-plan ;
// - navigations HTML : réseau d'abord, repli cache — indispensable avec un
//   serveur de dev qui transforme le HTML (Vite) ;
// - fond de carte OpenFreeMap : cache d'abord, les tuiles étant versionnées
//   donc immuables. C'est le principal gain de bande passante du site.
// Bumper CACHE_NAME force un renouvellement immédiat (correctif urgent). Un
// déploiement ordinaire n'en a pas besoin : le stale-while-revalidate rafraîchit.
const CACHE_PREFIXE = 'sorties-escalade-v';
// À bumper quand un module est ajouté à la coquille : un module absent du
// cache fait échouer l'import au premier chargement hors ligne, et toute la
// carte tombe. Le rafraîchissement paresseux ne le rattrape pas.
const CACHE_NAME = `${CACHE_PREFIXE}14`;

// Cache SÉPARÉ du fond de carte, à ne surtout pas fusionner avec la coquille :
// il n'est pas versionné par CACHE_NAME, sans quoi bumper la coquille pour
// livrer du code effacerait une zone pré-chargée avant une sortie.
const CACHE_TUILES = 'sorties-escalade-tuiles-v1';

// Liste MANUELLE : une entrée par dossier sortie/ (page + data.geojson) — un
// oubli casse le hors-ligne de cette sortie, en silence. maplibre-gl est servi
// par le site (assets/vendor/maplibre/) et pré-caché ici comme le reste de la
// coquille. Les routes/*.json, elles, sont ajoutées dynamiquement (precacherRoutes).
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/tokens.css',
  './assets/style.css',
  './assets/css/marqueurs.css',
  './assets/css/mise-en-page.css',
  './assets/css/controles.css',
  './assets/css/legende-filtres.css',
  './assets/css/bascule-mobile.css',
  './assets/css/fiche.css',
  './assets/css/detail-voies.css',
  './assets/css/fiche-actions.css',
  './assets/css/fiche-mobile.css',
  './assets/css/adaptations.css',
  // assets/css/noscript.css n'est pas pré-cachée : elle ne sert que quand
  // JavaScript est désactivé, cas où ce service worker n'existe pas.
  './assets/js/carte.js',
  './assets/js/actions-fiche.js',
  './assets/js/carte-utils.js',
  './assets/js/couche-falaises.js',
  './assets/js/etat.js',
  './assets/js/filtres.js',
  './assets/js/navigation.js',
  './assets/js/panneau-lateral.js',
  './assets/js/visibilite.js',
  './assets/js/demarrer-accueil.js',
  './assets/js/demarrer-sortie.js',
  './assets/js/donnees.js',
  './assets/js/hors-ligne.js',
  './assets/js/labels.js',
  './assets/js/sw-client.js',
  './assets/js/marqueurs.js',
  './assets/js/popups.js',
  './assets/js/rose-des-vents.js',
  './assets/js/liens-acces.js',
  './assets/js/bouton-gps.js',
  './assets/js/champs-fiche.js',
  './assets/js/histogramme.js',
  './assets/js/detail-voies.js',
  './assets/js/symboles.js',
  './assets/js/utils.js',
  // maplibre-gl, servi par le site. Le worker est demandé avec ?v=<version> :
  // l'entrée porte la même chaîne, sinon le cache ne la retrouve pas hors ligne.
  './assets/vendor/maplibre/maplibre-gl.mjs',
  './assets/vendor/maplibre/maplibre-gl-worker.mjs?v=6.20.0',
  './assets/vendor/maplibre/maplibre-gl.css',
  // Style du fond de carte (OpenFreeMap) : pré-caché pour charger sans
  // attendre le réseau à la 1re ouverture. Les tuiles ne sont PAS pré-cachées
  // (leurs URLs dépendent du modèle du jour) : mises en cache au fil des vues.
  'https://tiles.openfreemap.org/styles/positron',
  // Sorties (une entrée par dossier) :
  './vallee-drome-diois/index.html',
  './vallee-drome-diois/data.geojson',
  './presquile-crozon/index.html',
  './presquile-crozon/data.geojson',
  './dentelles-montmirail/index.html',
  './dentelles-montmirail/data.geojson',
  './cassis-ciotat/index.html',
  './cassis-ciotat/data.geojson',
];

// Sans ce pré-cache, la première ouverture d'une fiche paie une latence
// réseau pleine pour ~2 Ko, très visible sur réseau faible. Le coût réel est
// la taille compressée (ces fichiers compressent à 12:1), pas la taille brute.
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
          // new Set(...) : plusieurs falaises d'un même site partagent la même
          // URL routes/<slug>.json, à ne mettre en cache qu'une fois.
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

// Le ménage à l'activation ne touche que les anciennes versions de la coquille
// (préfixe CACHE_PREFIXE). Le cache des tuiles reste : livrer du code ne doit
// pas effacer la zone que l'utilisateur a pré-chargée avant de partir.
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
