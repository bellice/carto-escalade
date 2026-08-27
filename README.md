# Sorties escalade

Site statique minimaliste : une carte par sortie (falaises + parkings), pas de backend.

Palette, typographie et composants : voir [`charte-graphique.html`](charte-graphique.html)
(ouvrir directement dans un navigateur — s'appuie sur les vraies feuilles de
style du site, reste à jour tant que les tokens ne changent pas de nom).

## Structure

```
index.html          → page d'accueil, liste des sorties
sw.js                → service worker : pré-cache de la coquille + données,
                       stale-while-revalidate pour les deux + cache-first
                       pour les tuiles du fond (voir "Hors-ligne")
assets/
  style.css          → tokens (palette, polices) + page d'accueil uniquement
  style-carte.css    → marqueurs, popups, légende, feuille mobile, impression
                       (séparé de style.css : la page d'accueil n'en a jamais
                       besoin, pas de raison de le lui faire charger)
  js/                → logique carte, en modules ES natifs (import/export,
                       aucun bundler) — chargés via <script type="module">
    demarrer-accueil.js → point d'entrée de la page d'accueil
    demarrer-sortie.js  → point d'entrée d'une page sortie (initCarte + SW).
                       Ces deux fichiers remplacent les anciens <script>
                       inline : sans code inline, la CSP peut refuser
                       'unsafe-inline' (voir la meta dans les pages)
    sw-client.js     → enregistrement du service worker (garde-fou Vite)
    carte.js         → initCarte(dataUrl), orchestration
    carte-utils.js   → cadrage caméra, contrôle "Tout voir"
    marqueurs.js     → marqueurs DOM parking/gîte + popup native des falaises
    popups.js        → HTML des popups (rose des vents, beeswarm des voies, GPS...)
    symboles.js      → cercles proportionnels : construireSourceFalaises +
                       couleurFalaisePourMode (couche native), légende
    labels.js        → libellés de site/secteur sur la carte
    donnees.js       → lecture GeoJSON, agrégats, prédicats de visibilité
    hors-ligne.js    → « Préparer le hors-ligne » : pré-chargement des tuiles
                       de la zone (voir "Hors-ligne")
    utils.js         → escapeHtml (sûr en attribut) + urlSure (schémas
                       autorisés pour les href issus des données)
sorties/
  2026-10-drome-saou/
    index.html       → page carte de cette sortie
    data.geojson     → falaises + parkings, version LÉGÈRE (sans le détail des
                       voies, compteurs précalculés) — généré depuis une base DuckDB
    routes/          → détail des voies, 1 fichier par SITE (chargé à la
                       demande à l'ouverture de la popup d'une de ses falaises)
```

`maplibre-gl` 6.4.1 est chargé depuis le CDN jsDelivr (pas vendu en local —
voir « Hors-ligne » pour la raison) mais **pré-caché par le service worker**.

## Rendu des falaises (couche native, phase 3)

Les falaises ne sont **pas** des marqueurs DOM mais une **couche MapLibre**
(`circle` data-driven, source geojson `falaises` avec `promoteId: 'cle'`) :
rendu GPU, conçu pour passer à l'échelle (milliers de falaises). La source
est reconstruite par `construireSourceFalaises()` (symboles.js) — tri par
valeur décroissante, exclusion des falaises vidées par le mode « Cercles » —
et les filtres recherche/gîte passent par `map.setFilter`. La surbrillance
(estompage des autres falaises quand une popup est ouverte) utilise
`setFeatureState` (`circle-opacity` data-driven). Parkings et gîte restent
des marqueurs DOM ; les falaises se dessinent donc SOUS eux (même ordre de
lecture qu'avant).

Trade-off assumé : les falaises ne sont plus focusables au clavier (canvas
MapLibre) — la recherche (champ « Rechercher une falaise ») reste le chemin
clavier pour y naviguer.

## Déployer sur GitHub Pages

1. Créer un repo GitHub, pousser ce dossier tel quel.
2. Paramètres du repo → Pages → Source : branche `main`, dossier `/ (root)`.
3. Le site est en ligne à `https://<utilisateur>.github.io/<repo>/`.

`robots.txt` + balise `<meta name="robots">` sur chaque page empêchent l'indexation
par les moteurs de recherche. Ça ne rend pas le site privé : l'URL reste accessible
à quiconque la connaît (repo public → Pages public). Pour une vraie restriction
d'accès, il faudrait un repo privé + GitHub Pages payant, ou un mot de passe côté
serveur — hors de portée d'un site statique gratuit.

## Répliquer pour une nouvelle sortie

1. Dupliquer `sorties/2026-10-drome-saou/` en `sorties/AAAA-MM-lieu/`.
2. Depuis le repo de génération (voir plus bas), lancer l'export puis la
   copie vers ce repo :
   `uv run scripts/export_geojson.py` puis `uv run scripts/copy_to_site.py --sortie AAAA-MM-lieu`
   — ça remplace `data.geojson` (version légère, sans le détail des voies)
   ET le dossier `routes/` (détail par site, chargé à la demande).
3. Ajouter une entrée dans la liste de `index.html` (racine).
4. `initCarte('data.geojson')` reste inchangé — aucune autre modif de code requise.

La génération vit dans un repo séparé (`escalade/` : base DuckDB +
`scripts/export_geojson.py`) ; ce repo-ci ne fait que servir les exports.
`data.readable.geojson` (détail des voies inclus, pour référence humaine)
reste dans `data/web/` du repo de génération, pas ici.

## Schéma `data.geojson`

FeatureCollection standard (géométries Point, WGS84/CRS84), généré depuis une
base DuckDB — plus de saisie manuelle. Une clé racine `sources` (tableau) en
plus de `features` : table de lookup pour l'attribution des données (nom,
url, millésime), référencée par `source_id` sur les falaises/voies. Pas
encore affichée dans l'UI (facultatif, disponible pour une itération future).

Trois catégories, distinguées par `properties.categorie` ("falaise",
"parking", "hebergement" — **sans accent**). Les properties ne sont PAS
uniformes entre catégories (chaque catégorie ne porte que ses propres clés,
pas de `null` de remplissage) — toute lecture doit checker `categorie`
d'abord plutôt que supposer qu'une clé existe.

**Falaise**
`nom`, `site`, `secteur`, `categorie` ("falaise"), `type_roche`,
`orientation` (tableau), `lien_oblyk`, `lien_camptocamp`, `source_id`,
`parking_associe`/`approche_min`/`approche_metre` (tableaux, alignés
position à position — même à 1 seul parking), `nb_voie_total`,
`nb_voie_sportive`, `nb_voie_autres` (invariant : total = sportive + autres),
`nb_couenne`, `nb_gv`, `nb_faciles` (compteurs **précalculés** à la
génération — voir `export_geojson.py` ; le client ne les calcule plus), et
`routes` (id_falaise si la falaise a des voies sportives, sinon `null`).

Une feature par **secteur**, pas par sommet : un même `nom` (sommet) peut
apparaître plusieurs fois, une fois par `secteur`. `nom` seul n'est donc plus
unique — la carte identifie chaque falaise par `nom`+`secteur` en interne, et
n'affiche le secteur en sous-titre de popup que s'il diffère du nom (secteur
unique : les deux valeurs sont identiques dans les données, pas de doublon
affiché). `site` est le regroupement géographique le plus large (ex. "Saoû I") ;
sert aussi à générer le badge affiché sur la popup des parkings associés.

Le détail des voies (`voies_sportives`, une entrée par voie : `nom`,
`cotation`, `type_voie` — "couenne" ou "grande voie" —, `nb_longueur`,
`source_id` ; `cotation` = celle de la longueur la plus dure) n'est PAS dans
`data.geojson` : il représentait ~70 % du poids historique du fichier, pour
un usage uniquement à l'ouverture de la popup d'une falaise. Il est généré à
part dans `routes/<slug-site>.json` (un fichier par site, indexé par
`id_falaise` — plusieurs falaises d'un même site partagent le fichier) et
chargé à la demande (voir `marqueurs.js`, `popup.on('open')`), avec un cache
en mémoire pour les réouvertures. La version lisible complète est
`data.readable.geojson` (repo de génération).

**Parking**
`nom`, `categorie` ("parking"), `trajet_gite_min`

`nom` sert de description ET de clé de jointure avec `parking_associe` côté
falaise (ne pas le raccourcir). Le libellé affiché sur la popup parking est
généré automatiquement — un badge avec le/les `site` des falaises desservies,
au-dessus de `nom` en description complète — donc aucun champ supplémentaire
à remplir. `trajet_gite_min` : temps de trajet routier réel (API IGN), en
minutes, ou absent si pas encore calculé.

**Gîte** (facultatif, un seul par sortie)
`nom`, `categorie` ("hebergement")

`trajet_gite_min` (côté parking) n'a de sens visuel que si un point `gite` existe
sur la carte — sinon ce n'est qu'un chiffre sans repère spatial.

CRS : **EPSG:4326** obligatoire.

## Hors-ligne (déjà actif)

`sw.js` applique une stratégie par type de ressource :

- **Coquille + données** (pages, CSS, JS, `maplibre-gl`, `data.geojson`,
  `routes/<slug-site>.json`) : **pré-cachées à l'install** puis servies en
  **stale-while-revalidate** → l'app (HTML, JS, styles, données, lib de
  carte, détail des voies) démarre **offline dès la première ouverture**, en
  servant le cache instantanément (aucun aller-retour réseau, important en
  contexte faible réseau) tout en se rafraîchissant en arrière-plan pour la
  visite suivante.
- **`maplibre-gl` reste servi par le CDN** (et non vendu en local) : le build
  ESM 6.4.1 ne charge pas ses tuiles vectorielles quand il est servi depuis le
  **même domaine** que la page (constaté en test : `styleLoaded` reste faux,
  aucune tuile demandée — alors que le même code servi cross-origin fonctionne).
  Pour ne pas perdre l'offline de la lib, ses 4 fichiers (`.mjs`, `-shared`,
  `-worker`, `.css`) sont **ajoutés au pré-cache** du service worker : ils
  sont donc disponibles hors-ligne dès l'install, sans dépendre du CDN au
  moment de l'usage.
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
donnait donc un fond gris. Le bouton **« Préparer le hors-ligne »** (dans la
légende, voir `assets/js/hors-ligne.js`) inverse la logique : il télécharge à
l'avance le fond autour de tous les points de la sortie.

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
  préparation mémorise ce modèle et signale « à repréparer » si le fond a
  changé depuis.

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
