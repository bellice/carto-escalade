# Architecture

Notes de conception qui ne tiennent pas dans un commentaire de code. Les règles
du projet sont dans [`CLAUDE.md`](../CLAUDE.md) et le [README](../README.md).

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
