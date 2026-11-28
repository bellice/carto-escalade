# Hors-ligne et fond de carte

## Hors-ligne (déjà actif)

`sw.js` applique une stratégie par type de ressource :

- **Coquille + données** (pages, CSS, JS, `maplibre-gl`, `data.geojson`,
  `routes/<slug-site>.json`) : **pré-cachées à l'install** puis servies en
  **stale-while-revalidate** → l'app (HTML, JS, styles, données, lib de
  carte, détail des voies) démarre **offline dès la première ouverture**, en
  servant le cache instantanément (aucun aller-retour réseau, important en
  contexte faible réseau) tout en se rafraîchissant en arrière-plan pour la
  visite suivante.
- **`maplibre-gl` est servi par le site** (`assets/vendor/maplibre/`), pas par
  un CDN. Une version antérieure de ce document notait que le build ESM 6.4.1
  ne chargeait pas ses tuiles vectorielles servi depuis le même domaine que la
  page. Ce blocage ne se reproduit plus dans les conditions testées : les
  versions 6.4.1 et 6.20.0, sous Chromium (service worker actif ou bloqué),
  Firefox et WebKit de Playwright sous Windows (service worker bloqué). Tuiles,
  style et worker se chargent en 200. Ses fichiers sont **ajoutés au pré-cache**
  du service worker : ils sont disponibles hors-ligne dès l'install.
  Sur le moteur WebKit de Playwright, la carte n'atteignait pas l'état « prête »
  avec le CDN et l'atteint avec la copie locale. Le risque est supprimé sur ce
  moteur seulement ; Safari réel reste à confirmer.
- **Tuiles / fond de carte** (OpenFreeMap, cross-origin) : **cache d'abord**,
  dans un cache **séparé** (`sorties-escalade-tuiles-v1`) — les tuiles sont
  versionnées (immuables, le numéro de modèle est dans l'URL) : une fois
  affichées, elles sont servies du cache **instantanément et sans bande
  passante** aux visites suivantes (l'objectif premier du site). Le style du
  fond seul suit stale-while-revalidate (petit fichier, il porte le modèle
  du jour).

### « Préparer le hors-ligne »

Le cache des tuiles ci-dessus est **réactif** : il ne protège que les zones
déjà affichées. Arriver sur une falaise jamais consultée, sans réseau,
donnait donc un fond gris. Le bouton **« Préparer »** (dans l'en-tête, voir
`assets/js/hors-ligne.js`) inverse la logique : il télécharge à l'avance le
fond autour de tous les points de la sortie.

Ses libellés tiennent dans un budget de 107 px mesuré à 390 px de large, et
aucun état de repos ne dépasse 98 px : `Préparer` (83) → `Prête` (60). L'état
terminé **rétrécit** le bouton, jamais l'inverse — un libellé qui s'élargit
coupait le titre de la sortie et déformait le lien de retour.

- **Disques autour des points, pas le rectangle englobant** : le bbox complet
  de la sortie Drôme représente ~13 000 tuiles / ~650 Mo. Les falaises sont
  des points dispersés : un anneau de ±1 tuile autour de chacun, dédupliqué,
  tombe à **463 tuiles / ~21 Mo** — mesuré, ~9 s en wifi.
- **z9 à z14 seulement** : la source OpenFreeMap déclare `maxzoom: 14`.
  Au-delà, aucune tuile n'existe (MapLibre sur-zoome celle de z14) —
  pré-charger z15/z16 ne téléchargerait que des 404. z9–14 couvre donc
  **tous** les niveaux de zoom atteignables.
- Les **glyphes** (plages latines) sont inclus : sans eux, un fond hors-ligne
  s'afficherait sans aucun nom de lieu.
- L'URL des tuiles contient l'horodatage du build planète OpenFreeMap
  (`/planet/20260823_080002_pt/...`). À chaque nouveau build, ce chemin change
  et **toutes les tuiles en cache deviennent inatteignables d'un coup** : la
  préparation mémorise ce modèle et bascule le bouton sur « Repréparer » si le
  fond a changé depuis.

**Ce qui est enregistré, et à quelle condition.** `nbTuiles` est le nombre de
tuiles **réellement obtenues**, pas le nombre visé : c'est la seule valeur sur
laquelle on puisse fonder une promesse. En dessous de `SEUIL_REUSSITE` (50 %),
rien n'est écrit du tout — le bouton affiche « Échec » en nommant la cause, et
un état correct plus ancien survit à la tentative ratée.

Ce plancher répare un défaut franc : le lot était auparavant enregistré comme
une réussite quel que soit le résultat. Hors ligne, un clic écrivait
« prête, 463 tuiles » en **une seconde** alors que 465 fichiers sur 469 avaient
échoué — seul un `console.warn` en gardait trace. Une confiance fausse est pire
que pas de fonctionnalité : elle ne se découvre qu'au pied de la falaise, sans
réseau pour rattraper. Le partiel reste toléré au-dessus du seuil (mieux vaut
95 % de la zone que rien), mais il est alors **dit** dans la description du
bouton.

Le bouton se **désactive hors ligne**, la raison étant portée par
`title`/`aria-label` — sauf pendant une préparation en cours, où il sert à
annuler et doit rester actionnable. Désactiver ne suffit pourtant pas : le
réseau peut tomber *pendant* le téléchargement, cas le plus réaliste sur la
route. C'est le plancher ci-dessus qui est le vrai garde-fou.

**L'indicateur hors-ligne** (`.bandeau-hors-ligne`) est une puce **permanente**
posée sur la carte, en haut à gauche. Permanente parce qu'être hors ligne est
un *état* et non un évènement : un message qui s'efface laisserait sans réponse
celui qui regarde l'écran cinq minutes plus tard. Sur la carte plutôt qu'en bas
parce que **recouvrir le canevas est gratuit — rien d'actionnable n'y est
caché — tandis que recouvrir de l'interface coûte** : ancrée en bas, la barre
masquait entièrement l'attribution OpenStreetMap (obligation de crédit),
mangeait 7 px de la légende dépliée et 27 px de la fiche mobile. Elle ne
réserve aucune place ; sur desktop elle revient dans le flux du panneau, dont
la hauteur varie au repli.

### Durabilité du stockage, et installation

Télécharger 21 Mo ne sert à rien si le navigateur les jette avant la sortie.
Par défaut le stockage d'un site est **best-effort** : évinçable dès que la
place manque. WebKit va plus loin et supprime le stockage scriptable d'un site
après **7 jours sans visite** en tant que site principal — soit exactement le
scénario visé (préparer chez soi, arriver à la falaise deux semaines plus
tard, sans réseau pour rattraper). Deux parades, cumulables :

- **`navigator.storage.persist()`**, réclamé **au clic sur « Préparer »** et
  jamais au chargement : les navigateurs accordent sur des heuristiques
  d'engagement, et une action explicite de l'utilisateur est le meilleur
  moment pour la demander. `persisted()`, qui ne déclenche aucune permission,
  est relu au montage pour que l'infobulle dise la vérité à chaque visite. Si
  la durabilité n'est pas acquise, « Prête » l'annonce et donne la parade :
  rouvrir le site avant de partir remet à zéro le compteur d'inactivité.
- **Installer le site** (`manifest.webmanifest`) : un site installé échappe à
  la purge WebKit des 7 jours, et Chrome accorde alors `persist()` sans
  discuter. C'est la seule parade fiable sur iPhone.

Le manifeste vit à la racine, avec `icones/`. Toutes ses URL sont
**relatives** (`start_url: "./"`, `scope: "./"`) : le site est servi depuis un
sous-chemin (`bellice.github.io/carto-escalade/`), un `/` initial pointerait
sur la racine du domaine. Les icônes sont les seuls bitmaps du site et ne sont
jamais sur le chemin de rendu — le navigateur ne les récupère qu'à
l'installation. Régénérables : `node outils/generer-icones.js`.

Une mise à jour (code ou données : nouveau `data.geojson`, `routes/`) finit
toujours par arriver toute seule grâce au stale-while-revalidate — au pire
2 rechargements (le 1er sert encore l'ancien contenu tout en déclenchant le
rafraîchissement en arrière-plan, le 2e sert la version fraîche). **Bumper
`CACHE_NAME`** dans `sw.js` reste utile pour forcer un renouvellement
**immédiat** (ex. correctif urgent), et reste **obligatoire quand on ajoute
un module JS** à la coquille : un nouvel import absent du pré-cache fait
échouer tout le graphe de modules au premier chargement hors ligne (constaté
en test). Ce bump n'efface **pas** les tuiles, qui vivent dans leur propre
cache — un déploiement de routine ne coûte donc jamais la préparation
hors-ligne de quelqu'un.

> **Dev avec Vite** : le service worker est volontairement désactivé (et
> désenregistré) quand la page est servie par Vite — son cache-first
> renverrait des ressources déjà transformées par Vite (html-proxy, modules
> réécrits) et casserait le chargement. Pour tester le comportement offline,
> servez le dossier avec un serveur statique simple (`python -m http.server`)
> ou directement le site déployé.

## Fond de carte : bande passante, pas PMTiles

Le fond de plan vient d'[OpenFreeMap](https://openfreemap.org) (vecteur,
libre, gratuit, sans clé), schéma OpenMapTiles — le style `positron` est
localisé dans le pré-cache du service worker.

Le premier chargement d'une zone nécessite du réseau (les tuiles de la zone
sont téléchargées puis mises en cache par le service worker) ; ensuite elles
sont servies **du cache, sans aucun octet réseau** — le principal levier de
bande passante du site (objectif : contexte réseau faible en falaise).

**Pourquoi pas un fond 100% local en PMTiles ?** Évalué (phase 4) et écarté
pour l'instant :
- OpenFreeMap ne publie **pas** de PMTiles (le planète complet en MBTiles
  fait ~90 Go) ; les extraits OpenMapTiles passent par MapTiler (payant).
- OSM (schéma `shortbread`) et IGN (tuiles avec clé, schéma propre) ne sont
  pas compatibles avec le style `positron` existant → le rendu changerait.
- Protomaps fournit des PMTiles régionaux, mais avec son propre schéma →
  même contrainte de refonte du style.

Si le vrai offline total devenait un jour nécessaire, la piste serait un
PMTiles régional Protomaps + un style adapté à son schéma — un changement de
rendu assumé, à trancher le moment venu.
