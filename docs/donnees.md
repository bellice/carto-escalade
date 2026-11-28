# Schéma `data.geojson`

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
`nb_voie_sportive`, `nb_voie_trad`, `nb_voie_artificielle`,
`nb_voie_moulinette` (invariant : total = la somme des quatre),
`nb_couenne`, `nb_gv` (compteurs **précalculés** à la
génération — voir `export_geojson.py` ; le client ne les calcule plus),
`hauteur_max_voie_m` (voir l'encadré ci-dessous), `cotations` (voir plus bas),
et `routes` (id_falaise si la falaise a des voies sportives, sinon `null`).

> **`hauteur_max_voie_m` est la hauteur de la PAROI, jamais une longueur de
> corde.** Vérifié sur les données : un plafond de 350 m coexiste avec une voie
> de 13 longueurs. La fiche change donc de libellé selon le secteur —
> « Hauteur 30 m » quand il n'y a que des couennes (lisible en corde),
> « Paroi 350 m » dès qu'une grande voie existe. Un libellé unique induirait en
> erreur sur du matériel de sécurité ; deux tests statiques et un test
> navigateur interdisent de les fusionner. Voir `colonneHauteur()` dans
> `champs-fiche.js`.

`cotations` est un résumé compact `{cotation: nombre de voies}` des voies
**sportives** de la falaise, cotations laissées **brutes** (les formes non
standard comme `4-` ou `5` sont normalisées côté site, voir
`approximerCotation` dans `donnees.js` — une seule règle, pas deux). Il
alimente le filtre par fourchette de cotation : sans lui, il faudrait
télécharger tout `routes/` (350 Ko) rien que pour savoir quelles falaises
afficher. Coût mesuré : +1,6 Ko gzip. La somme de ses valeurs peut être
**inférieure** à `nb_voie_sportive` — quelques voies n'ont aucune cotation
renseignée et n'y figurent donc pas.

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
`data.readable.<lieu>.geojson` (repo de génération).

**Parking**
`nom`, `categorie` ("parking"), `trajet_gite_min`

`nom` sert de description ET de clé de jointure avec `parking_associe` côté
falaise (ne pas le raccourcir). Le libellé affiché sur la popup parking est
généré automatiquement — un badge avec le/les `site` des falaises desservies,
au-dessus de `nom` en description complète — donc aucun champ supplémentaire
à remplir. `trajet_gite_min` : temps de trajet routier réel (API IGN), en
minutes, ou absent si pas encore calculé.

**Gîte** (facultatif, un seul par lieu — un lieu sans gîte est légitime)
`nom`, `categorie` ("hebergement")

`trajet_gite_min` (côté parking) n'a de sens visuel que si un point `gite` existe
sur la carte — sinon ce n'est qu'un chiffre sans repère spatial.

CRS : **EPSG:4326** obligatoire.
