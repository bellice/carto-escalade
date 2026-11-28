# Architecture

Notes de conception qui ne tiennent pas dans un commentaire de code. Les règles
du projet sont dans [`CLAUDE.md`](../CLAUDE.md) et [regles.md](regles.md).

## Structure

```
index.html          → page d'accueil, liste des lieux
sw.js                → service worker : pré-cache de la coquille + données,
                       stale-while-revalidate pour les deux + cache-first
                       pour les tuiles du fond (voir hors-ligne.md)
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
    bouton-gps.js    → Custom Element <bouton-gps> : copie des coordonnées GPS
    poignee-fiche.js → Custom Element <poignee-fiche> : poignée de repli de la fiche mobile
    champs-fiche.js  → colonnes et lignes d'information de la fiche
    histogramme.js   → histogramme « 1 case = 1 voie » des cotations
    detail-voies.js  → liste détaillée des voies (tri cotation / position)
    symboles.js      → cercles proportionnels : construireSourceFalaises +
                       couleurFalaisePourMode (couche native), légende
    labels.js        → libellés de site/secteur sur la carte
    donnees.js       → lecture GeoJSON, agrégats, prédicats de visibilité
    hors-ligne.js    → « Préparer le hors-ligne » : pré-chargement des tuiles
                       de la zone (voir hors-ligne.md)
    utils.js         → escapeHtml (sûr en attribut) + urlSure (schémas
                       autorisés pour les href issus des données)
docs/
  regles.md          → règles du projet : repli sans JavaScript, Custom Elements
  contribuer.md      → conventions de commit, ajouter un lieu
  maplibre.md        → mise à jour de MapLibre
  architecture.md    → structure, rendu des falaises, CSP, jetons de design,
                       seuil de bascule mobile (640 px), limites de mesure
                       (cache, service worker, WebKit)
  tests.md           → lancer les tests, ce qu'ils couvrent
  deploiement.md     → GitHub Pages, domaine tokelau.fr
  donnees.md         → schéma de data.geojson
  hors-ligne.md      → service worker, « Préparer le hors-ligne », fond de carte
vallee-drome-diois/          → un dossier par LIEU, pas par sortie : les falaises
                       ne bougent pas, la date et le gîte si
    index.html       → page carte de ce lieu
    data.geojson     → falaises + parkings, version LÉGÈRE (sans le détail des
                       voies, compteurs précalculés) — généré depuis une base DuckDB
    routes/          → détail des voies, 1 fichier par SITE (chargé à la
                       demande à l'ouverture de la popup d'une de ses falaises)
```

`maplibre-gl` 6.20.0 est copié dans `assets/vendor/maplibre/` (voir [Mise à
jour de MapLibre](maplibre.md)), servi par le site et **pré-caché par le service worker**.

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

## La CSP, et pourquoi elle est en `<meta>`

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

## Jetons de design

`assets/css/tokens.css` contient les variables de design (palette, ombres,
typographie, formes, dimensions de mise en page) et rien d'autre. Chaque page la
charge en premier, avant `assets/style.css` et avant les feuilles de la page
carte. Un test statique vérifie que `style.css` ne définit aucune variable et
qu'aucune feuille ne porte de couleur en dur.

Pour ajouter une couleur ou une ombre, la déclarer dans `tokens.css` et
l'utiliser par `var(--nom)`.

## Seuil de bascule mobile : 640 px

Le site n'a qu'un seuil : jusqu'à 640 px de large, c'est le mobile, à partir de
641 px c'est le bureau. Une variable CSS n'est pas utilisable dans une
`@media`, donc la valeur est écrite en dur à chaque endroit.

| Écriture | Où |
|---|---|
| `@media (max-width: 640px)` | `assets/style.css`, `assets/css/adaptations.css`, `assets/css/bascule-mobile.css`, `assets/css/fiche-mobile.css` |
| `@media (min-width: 641px)` | `assets/css/mise-en-page.css` (deux fois) |
| `matchMedia('(max-width: 640px)')` | `assets/js/carte-utils.js` |

Le 641 complète le 640 : `max-width: 640px` et `min-width: 641px` se partagent
toutes les largeurs sans chevauchement. Le test statique exige 640 pour tout
`max-width`, 641 pour tout `min-width`, et que cette page cite chaque fichier
concerné. Changer le seuil oblige à modifier toutes les lignes du tableau, le
commentaire de `tokens.css` et ce test.

## Limites de mesure

Notes sur les mesures de cache et de réseau faites en local. Elles évitent de
reprendre un chiffre produit par le banc plutôt que par le site. Mesures du
28 novembre 2026, sur `vallee-drome-diois`, avec Playwright (Chromium, Firefox,
WebKit). Le banc (un serveur statique qui reproduit les en-têtes de GitHub
Pages et journalise chaque requête reçue) n'est pas versionné.

### 1. Le certificat HTTPS auto-signé fausse Chromium

Un banc en HTTPS avec un certificat auto-signé a fait apparaître, sur
Chromium, environ 540 Ko et 42 requêtes retéléchargés à chaque 2e visite.
Même serveur, mêmes en-têtes, un seul facteur qui change :

| Chromium, service worker actif, 2e visite | Requêtes | Statut | Octets reçus |
|---|---|---|---|
| HTTPS, certificat auto-signé | 42 | 42 × 200 | 541 053 |
| HTTP simple | 41 | 41 × 304 | 0 |

L'explication retenue : Chromium ne met pas en cache HTTP les réponses d'une
page à erreur de certificat. Elle n'a pas été vérifiée dans le code de Chromium,
mais c'est la seule variable modifiée entre les deux séries. Le site n'a pas ce
défaut. Pour mesurer le cache : HTTP simple en local, ou le site publié avec son
vrai certificat (en production, environ 1,4 Ko transférés par le service worker
sur Chromium, 0 octet sur Firefox, relevé côté client).

### 2. WebKit sous Playwright n'est pas Safari

Le WebKit de Playwright sous Windows est un build de test. Ses mesures ne
valent pas pour Safari :

- il n'envoie aucune requête conditionnelle (ni `If-None-Match` ni
  `If-Modified-Since`), même en HTTP et même sans service worker, donc jamais
  de 304 ;
- il retélécharge tout dans un nouvel onglet (44 requêtes, 550 Ko), alors que
  la même page, rechargée ou rouverte dans l'onglet, n'en demande que 3 ou 4 ;
- Tab ne place pas le focus sur les liens. Safari fait de même par défaut
  (Option + Tab), donc les tests clavier donnent le focus par programme avant de
  tabuler.

Safari réel n'est pas testé.

### 3. Les revalidations du service worker sont voulues

À chaque chargement, le service worker revalide les ressources locales (hors
navigation) avec `fetch(requete, { cache: 'no-cache' })`
(`repondreEnRevalidant`, `sw.js`). Cela fait de 30 à 45 requêtes par visite,
toutes en 304, sans octet de corps, selon le moteur. Le choix est assumé : une
entrée périmée du cache HTTP ne masque jamais une mise à jour du site (voir le
commentaire de la fonction). Le coût se compte en allers-retours et ne
comprend aucun octet de corps. À optimiser seulement si une latence est mesurée sur un mobile réel.

### 4. Ce que GitHub Pages impose

Relevé sur `tokelau.fr` : `Cache-Control: max-age=600`, ETag faible,
`Last-Modified`, `Expires`, `Vary: Accept-Encoding`. Les requêtes
conditionnelles (`If-None-Match` faible ou fort, `If-Modified-Since`) reçoivent
bien un 304. GitHub Pages n'accepte aucun en-tête personnalisé (pas de
`_headers`, rien dans `_config.yml`), donc rien à corriger côté hébergement.

### 5. Les 18 combinaisons mesurées

3 moteurs × avec ou sans service worker × 3 façons de faire la 2e visite
(rechargement, navigation depuis l'accueil, nouvel onglet). Chaque cellule :
requêtes reçues par le serveur, statut, octets de corps de la 2e visite.

| Moteur | Service worker | 2e visite | HTTPS auto-signé | HTTP simple |
|---|---|---|---|---|
| Chromium | actif | rechargement | 45 × 200, 543 Ko | 45 × 304, 0 |
| Chromium | actif | navigation | 42 × 200, 541 Ko | 41 × 304, 0 |
| Chromium | actif | nouvel onglet | 45 × 200, 543 Ko | 44 × 304, 0 |
| Chromium | bloqué | rechargement | 3 × 200, 176 Ko | 1 × 304, 0 |
| Chromium | bloqué | navigation | 3 × 200, 176 Ko | aucune requête |
| Chromium | bloqué | nouvel onglet | 42 × 200, 538 Ko | aucune requête |
| Firefox | actif | rechargement | 32 × 304, 0 | 32 × 304, 0 |
| Firefox | actif | navigation | 31 × 304, 0 | 31 × 304, 0 |
| Firefox | actif | nouvel onglet | 44 × 304, 0 | 44 × 304, 0 |
| Firefox | bloqué | rechargement | 1 × 304, 0 | 1 × 304, 0 |
| Firefox | bloqué | navigation | aucune requête | aucune requête |
| Firefox | bloqué | nouvel onglet | aucune requête | aucune requête |
| WebKit | actif | rechargement | 45 × 200, 552 Ko | 46 × 200, 553 Ko |
| WebKit | actif | navigation | 45 × 200, 552 Ko | 46 × 200, 553 Ko |
| WebKit | actif | nouvel onglet | 45 × 200, 552 Ko | 46 × 200, 553 Ko |
| WebKit | bloqué | rechargement | 4 × 200, 27 Ko | 4 × 200, 27 Ko |
| WebKit | bloqué | navigation | 3 × 200, 23 Ko | 3 × 200, 23 Ko |
| WebKit | bloqué | nouvel onglet | 44 × 200, 550 Ko | 44 × 200, 550 Ko |

Conclusion. En HTTP, Chromium et Firefox ne reçoivent aucun octet de corps à la
2e visite ; en HTTPS auto-signé, Chromium en reçoit 541 Ko. La différence vient
du certificat. Les lignes WebKit relèvent du point 2 et ne se lisent pas comme
Safari.
