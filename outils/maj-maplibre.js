// maj-maplibre.js — met à jour la copie locale de MapLibre (assets/vendor/maplibre/).
//
//   node outils/maj-maplibre.js 6.20.0
//
// Télécharge le paquet npm de cette version, vérifie son intégrité (sha512)
// contre celle que publie le registre, puis copie uniquement ce que le site
// charge : le module, le worker, la feuille de style, la licence, et le
// fichier partagé si un module le référence. Ni sourcemaps ni variantes -dev.
//
// Node seul, aucune dépendance : un tar est lu à la main. Le réseau n'est
// utilisé que par ce script, jamais par le site ni par les tests.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINATION = join(RACINE, 'assets/vendor/maplibre');
const REGISTRE = 'registry.npmjs.org';

const MODULES = ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs'];
const FEUILLE = 'maplibre-gl.css';
const PARTAGE = 'maplibre-gl-shared.mjs';
const LICENCE = 'LICENSE.txt';

function echouer(message) {
  console.error(`Échec : ${message}`);
  process.exit(1);
}

// Fichiers ordinaires d'une archive tar : nom complet -> contenu. Gère les
// noms longs (en-têtes GNU « L » et pax « x »), sans lien ni dossier.
function extraireTar(tar) {
  const fichiers = new Map();
  let position = 0;
  let nomLong = null;
  while (position + 512 <= tar.length) {
    const entete = tar.subarray(position, position + 512);
    if (entete.every((octet) => octet === 0)) break;
    const champ = (debut, fin) => entete.toString('utf8', debut, fin).replace(/\0[\s\S]*$/, '');
    const taille = parseInt(champ(124, 136).trim() || '0', 8);
    const type = champ(156, 157);
    const prefixe = champ(345, 500);
    const debutDonnees = position + 512;
    const donnees = tar.subarray(debutDonnees, debutDonnees + taille);
    position = debutDonnees + Math.ceil(taille / 512) * 512;

    if (type === 'x') {
      nomLong = /\d+ path=([^\n]+)\n/.exec(donnees.toString('utf8'))?.[1] ?? nomLong;
      continue;
    }
    if (type === 'L') { nomLong = donnees.toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === 'g') continue;
    const nom = nomLong ?? ((prefixe ? `${prefixe}/` : '') + champ(0, 100));
    nomLong = null;
    if (type === '0' || type === '') fichiers.set(nom, Buffer.from(donnees));
  }
  return fichiers;
}

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage : node outils/maj-maplibre.js <version>   (exemple : 6.20.0)');
  process.exit(2);
}

console.log(`MapLibre ${version} : lecture du registre npm`);
const reponse = await fetch(`https://${REGISTRE}/maplibre-gl/${version}`);
if (!reponse.ok) echouer(`version introuvable sur le registre (HTTP ${reponse.status})`);
const meta = await reponse.json();
if (meta.version !== version) echouer(`le registre renvoie la version ${meta.version}`);
const adresse = new URL(meta.dist.tarball);
if (adresse.hostname !== REGISTRE) echouer(`archive hors du registre npm (${adresse.hostname})`);

const archive = await fetch(adresse);
if (!archive.ok) echouer(`téléchargement impossible (HTTP ${archive.status})`);
const tarball = Buffer.from(await archive.arrayBuffer());
const obtenu = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
console.log(`  archive     ${tarball.length} octets`);
console.log(`  integrity   attendue ${meta.dist.integrity.slice(0, 40)}...`);
console.log(`              obtenue  ${obtenu.slice(0, 40)}...`);
if (obtenu !== meta.dist.integrity) echouer('integrity différente de celle du registre, rien n\'est copié');
console.log('  integrity   conforme');

const paquet = extraireTar(gunzipSync(tarball));
const lire = (nom) => paquet.get(`package/${nom}`) ?? echouer(`${nom} absent de l'archive`);

const dist = new Map([...MODULES, FEUILLE].map((nom) => [nom, lire(`dist/${nom}`)]));
if (MODULES.some((nom) => dist.get(nom).includes(PARTAGE))) dist.set(PARTAGE, lire(`dist/${PARTAGE}`));
dist.set(LICENCE, lire(LICENCE));

mkdirSync(DESTINATION, { recursive: true });
for (const existant of readdirSync(DESTINATION)) {
  if (!dist.has(existant)) { rmSync(join(DESTINATION, existant)); console.log(`  retiré      ${existant}`); }
}
console.log(`Copie dans assets/vendor/maplibre/ :`);
for (const [nom, contenu] of dist) {
  writeFileSync(join(DESTINATION, nom), contenu);
  const empreinte = createHash('sha384').update(contenu).digest('base64');
  console.log(`  ${nom.padEnd(26)} ${String(contenu.length).padStart(8)} octets  sha384-${empreinte.slice(0, 16)}...`);
}
if (!dist.has(PARTAGE)) console.log(`  (${PARTAGE} n'est référencé par aucun module de cette version : non copié)`);

console.log(`
À faire ensuite :
  - sw.js : CACHE_NAME +1, et l'entrée du worker avec ?v=${version}
  - npm test
  - README : version citée dans « Mise à jour de MapLibre »`);
