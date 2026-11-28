# Tokelau

Topo d'escalade : une carte par lieu (falaises et parkings), sans backend, pour
préparer une sortie et la consulter au pied de la falaise, avec peu ou pas de
réseau. En ligne : <https://tokelau.fr>.

## Démarrage rapide

```sh
git clone https://github.com/bellice/carto-escalade.git
cd carto-escalade
python -m http.server 8000      # puis http://localhost:8000/
```

Le site n'a ni dépendance ni étape de build en développement : un serveur
statique sur le dépôt suffit. Pour lancer les tests : `npm install` une fois,
puis `npm run test:statique` (~2 s) ou `npm test` (avec les parcours
navigateur). Détails dans [docs/tests.md](docs/tests.md).

## Structure

```
index.html            page d'accueil, liste des lieux
sw.js                 service worker (pré-cache, hors-ligne)
assets/               style.css, css/ (feuilles), js/ (modules ES), vendor/maplibre/
<lieu>/               un dossier par lieu : index.html, data.geojson, routes/
docs/                 documentation
outils/               génération des pages, build, mise à jour de MapLibre
tests/                tests statiques et tests de parcours (Playwright)
```

L'arborescence détaillée, fichier par fichier, est dans
[docs/architecture.md](docs/architecture.md#structure).

## Documentation

- [Règles du projet](docs/regles.md) : repli sans JavaScript, Custom Elements et Shadow DOM.
- [Contribuer](docs/contribuer.md) : conventions de commit, ajouter un lieu.
- [Architecture](docs/architecture.md) : structure détaillée, rendu des falaises, CSP,
  jetons de design, seuil de bascule mobile, [limites de mesure](docs/architecture.md#limites-de-mesure)
  (certificat auto-signé, WebKit de Playwright).
- [Tests](docs/tests.md) : lancer les tests, ce qu'ils couvrent, en ajouter un.
- [MapLibre](docs/maplibre.md) : mise à jour de la copie locale.
- [Déploiement](docs/deploiement.md) : GitHub Pages, domaine `tokelau.fr`.
- [Schéma des données](docs/donnees.md) : format de `data.geojson`.
- [Hors-ligne et fond de carte](docs/hors-ligne.md) : service worker, « Préparer le hors-ligne », bande passante.
- [Charte graphique](charte-graphique.html) : palette, typographie et composants, à
  ouvrir directement dans un navigateur (elle s'appuie sur les vraies feuilles
  de style du site).

## Licence

- Code : [MIT](LICENSE). La copie de MapLibre GL JS (`assets/vendor/maplibre/`)
  garde sa licence BSD-3-Clause.
- Données : positions, temps d'approche et regroupement en sites et secteurs
  sous [CC BY-NC-SA 4.0](LICENSE-donnees). Les noms de voies, cotations,
  longueurs, types de roche et orientations issus des topos n'en font pas
  partie : ils restent sous les droits de leurs éditeurs.
