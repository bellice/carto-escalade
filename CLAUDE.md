# Règles du projet

Topo d'escalade statique (tokelau.fr, GitHub Pages). Ce fichier documente les
contraintes transversales, rattachées à aucune ligne de code précise — les
contraintes locales (pourquoi cette valeur, ce piège CSP, ce couplage entre
deux fichiers) restent en commentaire au plus près du code qu'elles
protègent, pas ici.

## Contraintes techniques

- **Pas d'icônes.** Le vocabulaire visuel du site est textuel (mono, badges,
  pastilles de couleur), jamais en pictogrammes.
- **Cibles tactiles 44px minimum** sur pointeur grossier (`@media
  (pointer: coarse)`), partout où une action est cliquable.
- **Site sans dépendance, sans étape de build.** Ce qui est dans le dépôt est
  ce qui est servi à l'octet près (voir `_config.yml`). Pas de bundler, pas
  de transpileur, pas de `node_modules` en production.
- **`npm test` (97 tests) avant tout push.** Deux suites : `test:statique`
  (structure du dépôt, `_config.yml`, service worker) et `test:parcours`
  (Playwright, bout en bout).

## Écriture

- **Aucune mention de Claude ou Anthropic** dans un commit, une PR, ou le
  contenu publié du site. Un garde-fou mécanique bloque les commits/PR
  concernés (`.claude/hooks/bloquer-mention-ia.sh`) ; il ne couvre pas
  `git commit -F fichier` (limite connue, acceptée : ce dépôt n'utilise pas
  cette forme).
- **Style non-IA dans toute prose écrite pour le site** (pages, commentaires
  compris) : pas de tournure « n'est pas X, c'est Y », pas de tiret comme
  chute de phrase. Un tiret double reste légitime pour un aparté technique
  factuel (une mesure, un renvoi vers un autre fichier) — voir le grand
  ménage de septembre 2026 dans l'historique git pour des exemples des deux
  cas.
- **Commentaires HTML/CSS concis.** Un commentaire qui empêche une
  régression silencieuse (piège CSP, couplage entre ce HTML et un
  sélecteur JS/CSS ailleurs, une mesure qui justifie une valeur qui a
  l'air arbitraire) reste dans le fichier — mais dit le fait, pas
  l'historique de la réflexion qui y a mené. Pas de mots ou phrases entières
  en MAJUSCULES pour l'emphase (sauf acronyme réel : CSP, WCAG, DOM...) ;
  une majuscule ne remplace pas une reformulation plus courte.
- Un choix de mot ou de formulation (pourquoi ce texte plutôt qu'un autre)
  documenté dans [redaction.html](redaction.html), pas en commentaire dans
  le HTML — sauf si sa perte casserait autre chose qu'une phrase.

## Attribution

Aucune ligne d'attribution (`Co-Authored-By`, etc.) dans les commits ou PR.
