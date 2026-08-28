// generer-icones.js — fabrique les icônes du manifeste depuis le SVG du
// favicon. À relancer seulement si l'identité visuelle change :
//
//   node outils/generer-icones.js
//
// Playwright sert ici de moteur de rendu : il est déjà une dépendance de
// test, ce qui évite d'ajouter sharp/canvas juste pour quatre fichiers.
//
// Ce sont les SEULS bitmaps du site. Ils ne sont jamais sur le chemin de
// rendu d'une page : le navigateur ne les récupère qu'à l'installation.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLAY = '#a8452f';   // --clay
const PAPER = '#fbfaf6';  // --paper

// ratio = diamètre du disque rapporté au côté de l'icône. Android rogne les
// icônes « maskable » selon une forme qui varie d'un lanceur à l'autre :
// seuls les ~80 % centraux sont garantis visibles, d'où un disque nettement
// plus petit pour cette variante-là.
const CIBLES = [
  ['icone-192.png', 192, 0.84],
  ['icone-512.png', 512, 0.84],
  ['icone-maskable-512.png', 512, 0.56],
  ['apple-touch-icon.png', 180, 0.84],
];

const svg = (taille, ratio) => `
<style>html,body{margin:0;padding:0}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${taille}" height="${taille}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${PAPER}"/>
  <circle cx="50" cy="50" r="${ratio * 50}" fill="${CLAY}"/>
</svg>`;

const navigateur = await chromium.launch({ args: ['--no-sandbox'] });
for (const [nom, taille, ratio] of CIBLES) {
  const page = await navigateur.newPage({
    viewport: { width: taille, height: taille },
    deviceScaleFactor: 1,
  });
  await page.setContent(svg(taille, ratio));
  await page.locator('svg').screenshot({ path: join(RACINE, 'icones', nom) });
  console.log(`icones/${nom} — ${taille}px`);
  await page.close();
}
await navigateur.close();
