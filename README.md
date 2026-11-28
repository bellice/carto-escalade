# Tokelau

Site statique minimaliste : une carte par lieu (falaises + parkings), pas de backend.

Palette, typographie et composants : voir [`charte-graphique.html`](charte-graphique.html)
(ouvrir directement dans un navigateur — s'appuie sur les vraies feuilles de
style du site, reste à jour tant que les tokens ne changent pas de nom).

## Règles du projet

Le site s'appuie sur les standards du web : HTML sémantique, CSS natif,
JavaScript en modules ES, aucune dépendance en production. Ces règles
complètent celles de [`CLAUDE.md`](CLAUDE.md) (contraintes techniques,
écriture, attribution).

### Fonctionne sans JavaScript

L'accueil reste utilisable sans JavaScript. Il l'est déjà.

Les pages carte font exception : la carte WebGL de MapLibre a besoin de
JavaScript, et on ne cherche pas à la faire fonctionner sans. Elles offrent
en revanche un repli minimal, écrit en HTML et non par du JavaScript :

- un `<noscript>` dans `<main id="map">`, avec un message clair ;
- la liste des secteurs du lieu, groupés par site, un `<li>` par secteur (le
  décompte « N secteurs » de l'accueil). `outils/generer-pages.js` la dérive de
  `<lieu>/data.geojson`, avec les libellés de la carte (`libelleFalaise`) et un
  tri en collation française. Après une régénération des données, lancer
  `npm run generer`, sans quoi un test échoue ;
- une feuille `assets/css/noscript.css`, chargée par un `<link>` dans un
  `<noscript>` de l'en-tête (une balise `<style>` serait refusée par la CSP).
  Elle masque les contrôles inertes (filtres, bascule mobile, message de
  chargement). Le service worker ne la pré-cache pas : il n'existe pas sans
  JavaScript.

### Composants (Custom Elements)

Un composant réutilisable est un Custom Element natif, sans Shadow DOM par
défaut. Il reste ainsi soumis aux feuilles de style globales, et ses
références ARIA restent valides dans le document.

Le Shadow DOM n'est autorisé que si les quatre conditions suivantes sont
réunies :

- a. le composant est purement présentationnel ;
- b. il n'a aucune référence ARIA sortante (`aria-labelledby`,
  `aria-describedby`, `aria-controls`, etc.), car les IDREF ne traversent pas
  la frontière du shadow root ;
- c. il ne dépend d'aucune feuille CSS globale, car les styles globaux ne
  s'appliquent pas à l'intérieur du shadow root ;
- d. son contenu est inséré par le composant lui-même et non par un tiers
  (MapLibre injecte le contenu des popups dans son propre DOM).

En cas de doute, pas de Shadow DOM.

### Conventions de commit

- Un commit par étape logique.
- Aucune ligne d'attribution (`Co-Authored-By`, etc.) : règle de
  `CLAUDE.md`, vérifiée par le hook `.claude/hooks/bloquer-mention-ia.sh`.

## Structure

```
index.html          → page d'accueil, liste des lieux
sw.js                → service worker : pré-cache de la coquille + données,
                       stale-while-revalidate pour les deux + cache-first
                       pour les tuiles du fond (voir "Hors-ligne")
assets/
  style.css          → styles de l'accueil et des pages simples (404, mentions
                       légales, sources)
  css/               → tokens.css (jetons de design, chargé en premier par toutes
                       les pages), puis la page carte en 10 feuilles par thème
                       (marqueurs, légende et filtres, fiche, détail des voies,
                       fiche mobile, impression...) et noscript.css. L'ordre des
                       <link> dans chaque page est l'ordre de la cascade : ne pas
                       le changer. Séparées de style.css : la page d'accueil n'a
                       pas besoin des feuilles de la carte.
  js/                → logique carte, en modules ES natifs (import/export,
                       aucun bundler) — chargés via <script type="module">
    demarrer-accueil.js → point d'entrée de la page d'accueil
    demarrer-sortie.js  → point d'entrée d'une page sortie (initCarte + SW).
                       Ces deux fichiers remplacent les anciens <script>
                       inline : sans code inline, la CSP peut refuser
                       'unsafe-inline' (voir la meta dans les pages)
    sw-client.js     → enregistrement du service worker (garde-fou Vite)
    carte.js         → initCarte(dataUrl) : chargement des données, création
                       de la carte, câblage des modules ci-dessous
    etat.js          → état partagé de la page (objet `etat`), constantes de zoom
    visibilite.js    → filtres appliqués à la couche et aux marqueurs, parkings,
                       surbrillance, libellés de site/secteur (anti-collision)
    couche-falaises.js → couche native des cercles : source, couleur, légende
    filtres.js       → réglages de la légende (pratique, type de voie, cotation,
                       ensoleillement, trajet depuis le gîte), remise à zéro
    navigation.js    → allerVers, fiche falaise, clic sur la carte, libellés
                       cliquables, touche Échap
    panneau-lateral.js → recherche, repli des filtres, bascule mobile Carte/Filtres
    carte-utils.js   → cadrage caméra, contrôle "Tout voir"
    marqueurs.js     → marqueurs DOM parking/gîte + popup native des falaises
    popups.js        → assemble le HTML des 3 popups (falaise, parking, gîte)
    rose-des-vents.js → rose des vents SVG de l'orientation
    liens-acces.js   → itinéraire, bouton GPS, liens secondaires
    champs-fiche.js  → colonnes et lignes d'information de la fiche
    histogramme.js   → histogramme « 1 case = 1 voie » des cotations
    detail-voies.js  → liste détaillée des voies (tri cotation / position)
    symboles.js      → cercles proportionnels : construireSourceFalaises +
                       couleurFalaisePourMode (couche native), légende
    labels.js        → libellés de site/secteur sur la carte
    donnees.js       → lecture GeoJSON, agrégats, prédicats de visibilité
    hors-ligne.js    → « Préparer le hors-ligne » : pré-chargement des tuiles
                       de la zone (voir "Hors-ligne")
    utils.js         → escapeHtml (sûr en attribut) + urlSure (schémas
                       autorisés pour les href issus des données)
docs/
  architecture.md    → jetons de design, seuil de bascule mobile (640 px)
vallee-drome-diois/          → un dossier par LIEU, pas par sortie : les falaises
                       ne bougent pas, la date et le gîte si
    index.html       → page carte de ce lieu
    data.geojson     → falaises + parkings, version LÉGÈRE (sans le détail des
                       voies, compteurs précalculés) — généré depuis une base DuckDB
    routes/          → détail des voies, 1 fichier par SITE (chargé à la
                       demande à l'ouverture de la popup d'une de ses falaises)
```

`maplibre-gl` 6.20.0 est copié dans `assets/vendor/maplibre/` (voir « Mise à
jour de MapLibre »), servi par le site et **pré-caché par le service worker**.

## Tests

```sh
npm install             # une fois (Playwright, dépendance de TEST uniquement)
npm run test:statique   # ~0,1 s, sans navigateur
npm test                # + parcours navigateur (~3 min, connexion requise)
```

Chaque test correspond à une régression réellement survenue, pas à une
couverture théorique — détail et raisons dans [`tests/LISEZMOI.md`](tests/LISEZMOI.md).
Le réflexe le plus rentable : lancer `npm run test:statique` avant un commit,
il attrape à lui seul la perte des temps de trajet, un module oublié au
pré-cache et une régression de contraste.

Playwright n'est utilisé que par les tests : **le site reste sans dépendance**
(aucun `node_modules` en production, MapLibre est copié dans le dépôt). Le
déploiement ne fait que retirer les commentaires du JS, du CSS et du HTML
(`outils/construire-site.js`, voir « Déployer sur GitHub Pages »). Pour
développer, un simple serveur statique sur le dépôt suffit.

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
2. Paramètres du repo → Pages → Source : **GitHub Actions**.
3. Chaque push sur `main` lance `.github/workflows/pages.yml` : tests
   statiques, puis `outils/construire-site.js`, puis publication de `_site/`.
4. Le site est en ligne à `https://<utilisateur>.github.io/<repo>/`.

`npm run build` produit le même `_site/` en local. Il copie le dépôt sans les
fichiers de `_config.yml` (liste `exclude`) et retire les commentaires du JS,
du CSS et du HTML (environ 92 Ko sur le fil par visite, pour 41 Ko de code).
Rien d'autre n'est transformé : les données et la copie de MapLibre
(`assets/vendor/`) sont publiées à l'octet près. Pour lancer les tests de
parcours sur ce qui est réellement publié :
`SITE_RACINE=_site npm run test:parcours`.

### Domaine `tokelau.fr`
                                                
Hébergement inchangé (GitHub Pages) : le domaine ne fait que pointer vers lui.
Le fichier `CNAME` à la racine porte le domaine ; GitHub le lit à chaque
déploiement et redirige l'ancienne adresse `github.io`. « Enforce HTTPS »
s'active dans les réglages Pages une fois le certificat émis.

Zone DNS chez le registrar, sous-domaine vide (racine) :

| type | valeurs |
|---|---|
| `A` | 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153 |
| `AAAA` | 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153 |
| `CNAME` | `www` → `bellice.github.io.` |

`robots.txt` + balise `<meta name="robots">` sur chaque page empêchent l'indexation
par les moteurs de recherche. Ça ne rend pas le site privé : l'URL reste accessible
à quiconque la connaît (repo public → Pages public). Pour une vraie restriction
d'accès, il faudrait un repo privé + GitHub Pages payant, ou un mot de passe côté
serveur — hors de portée d'un site statique gratuit.

### La CSP, et pourquoi elle est en `<meta>`

GitHub Pages n'autorise aucun en-tête HTTP personnalisé : la politique est
donc déclarée en `<meta http-equiv>` dans chaque page. C'est de la défense en
profondeur — le site construit du HTML à partir des données (`innerHTML` dans
`popups.js`) ; si une valeur douteuse franchissait un jour `escapeHtml` /
`urlSure` (`utils.js`), la CSP empêcherait encore l'exécution.

Directive par directive, ce qui n'est pas évident :

- **Aucune origine de CDN.** MapLibre est servi par le site
  (`assets/vendor/maplibre/`), donc `script-src`, `style-src`, `connect-src`,
  `worker-src` et `child-src` n'en citent aucune. La seule origine tierce
  restante est `tiles.openfreemap.org` (tuiles et style du fond de carte).
- **`worker-src` est `'self'` seul.** MapLibre charge
  `maplibre-gl-worker.mjs` depuis son URL de même origine, sans blob. Une
  directive trop stricte laisse la carte **vide et silencieuse** : une
  violation CSP survenue dans un worker ne remonte pas au document, donc rien
  n'apparaît en console. Un test statique verrouille la directive.
- **`img-src` garde `blob:`.** MapLibre décode certaines images PNG par une
  URL `blob:`.
- **`style-src` n'autorise pas `'unsafe-inline'`.** MapLibre 6.20.0 écrit ses
  styles par CSSOM (`el.style.x = …`), que la CSP autorise toujours : un
  parcours complet sur Chromium, Firefox et WebKit ne produit aucune
  violation. Ce qui est refusé, c'est un attribut `style="…"` injecté par
  `innerHTML` ou `setAttribute('style', …)` : il est ignoré en silence. Pour
  fixer une taille ou une couleur depuis le JS, poser une variable CSS avec
  `style.setProperty` (exemple : `--taille-cercle` dans `symboles.js`). Un test
  statique interdit ces attributs dans le code, un test de parcours écoute les
  violations.
- **`script-src` s'en passe**, parce que les deux anciens scripts inline ont
  été externalisés (`demarrer-accueil.js`, `demarrer-sortie.js`).
- **`frame-ancestors` est absent volontairement** : la directive est ignorée
  en `<meta>` (elle exige un vrai en-tête). L'anti-clickjacking reste donc
  hors de portée ici.
- La page d'accueil, purement statique, applique une politique plus stricte
  encore : aucune origine tierce.

## Mise à jour de MapLibre

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
