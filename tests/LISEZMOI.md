# Tests de non-régression

Deux niveaux, du plus rapide au plus lent. Lancer le premier coûte 0,1 s : il
n'y a aucune raison de s'en priver avant un commit.

```sh
npm run test:statique   # ~0,1 s, aucun navigateur, aucune dépendance
npm run test:parcours   # ~40 s, Chromium, connexion requise
npm test                # les deux
```

## Pourquoi cette suite existe

Chaque test correspond à une régression **réellement survenue** sur ce projet,
pas à une couverture théorique. Les trois plus coûteuses :

| Régression | Ce qui s'est passé | Test qui la rattrape |
|---|---|---|
| Curseur « trajet depuis le gîte » disparu | `build_db.py` recrée la base et vide `parking_hebergement_trajet`, alimenté uniquement par l'API IGN. `trajet_gite_min` repasse à `null`, le curseur se masque tout seul. | `statique` : parkings sans trajet · `parcours` : curseur proposé |
| Carte entièrement vide hors ligne | Un module ajouté sans être inscrit au `PRECACHE` du service worker : son import échoue au premier chargement hors ligne et fait tomber tout le graphe. | `statique` : modules dans PRECACHE · `parcours` : rechargement hors ligne |
| Détail des voies mort jusqu'au rechargement | Une promesse rejetée restait en cache : un seul raté réseau condamnait tout un site, même après retour de la connexion. | `parcours` : échec puis rattrapage |

## Ce que couvre chaque niveau

**`statique.test.js`** — lecture des fichiers, sans navigateur. Cohérence du
pré-cache, intégrité des données exportées, seuils de contraste WCAG calculés
sur les jetons réels, échappement HTML et filtrage d'URL, structure des pages
(un seul `<h1>`, CSP présente, aucun script inline).

**`parcours.test.js`** — comportement réel dans Chromium. Démarrage sans
erreur ni violation CSP, contenu des fiches, bascule des tris du détail des
voies, résilience réseau (échec, rattrapage, bandeau hors-ligne, rechargement
hors ligne complet), focus clavier, respect de `prefers-reduced-motion`, et
injection via des données piégées.

## Contraintes

- **Connexion requise pour `test:parcours`** : le style du fond vient
  d'OpenFreeMap. Sans réseau, `attendreCarte` échoue en 30 s.
- **Chromium** est téléchargé une fois par `npm install` (cache partagé entre
  projets, `~/AppData/Local/ms-playwright`).
- Playwright est une **dépendance de test uniquement**. Le site lui-même reste
  sans dépendance et sans étape de build : GitHub Pages le sert tel quel.

## Ajouter un test

Le réflexe utile : quand une régression est constatée, écrire d'abord le test
qui la reproduit, vérifier qu'il **échoue**, puis corriger. Un test qui n'a
jamais échoué ne prouve rien — les assertions de cette suite ont toutes été
validées en réintroduisant volontairement le bug correspondant.

Les falaises étant peintes dans une couche native MapLibre (aucun élément DOM
à cliquer), passer par les aides de `aide-carte.js` : `exposerCarte`,
`attendreCarte`, `ouvrirFalaise`, et les repères nommés de `REPERES`.
