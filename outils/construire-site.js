// construire-site.js — prépare le dossier publié (par défaut _site/).
//
//   node outils/construire-site.js [destination]
//
// Copie le dépôt sans les fichiers que _config.yml exclut, et retire les
// commentaires du JS, du CSS et du HTML. Rien d'autre : pas de renommage, pas
// de réécriture, pas de réduction des espaces. Les commentaires pèsent plus
// que le code (sur le fil, environ 92 Ko contre 41 Ko), et les fichiers du
// dépôt restent la source commentée, testée telle quelle.
//
// Sans dépendance : Node seul. Les données (geojson, json) sont copiées sans
// être modifiées.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Jamais publiés, quoi que dise _config.yml.
const TOUJOURS_EXCLUS = ['.git', '.github', '.claude', '.vite', '.gitignore', '_site', '_config.yml', 'node_modules'];

const ESPACE_COMMENTAIRE = /[ \t]/;
const MOTS_AVANT_REGEX = new Set(['return', 'typeof', 'case', 'delete', 'void', 'throw', 'in', 'of', 'new', 'else', 'do', 'yield', 'await']);

// Si le commentaire qui vient d'être retiré occupait seul sa ligne, retire
// aussi la ligne (indentation et saut de ligne compris).
function retirerLigneVide(sortie, texte, fin) {
  const debutLigne = Math.max(sortie.lastIndexOf('\n'), -1) + 1;
  if (sortie.slice(debutLigne).trim() !== '') return { sortie, fin };
  let j = fin;
  while (j < texte.length && ESPACE_COMMENTAIRE.test(texte[j])) j++;
  if (texte[j] === '\r') j++;
  if (texte[j] !== '\n' && j < texte.length) return { sortie, fin };
  return { sortie: sortie.slice(0, debutLigne), fin: j < texte.length ? j + 1 : j };
}

export function retirerCommentairesJS(texte) {
  let sortie = '';

  // Parcourt du code jusqu'à la fin du texte, ou jusqu'à l'accolade qui ferme
  // un ${ } de gabarit. Renvoie l'index où il s'arrête.
  function code(i, finSurAccolade) {
    let profondeur = 0;
    let dernier = ''; // dernier caractère significatif, pour trancher division ou regex
    let dernierMot = '';
    while (i < texte.length) {
      const c = texte[i];
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < texte.length && texte[j] !== c) j += texte[j] === '\\' ? 2 : 1;
        sortie += texte.slice(i, j + 1);
        i = j + 1; dernier = '"'; dernierMot = ''; continue;
      }
      if (c === '`') { i = gabarit(i); dernier = '"'; dernierMot = ''; continue; }
      if (c === '/' && texte[i + 1] === '/') {
        let j = texte.indexOf('\n', i);
        if (j < 0) j = texte.length;
        const fin = texte[j - 1] === '\r' ? j - 1 : j;
        sortie = sortie.replace(/[ \t]+$/, '');
        ({ sortie, fin: i } = retirerLigneVide(sortie, texte, fin));
        continue;
      }
      if (c === '/' && texte[i + 1] === '*') {
        const fin = texte.indexOf('*/', i + 2) + 2;
        if (texte[i + 2] === '!') { sortie += texte.slice(i, fin); i = fin; continue; }
        ({ sortie, fin: i } = retirerLigneVide(sortie, texte, fin));
        continue;
      }
      if (c === '/') {
        const regex = dernier === '' || '(,=:[!&|?{};+-*%<>~^'.includes(dernier)
          || (/[A-Za-z]/.test(dernier) && MOTS_AVANT_REGEX.has(dernierMot));
        if (regex) {
          let j = i + 1;
          let classe = false;
          let ok = false;
          while (j < texte.length && texte[j] !== '\n') {
            const d = texte[j];
            if (d === '\\') { j += 2; continue; }
            if (d === '[') classe = true;
            else if (d === ']') classe = false;
            else if (d === '/' && !classe) { ok = true; break; }
            j++;
          }
          if (ok) {
            j++;
            while (/[a-z]/.test(texte[j] || '')) j++;
            sortie += texte.slice(i, j);
            i = j; dernier = '"'; dernierMot = ''; continue;
          }
        }
      }
      if (c === '{') profondeur++;
      if (c === '}') {
        if (finSurAccolade && profondeur === 0) return i;
        profondeur--;
      }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i + 1;
        while (j < texte.length && /[\w$]/.test(texte[j])) j++;
        dernierMot = texte.slice(i, j);
        sortie += dernierMot;
        i = j; dernier = dernierMot[dernierMot.length - 1]; continue;
      }
      sortie += c;
      if (!/\s/.test(c)) { dernier = c; dernierMot = ''; }
      i++;
    }
    return i;
  }

  function gabarit(i) {
    sortie += '`';
    i++;
    while (i < texte.length && texte[i] !== '`') {
      if (texte[i] === '\\') { sortie += texte.slice(i, i + 2); i += 2; continue; }
      if (texte[i] === '$' && texte[i + 1] === '{') {
        sortie += '${';
        i = code(i + 2, true);
        sortie += '}';
        i++;
        continue;
      }
      sortie += texte[i];
      i++;
    }
    sortie += '`';
    return i + 1;
  }

  code(0, false);
  return sortie;
}

export function retirerCommentairesCSS(texte) {
  let sortie = '';
  let i = 0;
  while (i < texte.length) {
    const c = texte[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < texte.length && texte[j] !== c) j += texte[j] === '\\' ? 2 : 1;
      sortie += texte.slice(i, j + 1);
      i = j + 1; continue;
    }
    if (c === '/' && texte[i + 1] === '*') {
      const fin = texte.indexOf('*/', i + 2) + 2;
      ({ sortie, fin: i } = retirerLigneVide(sortie, texte, fin));
      continue;
    }
    sortie += c;
    i++;
  }
  return sortie;
}

export function retirerCommentairesHTML(texte) {
  return texte
    .replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

// Entrées de la liste « exclude: » de _config.yml (une par ligne « - nom »).
export function lireExclusions(configYml) {
  const lignes = configYml.split(/\r?\n/);
  const debut = lignes.findIndex((l) => /^exclude:\s*$/.test(l));
  if (debut < 0) return [];
  const exclusions = [];
  for (const ligne of lignes.slice(debut + 1)) {
    const m = /^\s+-\s+(\S+)\s*$/.exec(ligne);
    if (!m) break;
    exclusions.push(m[1].replace(/\/$/, ''));
  }
  return exclusions;
}

const TRAITEMENTS = {
  '.js': retirerCommentairesJS,
  '.css': retirerCommentairesCSS,
  '.html': retirerCommentairesHTML,
};

export function construire(source, destination) {
  const racine = resolve(source);
  const sortie = resolve(destination);
  if (sortie === racine || racine.startsWith(sortie + sep)) {
    throw new Error(`destination refusée (${sortie}) : elle contient le dépôt`);
  }
  let config = '';
  try { config = readFileSync(join(racine, '_config.yml'), 'utf8'); } catch { /* pas de config : rien d'exclu en plus */ }
  const exclus = new Set([...TOUJOURS_EXCLUS, ...lireExclusions(config)]);

  rmSync(sortie, { recursive: true, force: true });
  const bilan = { fichiers: 0, avant: 0, apres: 0 };

  function copier(dossier) {
    mkdirSync(join(sortie, relative(racine, dossier)), { recursive: true });
    for (const nom of readdirSync(dossier)) {
      const chemin = join(dossier, nom);
      const rel = relative(racine, chemin).split(sep).join('/');
      if (exclus.has(rel)) continue;
      if (statSync(chemin).isDirectory()) { copier(chemin); continue; }
      const extension = nom.slice(nom.lastIndexOf('.'));
      // Code tiers copié tel quel : retirer ses commentaires en changerait les octets.
      const traiter = rel.startsWith('assets/vendor/') ? undefined : TRAITEMENTS[extension];
      const cible = join(sortie, rel);
      bilan.fichiers++;
      if (!traiter) { cpSync(chemin, cible); continue; }
      const original = readFileSync(chemin, 'utf8');
      const resultat = traiter(original);
      writeFileSync(cible, resultat);
      bilan.avant += Buffer.byteLength(original);
      bilan.apres += Buffer.byteLength(resultat);
    }
  }
  copier(racine);
  return bilan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bilan = construire(RACINE, process.argv[2] || join(RACINE, '_site'));
  const ko = (n) => `${(n / 1024).toFixed(0)} Ko`;
  console.log(`${bilan.fichiers} fichiers publiés ; JS, CSS et HTML : ${ko(bilan.avant)} -> ${ko(bilan.apres)}`);
}
