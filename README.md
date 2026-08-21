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
    popups.js        → HTML des popups (rose des vents, jauges, GPS...)
    symboles.js      → cercles proportionnels (taille, remplissage, légende)
    labels.js        → libellés de site/secteur sur la carte
    donnees.js       → lecture GeoJSON, agrégats, prédicats de visibilité
    utils.js         → escapeHtml
sorties/
  2026-10-drome-saou/
    index.html       → page carte de cette sortie
    data.geojson     → falaises + parkings (généré depuis QGIS)
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
2. Remplacer `data.geojson` par l'export QGIS de la nouvelle sortie
   (voir schéma de champs plus bas).
3. Ajouter une entrée dans la liste de `index.html` (racine).
4. `initCarte('data.geojson')` reste inchangé — aucune autre modif de code requise.

## Schéma `data.geojson`

Trois catégories dans une seule FeatureCollection, distinguées par `properties.categorie`.

**Falaise**
`nom`, `site`, `secteur`, `categorie` ("falaise"), `parking_associe`, `approche_min`,
`approche_metre`, `lien_oblyk`, `type_roche`, `orientation`, `cotation_min`, `cotation_max`,
`nb_voies`, `nb_voies_cot5`, `nb_voies_cot6a`, `nb_gv`, `nb_couenne`

Une feature par **secteur**, pas par sommet : un même `nom` (sommet) peut
apparaître plusieurs fois, une fois par `secteur`. `nom` seul n'est donc plus
unique — la carte identifie chaque falaise par `nom`+`secteur` en interne, et
n'affiche le secteur en sous-titre de popup que s'il diffère du nom (secteur
unique : les deux valeurs sont identiques dans les données, pas de doublon
affiché). `site` est le regroupement géographique le plus large (ex. "Saoû I") ;
sert aussi à générer le badge affiché sur la popup des parkings associés.

`nb_voies*` ne comptabilise que les voies d'escalade **sportive** (pas de trad).
`nb_voies_cot5`/`nb_voies_cot6a` ne couvrent que les grades 5 et 6a-6a+ : il peut
exister des voies encore plus faciles (3, 4) non comptées — l'écart entre
`nb_voies` et ces deux compteurs n'indique pas forcément des voies plus dures.

`nb_gv`/`nb_couenne` (facultatifs) : classification exclusive des voies
(grande voie / couenne), `nb_gv + nb_couenne = nb_voies` quand renseignés.
Activent le mode "Type de voies" du sélecteur de cercles proportionnels sur
la carte — ce mode reste masqué tant qu'aucune falaise de la sortie n'a ces
champs remplis.

**Parking**
`nom`, `categorie` ("parking"), `trajet_gite_min`

`nom` sert de description ET de clé de jointure avec `parking_associe` côté
falaise (ne pas le raccourcir). Le libellé affiché sur la popup parking est
généré automatiquement — un badge avec le/les `site` des falaises desservies,
au-dessus de `nom` en description complète — donc aucun champ supplémentaire
à remplir.

**Gîte** (facultatif, un seul par sortie)
`nom`, `categorie` ("hébergement")

`trajet_gite_min` (côté parking) n'a de sens visuel que si un point `gite` existe
sur la carte — sinon ce n'est qu'un chiffre sans repère spatial.

CRS : **EPSG:4326** obligatoire (reprojeter depuis Lambert93 à l'export QGIS).

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
