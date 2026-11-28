# Règles du projet

Le site s'appuie sur les standards du web : HTML sémantique, CSS natif,
JavaScript en modules ES, aucune dépendance en production. Ces règles
complètent celles de [`CLAUDE.md`](../CLAUDE.md) (contraintes techniques,
écriture, attribution).

## Fonctionne sans JavaScript

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

## Composants (Custom Elements)

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

Les composants sont `<bouton-gps>` (`assets/js/bouton-gps.js`) et
`<poignee-fiche>` (`assets/js/poignee-fiche.js`) : chacun enveloppe un vrai
`<button>` écrit dans le HTML et lui ajoute son comportement. `<poignee-fiche>`
ne décide pas de l'état de la fiche : il émet `basculer-fiche` et observe
l'attribut `reduite`, que l'application lui rend. Un
composant vit à plat dans `assets/js/`, comme les autres modules : plusieurs
tests lisent ce dossier sans descendre dans les sous-dossiers.
