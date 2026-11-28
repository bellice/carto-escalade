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
