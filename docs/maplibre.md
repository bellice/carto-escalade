# Mise à jour de MapLibre

MapLibre est copié dans `assets/vendor/maplibre/` : `maplibre-gl.mjs`,
`maplibre-gl-worker.mjs`, `maplibre-gl.css` et la licence. Version actuelle :
6.20.0.

```sh
node outils/maj-maplibre.js 6.20.0
```

Le script télécharge le paquet npm de la version demandée, vérifie son
`integrity` contre celle du registre (en cas d'écart, rien n'est copié), puis
ne copie que ces fichiers, plus `maplibre-gl-shared.mjs` si un module de cette
version le référence. Il est le seul à utiliser le réseau : ni le site ni les
tests n'en ont besoin.

Après une mise à jour :

- `sw.js` : incrémenter `CACHE_NAME` et reporter la version dans l'entrée du
  worker (`maplibre-gl-worker.mjs?v=<version>`). MapLibre demande le worker
  avec sa version en paramètre, et le pré-cache doit porter la même chaîne.
  Un test statique le vérifie.
- Lancer `npm test`.

Les fichiers de `assets/vendor/` ne se modifient pas à la main : leurs octets
sont ceux du paquet npm. `.gitattributes` les exclut de la normalisation des
fins de ligne et le build les publie tels quels.

Voir aussi : [la CSP](architecture.md#la-csp-et-pourquoi-elle-est-en-meta) (aucune origine de CDN) et [Hors-ligne](hors-ligne.md) (pré-cache du service worker).
