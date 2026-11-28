# Contribuer

## Conventions de commit

- Un commit par étape logique.
- Aucune ligne d'attribution (`Co-Authored-By`, etc.) : règle de
  `CLAUDE.md`, vérifiée par le hook `.claude/hooks/bloquer-mention-ia.sh`.

## Ajouter un lieu

**Le lieu est une colonne des données, pas seulement un nom de dossier.** Les
CSV du repo de génération portent une colonne `lieu` (`falaise.csv`,
`parking.csv`, `hebergement.csv`, `voie.csv`) dont la valeur est **exactement
le nom du dossier ici** : c'est la charnière entre la donnée et l'URL publiée.
Avant elle, toutes les requêtes de l'export étaient sans portée — saisir une
seconde région dans les mêmes CSV l'aurait fait apparaître sur **toutes** les
cartes, et `--lieu` ne nommait que le dossier de destination.

> **La saisie prend du temps** (falaises avant voies avant parkings, souvent
> sur plusieurs sessions), et il n'est pas nécessaire d'attendre voies et
> parkings pour publier la vraie carte — seulement que les falaises soient
> toutes positionnées (`lat`/`lon`, et `site`/`secteur` uniques par lieu, voir
> `db/schema/01_falaise.sql` dans le dépôt de génération). Sans voie ni
> parking, la fiche d'une falaise masque d'elle-même ce qui manque
> (colonnes Voies/Grimpe/Roche, histogramme, liste de parkings — voir
> `popupFalaise` dans `assets/js/popups.js`, chaque bloc est conditionné à la
> présence de sa donnée) plutôt que d'afficher un "0" ou un "undefined" :
> c'est ainsi que `cassis-ciotat/` a été publié dès son recensement de
> falaises terminé, avant même sa première voie saisie.
>
> Tant que les falaises ne sont même pas encore toutes positionnées, publier
> d'abord une page `<lieu>/index.html` minimale — pas la carte, juste une
> notice — donne un lien stable à suivre pendant la saisie. Une telle page
> n'a pas de `data.geojson` : elle échappe donc à `LIEUX` (voir
> `trouverLieux()` dans `tests/statique.test.js`), au `PRECACHE` de l'étape 4
> et aux tests spécifiques à l'interface carte — mais pas aux tests
> génériques (un seul `<h1>`, CSP déclarée, aucun script inline), qui la
> découvrent via son propre `index.html` (`trouverPagesPubliees()`, même
> fichier). Si l'accueil affiche un état d'avancement à la place du décompte
> secteurs/voies/roche habituel (une falaise sans aucun `type_roche` saisi
> suffit à le signaler), `statique.test.js` le sait aussi et n'exige pas ce
> décompte pour ce lieu — voir son commentaire.

1. Saisir les falaises/parkings/voies dans les CSV habituels, avec la nouvelle
   valeur de `lieu` (ex. `presquile-crozon`). Un gîte est facultatif : sans
   hébergement pour ce lieu, la carte masque d'elle-même le curseur « Trajet
   depuis le gîte » et la clé de légende correspondante.
2. Ajouter une entrée dans `outils/lieux.json`, puis lancer `npm run generer`.
   La page `<lieu>/index.html` est écrite à partir de
   `outils/gabarit-carte.html` : chemins `../`, CSP, `modulepreload` et le
   reste viennent du gabarit. Ne pas modifier une page à la main, un test
   échoue dès qu'elle diffère du gabarit. L'entrée porte :

   | champ | rôle | exemple |
   |---|---|---|
   | `slug` | nom du dossier du lieu | `presquile-crozon` |
   | `titreLong` | nom complet, repris dans `<title>` et `<h1>` | `Presqu’île de Crozon` |
   | `titreCourt` | forme courte, dans le `<h1>` | `Crozon` |
   | `description` | `<meta name="description">`, 150 à 160 caractères, écrite à la main (un test vérifie la longueur) | |
   | `commentaire` | facultatif : tableau de lignes, commentaire HTML posé avant le `<h1>` | |

   **Pourquoi deux libellés.** L'en-tête de la carte affiche le nom complet à
   partir de 641px et la forme courte en dessous (voir `.titre-long` dans
   `assets/css/`). Le titre y dispose de la largeur de l'écran moins 243px,
   une fois retranchés le lien de retour et le bouton « Préparer » à son
   libellé le plus large — soit ~400px au seuil de bascule. Un nom qui n'y
   tient pas fait échouer un test navigateur, qui dit lequel raccourcir.

   La forme courte se construit en retirant le qualificatif géographique, pas
   en tronquant : `Vallée de la Drôme et Diois` → `Drôme et Diois`,
   `Presqu'île de Crozon` → `Crozon`.

   **Le nom du lieu nomme la région, pas les sites qu'on y a saisis.**
   `penhir-argol` a dû être renommé en `presquile-crozon` dès qu'Argol est
   arrivé, et aurait dû l'être encore au site suivant — un renommage coûte une
   URL morte chez tous ceux qui avaient le lien.
3. Depuis le repo de génération (voir plus bas), **une seule commande** :
   `uv run scripts/tout_regenerer.py`
   — base → temps de trajet → puis, **pour chaque lieu présent en base**,
   export puis copie. La liste des lieux vient des données
   (`SELECT DISTINCT lieu FROM falaise`), jamais d'une énumération à tenir à
   jour. `--lieu <x>` restreint à un seul.

   Les pages carte listent les secteurs de `data.geojson` dans leur repli sans
   JavaScript : après chaque régénération des données, lancer
   `npm run generer` (un test statique échoue sinon).

   > Ne pas lancer les scripts un par un. `build_db.py` **vide** le cache des
   > temps de trajet (alimenté par l'API IGN, jamais par les CSV) : enchaîner
   > directement sur l'export produit un site où le curseur « Trajet depuis le
   > gîte » disparaît sans le moindre message. Et `data/web/` ne contient
   > **qu'un lieu à la fois** (l'export y fait table rase des `routes/`) :
   > exporter les deux avant de copier ne publierait que le dernier.
   > `tout_regenerer.py` impose l'ordre et refuse de publier sur un cache vide.
4. Ajouter une entrée dans la liste de `index.html` (racine) et deux lignes
   dans le `PRECACHE` de `sw.js` (`./<lieu>/index.html`, `./<lieu>/data.geojson`).
   **Les deux sont vérifiés par un test statique** : un lieu absent de l'accueil
   est introuvable, un lieu absent du `PRECACHE` s'affiche parfaitement en ligne
   et ne marche pas hors ligne — c'est-à-dire au seul moment où on en a besoin.
5. `initCarte('data.geojson')` reste inchangé : chaque page charge le
   `data.geojson` **de son propre dossier**, et `routes/` s'en déduit. Il n'y a
   aucune logique inter-lieu côté site — l'isolation est faite en amont, par
   l'export.

Les tests découvrent les lieux tout seuls (tout dossier portant un
`data.geojson`) : un lieu ajouté est couvert dès sa première régénération, sans
toucher aux fichiers de test. Un garde-fou vérifie en plus que **l'étendue d'un
lieu reste régionale** — la Drôme mesure 67 km de diagonale, un mélange
Drôme + Bretagne en ferait 897, et rien à l'œil ne distinguerait la carte
fautive d'une carte normale simplement dézoomée.

La génération vit dans un repo séparé (`escalade/` : base DuckDB +
`scripts/export_geojson.py`) ; ce repo-ci ne fait que servir les exports.
`data.readable.<lieu>.geojson` (détail des voies inclus, pour référence humaine)
reste dans `data/web/` du repo de génération, pas ici.
