# Sorties escalade

Site statique minimaliste : une carte par sortie (falaises + parkings), pas de backend.

## Structure

```
index.html              → page d'accueil, liste des sorties
sw.js                    → service worker (cache hors-ligne, voir plus bas)
assets/
  style.css              → styles partagés (palette, popups, impression)
  app.js                 → logique carte (MapLibre, popups, recherche, filtres, copie GPS)
sorties/
  2026-10-drome-saou/
    index.html            → page carte de cette sortie
    data.geojson          → falaises + parkings (généré depuis QGIS)
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
`nom`, `categorie` ("falaise"), `parking_associe`, `approche_min`, `approche_metre`,
`lien_oblyk`, `type_roche`, `orientation`, `cotation_min`, `cotation_max`,
`nb_voies`, `nb_voies_cot5`, `nb_voies_cot6a`

`nb_voies*` ne comptabilise que les voies d'escalade **sportive** (pas de trad).
`nb_voies_cot5`/`nb_voies_cot6a` ne couvrent que les grades 5 et 6a-6a+ : il peut
exister des voies encore plus faciles (3, 4) non comptées — l'écart entre
`nb_voies` et ces deux compteurs n'indique pas forcément des voies plus dures.

**Parking**
`nom`, `categorie` ("parking"), `trajet_gite_min`

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
3. Dans `assets/app.js`, remplacer la ligne `style:` de `initCarte()` par une
   source PMTiles locale (ajouter le protocole `pmtiles://` via
   [`pmtiles-maplibre`](https://github.com/protomaps/PMTiles/tree/main/js)).

Le reste du code (marqueurs, popups, filtres) ne change pas — seul le fond
de carte devient local.
