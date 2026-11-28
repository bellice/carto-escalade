# Déployer sur GitHub Pages

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

## Domaine `tokelau.fr`
                                                
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
