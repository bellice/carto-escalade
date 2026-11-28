# Tests

```sh
npm install             # une fois (Playwright, dépendance de TEST uniquement)
npm run test:statique   # ~0,1 s, sans navigateur
npm test                # + parcours navigateur (~3 min, connexion requise)
```

Chaque test correspond à une régression réellement survenue, pas à une
couverture théorique — détail et raisons dans [`tests/LISEZMOI.md`](../tests/LISEZMOI.md).
Le réflexe le plus rentable : lancer `npm run test:statique` avant un commit,
il attrape à lui seul la perte des temps de trajet, un module oublié au
pré-cache et une régression de contraste.

Les mesures de cache et de réseau faites en local ont des limites (certificat
auto-signé, WebKit de Playwright) : voir [Limites de mesure](architecture.md#limites-de-mesure).

Playwright n'est utilisé que par les tests : **le site reste sans dépendance**
(aucun `node_modules` en production, MapLibre est copié dans le dépôt). Le
déploiement ne fait que retirer les commentaires du JS, du CSS et du HTML
(`outils/construire-site.js`, voir [Déployer sur GitHub Pages](deploiement.md)). Pour
développer, un simple serveur statique sur le dépôt suffit.

Écrire un test : [Ajouter un test](../tests/LISEZMOI.md#ajouter-un-test).
