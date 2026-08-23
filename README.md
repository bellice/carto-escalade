# Sorties escalade

Site statique minimaliste : une carte par sortie (falaises + parkings), pas de backend.

## Structure

```
index.html          → page d'accueil, liste des sorties
sw.js                → service worker (cache hors-ligne, voir plus bas)
assets/
  style.css          → tokens (palette, polices) + page d'accueil uniquement
  style-carte.css    → marqueurs, popups, légende, feuille mobile, impression
                       (séparé de style.css : la page d'accueil n'en a jamais
                       besoin, pas de raison de le lui faire charger)
  js/                → logique carte, en modules ES natifs (import/export,
                       aucun bundler) — chargés via <script type="module">
    carte.js         → point d'entrée : initCarte(dataUrl), orchestration
    carte-utils.js   → cadrage caméra, contrôle "Tout voir"
    marqueurs.js     → création des marqueurs falaise/parking/gîte
    popups.js        → HTML des popups (rose des vents, beeswarm des voies, GPS...)
    symboles.js      → cercles proportionnels (taille, remplissage, légende)
    labels.js        → libellés de site/secteur sur la carte
    donnees.js       → lecture GeoJSON, agrégats, prédicats de visibilité
    utils.js         → escapeHtml
sorties/
  2026-10-drome-saou/
    index.html       → page carte de cette sortie
    data.geojson     → falaises + parkings (généré depuis une base DuckDB)
```

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
2. Remplacer `data.geojson` par l'export de la nouvelle sortie
   (voir schéma de champs plus bas).
3. Ajouter une entrée dans la liste de `index.html` (racine).
4. `initCarte('data.geojson')` reste inchangé — aucune autre modif de code requise.

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
`voies_sportives` (tableau détaillé, une entrée par voie : `nom`, `cotation`,
`type_voie` — "couenne" ou "grande voie" —, `nb_longueur`, `source_id` ;
`cotation` = celle de la longueur la plus dure).

Une feature par **secteur**, pas par sommet : un même `nom` (sommet) peut
apparaître plusieurs fois, une fois par `secteur`. `nom` seul n'est donc plus
unique — la carte identifie chaque falaise par `nom`+`secteur` en interne, et
n'affiche le secteur en sous-titre de popup que s'il diffère du nom (secteur
unique : les deux valeurs sont identiques dans les données, pas de doublon
affiché). `site` est le regroupement géographique le plus large (ex. "Saoû I") ;
sert aussi à générer le badge affiché sur la popup des parkings associés.

Pas de champs `nb_couenne`/`nb_gv`/`nb_voies_cotX`/`cotation_min`/`cotation_max` :
la carte les dérive côté client depuis `voies_sportives` (voir
`compterVoiesSportivesParType` et `calculerBornesCotationGlobales` dans
`donnees.js`) plutôt que de les attendre pré-calculés dans les données.

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

`sw.js` met en cache chaque page/requête au fur et à mesure qu'elle est
chargée avec du réseau (stratégie "réseau d'abord, cache en secours") : si tu
ouvres une sortie une fois en wifi/4G avant de partir, elle reste consultable
sans réseau ensuite — y compris les tuiles de fond de carte déjà affichées.
Zéro configuration, mais ça ne couvre que ce qui a été vu au moins une fois ;
pour un fond de carte garanti disponible partout dès le premier chargement
offline, voir la section PMTiles ci-dessous.

## Passer en offline total (PMTiles)

Actuellement la carte charge le fond de plan depuis
[OpenFreeMap](https://openfreemap.org) (vecteur, libre, gratuit, sans clé) —
ça nécessite du réseau au premier chargement.

Pour un fond de carte 100% local :

1. Générer un `.pmtiles` pour la zone avec [`tippecanoe`](https://github.com/felt/tippecanoe)
   ou le [convertisseur PMTiles](https://github.com/protomaps/PMTiles) à partir
   d'un extrait OpenStreetMap (via [Protomaps builds](https://maps.protomaps.com/builds/)
   par exemple).
2. Déposer le fichier dans le dossier de la sortie (`sorties/.../tuiles.pmtiles`).
3. Dans `assets/js/carte.js`, remplacer la ligne `style:` de `initCarte()` par
   une source PMTiles locale (ajouter le protocole `pmtiles://` via
   [`pmtiles-maplibre`](https://github.com/protomaps/PMTiles/tree/main/js)).

Le reste du code (marqueurs, popups, filtres) ne change pas — seul le fond
de carte devient local.
