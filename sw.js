// sw.js — cache "réseau d'abord, avec filet de secours" pour un accès
// hors-ligne aux pages déjà visitées. Bump CACHE_NAME pour forcer un
// nettoyage du cache après un déploiement.
const CACHE_NAME = 'sorties-escalade-v1';

// Au-delà de ce délai, on ne fait plus confiance au réseau pour répondre à
// temps et on bascule sur le cache s'il y en a un — cas courant visé : signal
// faible en falaise (LENT, pas forcément MORT). Sans ce délai, un fetch() qui
// traîne sans jamais rejeter bloque indéfiniment (le .catch() d'un échec net
// ne se déclenche jamais pour ça), alors qu'une version en cache, utilisable,
// existe déjà. La requête réseau continue quand même en tâche de fond après
// ce basculement (voir event.waitUntil plus bas), pour rafraîchir le cache en
// vue de la prochaine visite même si elle finit par répondre plus tard.
const DELAI_RESEAU_MS = 3000;

self.addEventListener('install', () => {
  self.skipWaiting();
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
// cross-origin chargée sans CORS (ex. maplibre-gl.css, en <link> sans
// crossorigin) a un statut toujours à 0 et .ok toujours à false alors
// qu'elle est bien exploitable — l'exclure casserait son cache hors-ligne.
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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requeteReseau = fetch(event.request).then((response) =>
    mettreEnCache(event.request, response).then(() => response)
  );
  // Le service worker peut être arrêté dès que respondWith() est résolu —
  // sans ce waitUntil, une requête réseau encore en vol au moment du
  // basculement sur le cache (voir DELAI_RESEAU_MS) risquerait de ne jamais
  // avoir la chance de rafraîchir le cache.
  event.waitUntil(requeteReseau.catch(() => {}));

  const delaiDepasse = new Promise((resolve) => setTimeout(() => resolve(null), DELAI_RESEAU_MS));

  event.respondWith(
    Promise.race([requeteReseau, delaiDepasse])
      .then((response) => response || caches.match(event.request))
      .catch(() => caches.match(event.request))
  );
});
