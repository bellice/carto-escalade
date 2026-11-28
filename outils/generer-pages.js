// generer-pages.js — produit les pages carte (<lieu>/index.html) à partir de
// outils/gabarit-carte.html et outils/lieux.json.
//
//   node outils/generer-pages.js --ecrire     écrit les pages
//   node outils/generer-pages.js --verifier   sort en erreur si une page diffère
//
// Les pages générées restent dans le dépôt : un simple serveur statique suffit
// pour développer. Le test statique appelle --verifier, qui échoue dès qu'une
// page a été modifiée à la main ou qu'un gabarit n'a pas été régénéré.
//
// Sans dépendance : Node seul. Syntaxe des marqueurs dans gabarit-carte.html.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const echapper = (texte) => texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Commentaire HTML sur plusieurs lignes, aligné sous le marqueur : la première
// ligne suit "<!-- ", les suivantes s'alignent sur elle.
function formaterCommentaire(lignes, indentation) {
  const marge = ' '.repeat(indentation.length + '<!-- '.length);
  const corps = lignes.map((ligne, i) => (i === 0 ? indentation + '<!-- ' : marge) + ligne);
  corps[corps.length - 1] += ' -->';
  return corps.join('\n');
}

function verifierLieu(lieu, i) {
  const nom = `lieux.json[${i}]`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(lieu.slug ?? '')) throw new Error(`${nom} : slug invalide (« ${lieu.slug} »), il sert de nom de dossier`);
  for (const champ of ['titreLong', 'titreCourt']) {
    if (typeof lieu[champ] !== 'string' || !lieu[champ].trim()) throw new Error(`${nom} (${lieu.slug}) : ${champ} manquant`);
  }
  const commentaire = lieu.commentaire;
  if (commentaire !== undefined) {
    if (!Array.isArray(commentaire) || !commentaire.length || commentaire.some((l) => typeof l !== 'string')) {
      throw new Error(`${nom} (${lieu.slug}) : commentaire doit être un tableau non vide de lignes`);
    }
    if (commentaire.some((l) => l.includes('--'))) throw new Error(`${nom} (${lieu.slug}) : « -- » interdit dans un commentaire HTML`);
  }
}

// Renvoie [{ slug, chemin, html }] pour chaque lieu de lieux.json.
export function genererPages(racine = RACINE) {
  const brut = readFileSync(join(racine, 'outils/gabarit-carte.html'), 'utf8').replace(/\r\n/g, '\n');
  // Tout ce qui précède <!DOCTYPE est la documentation du gabarit.
  const debut = brut.search(/^<!DOCTYPE html>/m);
  if (debut < 0) throw new Error('gabarit-carte.html : ligne <!DOCTYPE html> introuvable');
  const gabarit = brut.slice(debut);

  const lieux = JSON.parse(readFileSync(join(racine, 'outils/lieux.json'), 'utf8'));
  const slugs = new Set();
  return lieux.map((lieu, i) => {
    verifierLieu(lieu, i);
    if (slugs.has(lieu.slug)) throw new Error(`lieux.json : slug en double (${lieu.slug})`);
    slugs.add(lieu.slug);

    const html = gabarit
      .replace(/^( *)\{\{commentaire\}\}\n/m, (_, indentation) => (
        lieu.commentaire ? formaterCommentaire(lieu.commentaire, indentation) + '\n' : ''))
      .replaceAll('{{titreLong}}', echapper(lieu.titreLong))
      .replaceAll('{{titreCourt}}', echapper(lieu.titreCourt));
    const reste = /\{\{[^}]*\}\}/.exec(html);
    if (reste) throw new Error(`gabarit-carte.html : marqueur inconnu ${reste[0]}`);
    return { slug: lieu.slug, chemin: `${lieu.slug}/index.html`, html };
  });
}

function lireOuNull(chemin) {
  try { return readFileSync(chemin, 'utf8'); } catch { return null; }
}

function premiereDifference(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = la.findIndex((ligne, i) => ligne !== lb[i]);
  return n < 0 ? Math.min(la.length, lb.length) + 1 : n + 1;
}

function ecrire(pages, racine) {
  let modifiees = 0;
  for (const page of pages) {
    const chemin = join(racine, page.chemin);
    if (lireOuNull(chemin) !== page.html) modifiees++;
    mkdirSync(dirname(chemin), { recursive: true });
    writeFileSync(chemin, page.html);
  }
  console.log(`${pages.length} pages carte écrites, ${modifiees} modifiée(s).`);
}

function verifier(pages, racine) {
  const derives = [];
  for (const page of pages) {
    const actuel = lireOuNull(join(racine, page.chemin));
    if (actuel === null) derives.push(`${page.chemin} : fichier absent`);
    else if (actuel !== page.html) derives.push(`${page.chemin} : diffère du gabarit à partir de la ligne ${premiereDifference(actuel, page.html)}`);
  }
  if (derives.length) {
    console.error(`Pages carte en dérive :\n  ${derives.join('\n  ')}\nCorriger outils/gabarit-carte.html ou outils/lieux.json, puis lancer : npm run generer`);
    process.exitCode = 1;
    return;
  }
  console.log(`${pages.length} pages carte à jour.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode !== '--ecrire' && mode !== '--verifier') {
    console.error('Usage : node outils/generer-pages.js --ecrire | --verifier');
    process.exit(2);
  }
  try {
    const pages = genererPages();
    (mode === '--ecrire' ? ecrire : verifier)(pages, RACINE);
  } catch (erreur) {
    console.error(erreur.message);
    process.exit(1);
  }
}
