// aide-carte.js — outillage partagé des tests navigateur.
//
// Les falaises sont rendues par une COUCHE NATIVE MapLibre, pas par des
// éléments du DOM : on ne peut donc ni les sélectionner ni cliquer dessus
// avec les sélecteurs habituels de Playwright. D'où les deux artifices ci-
// dessous, isolés ici pour que les tests eux-mêmes restent lisibles :
//   - exposer l'instance de carte (window.__carteTest) en réécrivant carte.js
//     à la volée, plutôt que d'ajouter un point d'entrée de test au site ;
//   - synthétiser un clic sur le canvas aux coordonnées projetées de la
//     falaise visée.

// Repères choisis pour ce qu'ils couvrent, pas au hasard :
export const REPERES = {
  // 44 voies, toutes couennes, topo payant sur une seule page
  lesRoches: { nom: 'Les Roches', coord: [5.029573, 44.738108] },
  // mixte couennes + grandes voies, topo étalé sur trois pages
  laTour: { nom: 'La Tour', coord: [5.07346, 44.65128] },
  // grandes voies, aucune page de topo renseignée
  chironne: { nom: 'Rocher de Chironne', coord: [5.391514, 44.840549] },
};

// Le lieu de RÉFÉRENCE des parcours détaillés ci-dessous. Les REPERES sont des
// falaises drômoises précises, choisies pour ce qu'elles couvrent : ces
// parcours ne se dupliquent donc pas par lieu. C'est LIEUX (ci-dessous) qui
// assure qu'un nouveau lieu démarre, sans rejouer 20 fois le même scénario.
export const CHEMIN_SORTIE = '/vallee-drome-diois/index.html';

// Les lieux publiés, découverts et non énumérés : tout dossier portant un
// data.geojson. Miroir de trouverLieux() dans statique.test.js.
export async function trouverLieux() {
  const { readdir, readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');
  const racine = fileURLToPath(new URL('..', import.meta.url));
  const lieux = [];
  for (const e of await readdir(racine, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    try {
      await readFile(join(racine, e.name, 'data.geojson'), 'utf8');
      lieux.push(e.name);
    } catch { /* pas un dossier de lieu */ }
  }
  return lieux.sort();
}

// Rend l'objet Map accessible depuis les tests. On insère l'affectation juste
// après la construction, dans une copie servie à la volée : le fichier du
// dépôt n'est pas modifié.
export async function exposerCarte(page) {
  await page.route('**/assets/js/carte.js', async (route) => {
    const reponse = await route.fetch();
    const source = await reponse.text();
    const modifie = source.replace(
      /(map = new maplibregl\.Map\(\{[\s\S]*?\n\s*\}\);)/,
      '$1\n      window.__carteTest = map;'
    );
    if (modifie === source) throw new Error('exposerCarte : motif de construction de la carte introuvable — carte.js a changé ?');
    await route.fulfill({ response: reponse, body: modifie });
  });
}

// Attend que la couche des falaises soit réellement posée. C'est le seul
// signal fiable que données ET style sont prêts (le style vient du réseau :
// ces tests supposent une connexion — voir tests/LISEZMOI.md).
export async function attendreCarte(page, delai = 30000) {
  await page.waitForFunction(
    () => Boolean(window.__carteTest && window.__carteTest.getLayer && window.__carteTest.getLayer('falaises')),
    { timeout: delai }
  );
  // Laisse le premier rendu se faire : queryRenderedFeatures ne voit que ce
  // qui a été effectivement peint.
  await page.waitForTimeout(600);
}

// Ouvre la fiche d'une falaise en simulant un clic sur la couche native.
export async function ouvrirFalaise(page, repere) {
  await page.evaluate((c) => window.__carteTest.jumpTo({ center: c, zoom: 16 }), repere.coord);
  await page.waitForTimeout(500);

  const trouvee = await page.evaluate((c) => {
    const projete = window.__carteTest.project(c);
    const boite = [[projete.x - 12, projete.y - 12], [projete.x + 12, projete.y + 12]];
    const entites = window.__carteTest.queryRenderedFeatures(boite, { layers: ['falaises'] });
    if (!entites.length) return false;

    const point = window.__carteTest.project(entites[0].geometry.coordinates);
    const canvas = window.__carteTest.getCanvas();
    const cadre = canvas.getBoundingClientRect();
    const commun = { bubbles: true, clientX: cadre.left + point.x, clientY: cadre.top + point.y, button: 0 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      canvas.dispatchEvent(new MouseEvent(type, commun));
    }
    return true;
  }, repere.coord);

  if (!trouvee) throw new Error(`ouvrirFalaise : aucune falaise trouvée à ${repere.nom}`);
  await page.waitForSelector('.popup', { timeout: 10000 });
  await page.waitForTimeout(700); // chargement différé du détail des voies
}

// Contexte prêt à l'emploi : collecte les erreurs console et les violations
// CSP, que chaque test peut ensuite vérifier.
export async function nouveauContexte(navigateur, options = {}) {
  // hasTouch/isMobile transmis explicitement : sans eux, `(pointer: coarse)`
  // ne matche pas et un test qui croit mesurer un téléphone mesure une
  // souris. Le défaut est silencieux — les chiffres sont plausibles, ils
  // décrivent juste le mauvais appareil.
  const contexte = await navigateur.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    ...(options.hasTouch ? { hasTouch: true } : {}),
    ...(options.isMobile ? { isMobile: true } : {}),
    ...(options.serviceWorkers ? { serviceWorkers: options.serviceWorkers } : {}),
  });
  const page = await contexte.newPage();
  const erreurs = [];
  const violationsCsp = [];

  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const texte = m.text();
    // frame-ancestors en <meta> est ignoré par conception (il exige un vrai
    // en-tête HTTP) : ce n'est pas une violation à corriger.
    if (texte.includes('Content Security Policy')) {
      if (!texte.includes('frame-ancestors')) violationsCsp.push(texte);
      return;
    }
    erreurs.push(texte);
  });

  return { contexte, page, erreurs, violationsCsp };
}
