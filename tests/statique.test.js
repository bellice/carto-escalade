// statique.test.js — vérifications sans navigateur, sans dépendance.
//
// Tourne avec le lanceur intégré de Node (`node --test`) : rien à installer.
// Ce niveau attrape la majorité des régressions vues en pratique, en quelques
// dizaines de millisecondes — il doit rester le filet qu'on lance sans y
// penser, avant même d'ouvrir un navigateur.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { construire, retirerCommentairesJS } from '../outils/construire-site.js';
import {
  STYLES, deriverStyles, estDuStyle, valeurSelection, estFalaiseVideDansMode, statsSelection,
  compterCroiseDansFourchette, cotationVersValeur, approximerCotation, libelleFalaise,
} from '../assets/js/donnees.js';
import { popupFalaise } from '../assets/js/popups.js';
import { construireHistogramme } from '../assets/js/histogramme.js';
import { construireDetailVoies } from '../assets/js/detail-voies.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (rel) => readFile(join(RACINE, rel), 'utf8');

// Les lieux ne sont PAS énumérés à la main : on retient tout dossier portant un
// data.geojson. Sans ça, ajouter un lieu laisserait tout ce fichier braqué sur
// le premier, et le nouveau ne serait couvert par rien — un oubli invisible,
// puisque la suite resterait verte.
async function trouverLieux() {
  const entrees = await readdir(RACINE, { withFileTypes: true });
  const lieux = [];
  for (const e of entrees) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    try {
      await readFile(join(RACINE, e.name, 'data.geojson'), 'utf8');
      lieux.push(e.name);
    } catch { /* pas un dossier de lieu */ }
  }
  return lieux.sort();
}
const LIEUX = await trouverLieux();
// La CSS de la page carte tient en plusieurs feuilles dont l'ordre EST la
// cascade : on les relit dans l'ordre des <link> d'une page, comme le navigateur.
async function lireCarteCss() {
  const html = await lire(`${LIEUX[0]}/index.html`);
  const feuilles = [...html.matchAll(/href="\.\.\/(assets\/css\/[\w-]+\.css)"/g)].map((m) => m[1]);
  return (await Promise.all(feuilles.map(lire))).join('\n');
}
const geojsonDe = async (lieu) => JSON.parse(await lire(`${lieu}/data.geojson`));

// Même principe que trouverLieux ci-dessus, appliqué aux pages : toute page
// RÉELLEMENT publiée est couverte, sans liste à tenir à jour. La liste écrite à
// la main qu'elle remplace n'avait jamais été complétée — sources.html et
// mentions-legales.html étaient publiées depuis le début sans qu'aucun test ne
// vérifie leur CSP, leur h1 ni l'absence de script inline. Ce qui décide, c'est
// la liste d'exclusion de _config.yml, la même que celle qui décide ce qui part
// sur GitHub Pages : une page retirée de la publication sort du lot ici aussi,
// une page ajoutée y entre sans qu'on ait à y penser.
// Sous-dossiers : repérés par leur PROPRE index.html, pas par LIEUX — un lieu
// qui n'a pas encore de data.geojson (une page "en construction" comme
// cassis-ciotat/, publiée avant que son recensement soit fini) doit rester
// contrôlé sur ce qui ne dépend pas des données : h1 unique, CSP déclarée,
// aucun script inline. Ces trois-là ne demandent rien de plus qu'un fichier
// HTML sur disque. Tout LIEU (qui EN a un) a nécessairement un index.html, ce
// tour-ci couvre donc l'ancien comme le nouveau sans les lister séparément.
async function trouverPagesPubliees() {
  const conf = await lire('_config.yml');
  const bloc = conf.slice(conf.indexOf('exclude:'));
  const exclues = new Set(
    [...bloc.matchAll(/^\s*-\s*(\S+)\s*$/gm)].map((m) => m[1].replace(/\/$/, ''))
  );
  const entrees = await readdir(RACINE, { withFileTypes: true });
  const racine = entrees
    .filter((e) => e.isFile() && e.name.endsWith('.html') && !exclues.has(e.name))
    .map((e) => e.name)
    .sort();
  const sousDossiers = [];
  for (const e of entrees) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || exclues.has(e.name)) continue;
    try {
      await readFile(join(RACINE, e.name, 'index.html'), 'utf8');
      sousDossiers.push(`${e.name}/index.html`);
    } catch { /* pas de page à cet endroit */ }
  }
  return [...racine, ...sousDossiers.sort()];
}
const PAGES_PUBLIEES = await trouverPagesPubliees();

// --- Contraste WCAG : même formule que la recommandation ---
function luminance(hex) {
  const h = hex.replace('#', '');
  const canal = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}
function contraste(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

async function jetons() {
  const css = await lire('assets/css/tokens.css');
  const table = {};
  for (const [, nom, valeur] of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    table[nom] = valeur.toLowerCase();
  }
  return table;
}

describe('Service worker : pré-cache', () => {
  // Régression réelle : hors-ligne.js avait été ajouté sans être pré-caché.
  // Le premier chargement hors ligne échouait alors à l'import et faisait
  // tomber TOUTE la carte — sans erreur visible ailleurs.
  test('chaque module de assets/js est dans PRECACHE', async () => {
    const sw = await lire('sw.js');
    const precaches = new Set(
      [...sw.matchAll(/'\.\/assets\/js\/([\w-]+\.js)'/g)].map((m) => m[1])
    );
    const surDisque = (await readdir(join(RACINE, 'assets/js'))).filter((f) => f.endsWith('.js'));

    const manquants = surDisque.filter((f) => !precaches.has(f));
    assert.deepEqual(manquants, [],
      `Modules absents du PRECACHE de sw.js : ${manquants.join(', ')}. ` +
      'Un module non pré-caché fait échouer tout le graphe au 1er chargement hors ligne.');
  });

  test('les feuilles de assets/css sont liées dans le même ordre par chaque lieu, et pré-cachées', async () => {
    const sw = await lire('sw.js');
    const surDisque = (await readdir(join(RACINE, 'assets/css'))).filter((f) => f.endsWith('.css')).sort();
    const liste = async (rel) => [...(await lire(rel)).matchAll(/href="\.\.\/assets\/css\/([\w-]+\.css)"/g)].map((m) => m[1]);
    const reference = await liste(`${LIEUX[0]}/index.html`);
    assert.deepEqual([...reference].sort(), surDisque, 'Une feuille de assets/css est absente des pages, ou liée sans exister.');
    for (const lieu of LIEUX) {
      assert.deepEqual(await liste(`${lieu}/index.html`), reference, `${lieu} : feuilles différentes ou dans un autre ordre (la cascade en dépend).`);
    }
    // noscript.css est exemptée du pré-cache : elle ne sert que quand JavaScript
    // est désactivé, et le service worker, qui est du JavaScript, n'existe alors
    // pas. La pré-cacher ne profiterait à personne (voir le test dédié plus bas).
    const manquantes = reference.filter((f) => f !== 'noscript.css' && !sw.includes(`'./assets/css/${f}'`));
    assert.deepEqual(manquantes, [], `Feuilles absentes du PRECACHE de sw.js : ${manquantes.join(', ')}.`);
  });

  test('PRECACHE ne référence aucun module inexistant', async () => {
    const sw = await lire('sw.js');
    const precaches = [...sw.matchAll(/'\.\/assets\/js\/([\w-]+\.js)'/g)].map((m) => m[1]);
    const surDisque = new Set((await readdir(join(RACINE, 'assets/js'))).filter((f) => f.endsWith('.js')));

    const fantomes = precaches.filter((f) => !surDisque.has(f));
    assert.deepEqual(fantomes, [], `PRECACHE cite des fichiers absents : ${fantomes.join(', ')}`);
  });

  test('les tuiles ont un cache distinct de la coquille', async () => {
    const sw = await lire('sw.js');
    assert.match(sw, /CACHE_TUILES\s*=/,
      'Sans cache séparé, bumper CACHE_NAME efface la zone pré-chargée par l\'utilisateur.');
    assert.match(sw, /startsWith\(CACHE_PREFIXE\)/,
      'Le ménage à l\'activation doit se limiter aux caches de la coquille.');
  });
});

describe('Lieux publiés', () => {
  test('au moins un lieu est présent', () => {
    assert.ok(LIEUX.length > 0,
      'Aucun dossier portant un data.geojson : tous les tests par lieu ci-dessous ' +
      'passeraient à vide sans que rien ne le signale.');
  });

  // L'accueil affiche une ligne de mesures par lieu (secteurs, voies, roche)
  // pour distinguer trois entrées autrement identiques. Elle est écrite en
  // dur : le site n'a pas d'étape de build, et lire les data.geojson depuis
  // l'accueil coûterait leur téléchargement sur une page qui doit rester
  // légère et disponible hors ligne. Écrire en dur ne veut pas dire laisser
  // dériver — un réexport qui ajoute vingt voies rendrait ces chiffres faux
  // en silence, exactement le genre d'écart que ce fichier existe pour
  // attraper (voir le « 111 falaises » corrigé sur cette même page).
  test('les chiffres de l\'accueil correspondent aux données', async () => {
    const html = await lire('index.html');
    for (const lieu of LIEUX) {
      const bloc = new RegExp(
        `href="${lieu}/"[\\s\\S]*?class="sortie-chiffres">([^<]+)<`
      ).exec(html);
      assert.ok(bloc, `${lieu} : pas de ligne .sortie-chiffres sur l'accueil`);

      const geo = await geojsonDe(lieu);
      const falaises = geo.features
        .map((f) => f.properties)
        .filter((p) => p.categorie === 'falaise');
      const secteurs = falaises.length;
      const voies = falaises.reduce((n, p) => n + (p.nb_voie_total || 0), 0);
      const roches = new Map();
      for (const p of falaises) {
        if (p.type_roche) roches.set(p.type_roche, (roches.get(p.type_roche) || 0) + 1);
      }
      const roche = [...roches.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

      // Un lieu sans roche ou sans aucune voie (voir lieuEncoreEnCoursDeSaisie)
      // peut dire son avancement en mots plutôt qu'un décompte à "0 voies".
      // Rien à comparer alors : l'assertion au-dessus a vérifié que la ligne
      // existe. Dès que roche ET voies sont saisies, le décompte strict
      // s'applique.
      if (lieuEncoreEnCoursDeSaisie(geo) || roche === undefined) continue;

      const attendu = `${secteurs} secteurs · ${voies} voies · ${roche}`;
      assert.equal(bloc[1].trim(), attendu,
        `${lieu} : l'accueil annonce « ${bloc[1].trim() }» alors que data.geojson ` +
        `donne « ${attendu} » — corriger index.html.`);
    }
  });
});

// Un lieu peut être publié avant la fin de sa saisie (voir docs/contribuer.md,
// « Ajouter un lieu ») dès que ses falaises sont positionnées, sans attendre
// voies ni parkings — repéré par l'absence totale de type_roche (la première
// donnée de falaise.csv à manquer tant que le recensement n'est pas fini) OU
// par l'absence de toute voie : un lieu peut recevoir sa roche, ses
// orientations et ses parkings avant ses voies, et reste en cours tant que
// voie.csv n'est pas saisi. Même repère que le test des chiffres de l'accueil
// ci-dessus : les tests qui suivent s'en servent pour ne pas exiger un parking
// ou une falaise sportive qui n'existent tout simplement pas encore, sans pour
// autant cesser de les exiger des lieux qui n'ont plus cette excuse.
function lieuEncoreEnCoursDeSaisie(geo) {
  const falaises = geo.features.map((f) => f.properties).filter((p) => p.categorie === 'falaise');
  return !falaises.some((p) => p.type_roche) || !falaises.some((p) => (p.nb_voie_total || 0) > 0);
}

for (const lieu of LIEUX) describe(`Données exportées — ${lieu}`, () => {
  // Régression réelle : une reconstruction de la base efface le cache des
  // temps de trajet (alimenté par API, jamais par les CSV). trajet_gite_min
  // repassait à null partout et le curseur « Trajet depuis le gîte »
  // disparaissait du site — silencieusement.
  // Le test ne s'applique qu'aux lieux QUI ONT un hébergement : un lieu sans
  // gîte est légitime, le site y masque de lui-même curseur et clé de légende.
  test('les parkings ont tous un temps de trajet depuis le gîte', async () => {
    const geo = await geojsonDe(lieu);
    const parkings = geo.features.filter((f) => f.properties.categorie === 'parking');
    const aGite = geo.features.some((f) => f.properties.categorie === 'hebergement');

    if (!lieuEncoreEnCoursDeSaisie(geo)) {
      assert.ok(parkings.length > 0, `${lieu} : aucun parking dans data.geojson`);
    }
    if (!aGite) return;
    const sansTrajet = parkings.filter((p) => p.properties.trajet_gite_min == null);
    assert.deepEqual(sansTrajet.map((p) => p.properties.nom), [],
      'trajet_gite_min manquant : relancer scripts/refresh_trajet_gite.py ' +
      '(build_db.py vide ce cache) puis réexporter, sinon le curseur disparaît.');
  });

  test('la table des sources porte auteur et année exploitables', async () => {
    const geo = await geojsonDe(lieu);
    assert.ok(Array.isArray(geo.sources) && geo.sources.length, `${lieu} : geojson.sources absent`);

    for (const s of geo.sources) {
      if (s.type && s.type.includes('topo')) {
        assert.ok(s.auteur, `Source ${s.id} sans auteur`);
        // Piège connu : millesime mélange "2020-05-01" et "01/01/23" ; un
        // TRY_CAST en DATE donnait l'an 1 pour le second. L'année est donc
        // extraite explicitement côté export.
        assert.match(String(s.annee), /^(19|20)\d{2}$/,
          `Source ${s.id} : année invalide (${s.annee}) — vérifier annee_depuis_millesime`);
      }
    }
  });

  // Le filtre par fourchette lit ce résumé au chargement : sans lui, il
  // faudrait télécharger routes/*.json (350 Ko) juste pour savoir quelles
  // falaises afficher.
  test('chaque falaise sportive embarque sa répartition de cotations', async () => {
    const geo = await geojsonDe(lieu);
    const sportives = geo.features.filter((f) => (f.properties.nb_voie_sportive || 0) > 0);

    if (!lieuEncoreEnCoursDeSaisie(geo)) {
      assert.ok(sportives.length > 0, `${lieu} : aucune falaise sportive dans data.geojson`);
    }
    for (const f of sportives) {
      const p = f.properties;
      assert.ok(p.cotations && Object.keys(p.cotations).length,
        `${p.nom} : champ "cotations" absent — le filtre par fourchette n'aurait rien à lire`);
      const somme = Object.values(p.cotations).reduce((a, b) => a + b, 0);
      // Inférieur ou égal, pas égal : une poignée de voies sportives n'ont
      // aucune cotation renseignée (8 falaises concernées) et sont donc
      // absentes du résumé. Les compter serait faux ; les exiger aussi.
      assert.ok(somme <= p.nb_voie_sportive,
        `${p.nom} : ${somme} voies cotées pour ${p.nb_voie_sportive} sportives — incohérent`);
    }
  });

  // Le filtre "Style" et la colonne "Grimpe" lisent ces compteurs et rien
  // d'autre. Avec la moulinette (4e compteur, hors filtre), ils doivent
  // retomber exactement sur le total affiché dans la colonne "Voies" : un écart
  // voudrait dire une discipline exportée sans compteur.
  test('les compteurs de style s’additionnent au total de voies', async () => {
    const geo = await geojsonDe(lieu);
    for (const f of geo.features) {
      const p = f.properties;
      if (p.categorie !== 'falaise') continue;
      const compteurs = ['sportive', 'trad', 'artificielle', 'moulinette'].map((s) => p[`nb_voie_${s}`]);
      assert.ok(compteurs.every((n) => Number.isInteger(n) && n >= 0),
        `${p.nom} : compteur de style absent ou invalide (${compteurs.join(', ')})`);
      const somme = compteurs.reduce((a, b) => a + b, 0);
      assert.equal(somme, p.nb_voie_total,
        `${p.nom} : sportive + trad + artificielle + moulinette = ${somme}, nb_voie_total = ${p.nb_voie_total}`);
    }
  });

  test('chaque falaise avec des voies pointe vers un fichier routes existant', async () => {
    const geo = await geojsonDe(lieu);
    const fichiers = new Set(await readdir(join(RACINE, `${lieu}/routes`)));

    for (const f of geo.features) {
      const p = f.properties;
      if (!p.routes) continue;
      assert.ok(fichiers.has(`${p.routes}.json`),
        `${lieu} : ${p.nom} référence routes/${p.routes}.json, absent du dépôt`);
    }
  });

  // Régression réelle : une falaise portait « penhir-argol » dans sa colonne
  // `nom` — le slug du lieu recopié par mégarde (il s'appelait alors ainsi,
  // renommé depuis en presquile-crozon). Rien ne l'a signalé, et elle
  // s'affichait sous ce nom sur la carte jusqu'à ce qu'un œil humain la voie.
  // Un nom de falaise identique au dossier qui la contient n'a aucune raison
  // d'exister : c'est toujours un copier-coller.
  test('aucune falaise ne porte le nom de son lieu', async () => {
    const geo = await geojsonDe(lieu);
    const fautives = geo.features
      .filter((f) => f.properties.categorie === 'falaise')
      .filter((f) => [f.properties.nom, f.properties.site, f.properties.secteur]
        .some((v) => (v || '').toLowerCase() === lieu.toLowerCase()))
      .map((f) => `${f.properties.nom} / ${f.properties.secteur}`);
    assert.deepEqual(fautives, [],
      `${lieu} : nom, site ou secteur vaut le slug du lieu — copier-coller dans falaise.csv.`);
  });

  // Le défaut que la colonne `lieu` existe pour empêcher. Avant elle, toutes
  // les requêtes de export_geojson.py étaient sans portée : un second jeu de
  // données saisi dans les mêmes CSV se serait retrouvé dans TOUS les
  // data.geojson, et la carte de la Drôme aurait affiché la Bretagne.
  // Rien à l'œil ne le signalerait — la carte s'ouvre, elle est juste cadrée
  // sur la France entière.
  // Seuil : la Drôme mesure 67 km de diagonale, Crozon ~30 ; un mélange
  // Drôme+Bretagne en ferait 897. 300 km laisse la place à n'importe quelle
  // région française tout en attrapant la fuite d'un facteur trois.
  test('l\'étendue du lieu reste régionale (aucune fuite d\'un autre lieu)', async () => {
    const geo = await geojsonDe(lieu);
    const points = geo.features.map((f) => f.geometry.coordinates);
    const lons = points.map((c) => c[0]);
    const lats = points.map((c) => c[1]);
    const diagonale = distanceKm(
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    );
    assert.ok(diagonale < 300,
      `${lieu} : ${Math.round(diagonale)} km de diagonale — des points d'un autre ` +
      'lieu ont fui dans cet export (export_geojson.py --lieu filtre-t-il bien ?)');
  });
});

// Filtre "Style" (sportive / trad / artif) : ce que les données lui donnent à
// filtrer, et la règle de dérivation, sans navigateur.
describe('Filtre Style', () => {
  test('au moins un lieu propose deux pratiques ou plus, artificielle comprise', async () => {
    const styles = new Set();
    const lieuxAvecFiltre = [];
    for (const lieu of LIEUX) {
      const geo = await geojsonDe(lieu);
      const duLieu = new Set();
      for (const f of geo.features) {
        if (f.properties.categorie !== 'falaise') continue;
        deriverStyles(f.properties).forEach((s) => { styles.add(s); duLieu.add(s); });
      }
      if (duLieu.size >= 2) lieuxAvecFiltre.push(lieu);
    }
    assert.ok(lieuxAvecFiltre.length > 0, 'aucun lieu n’a deux styles : le filtre ne s’afficherait nulle part');
    assert.ok(styles.has('artificielle'),
      'aucun secteur artificielle dans aucun lieu : la case « Artif » ne retiendrait rien, où que ce soit');
    assert.ok(styles.has('trad'), 'aucun secteur trad dans aucun lieu');
  });

  test('deriverStyles ne lit que les compteurs', () => {
    // Cotation "6c/A0" (voie sportive à un pas d'artif, présente en Drôme) :
    // aucun compteur artificielle, donc aucun style artificielle.
    assert.deepEqual(deriverStyles({ nb_voie_sportive: 3, nb_voie_trad: 0, nb_voie_artificielle: 0, cotations: { '6c/A0': 1 } }), ['sportive']);
    assert.deepEqual(deriverStyles({ nb_voie_sportive: 2, nb_voie_trad: 1, nb_voie_artificielle: 4 }), ['sportive', 'trad', 'artificielle']);
    // Moulinette seule, ou secteur sans voie saisie : aucun style.
    assert.deepEqual(deriverStyles({ nb_voie_moulinette: 5 }), []);
    assert.deepEqual(deriverStyles({ nb_voie_sportive: 0, nb_voie_trad: 0, nb_voie_artificielle: 0 }), []);
    assert.deepEqual(STYLES, ['sportive', 'trad', 'artificielle']);
  });

  test('estDuStyle : choix unique, « tous » laisse tout passer, secteur sans pratique exclu', () => {
    const mixte = { types: ['sportive', 'trad'] };
    const sansStyle = { types: [] };
    assert.equal(estDuStyle(mixte, 'tous'), true);
    assert.equal(estDuStyle(sansStyle, 'tous'), true);
    assert.equal(estDuStyle(mixte, 'trad'), true);
    assert.equal(estDuStyle(mixte, 'artificielle'), false);
    assert.equal(estDuStyle(sansStyle, 'sportive'), false);
  });

  // La taille d'un cercle = les voies qui correspondent à la sélection ; le
  // secteur disparaît si ce nombre est nul (sauf sans aucun filtre).
  const secteur = {
    nbVoies: 40,
    nbStyle: { sportive: 30, trad: 8, artificielle: 2 },
    nbParType: { sportive: { couenne: 25, gv: 5 }, trad: { couenne: 1, gv: 7 }, artificielle: { gv: 2 } },
  };
  test('valeurSelection : une seule règle pour toutes les combinaisons', () => {
    assert.equal(valeurSelection(secteur, 'aucun', 'tous'), 40);
    assert.equal(valeurSelection(secteur, 'aucun', 'trad'), 8);
    assert.equal(valeurSelection(secteur, 'couenne', 'tous'), 26, 'couenne, toutes pratiques');
    assert.equal(valeurSelection(secteur, 'gv', 'tous'), 14);
    assert.equal(valeurSelection(secteur, 'gv', 'trad'), 7, 'trad ET grande voie');
    assert.equal(valeurSelection(secteur, 'couenne', 'artificielle'), 0);
    // Export ancien, sans nb_par_type : seules les sportives sont connues.
    assert.equal(valeurSelection({ nbVoies: 3, nbStyle: {}, nbParType: { sportive: { couenne: 3 } } }, 'couenne', 'tous'), 3);
  });

  test('detail des voies : une voie sans cotation comparable reste listée, comptée à part', () => {
    const detail = {
      sportives: [{ nom: 'A', cotation: '6a', type_voie: 'couenne' }, { nom: 'B', cotation: '7c', type_voie: 'couenne' }],
      artificielles: [{ nom: 'C', cotation_artif: 'A1', type_voie: 'grande voie' }],
    };
    const selection = (v) => (v.cotation_artif ? 'sans-cote' : v.cotation === '6a');
    const html = construireDetailVoies(detail, 'cotation', selection);
    assert.match(html, /1 voie sur 3 · 1 sans cotation comparable/);
    assert.match(html, />C</, 'la voie sans cotation comparable est listée');
    assert.doesNotMatch(html, />B</, 'une voie hors fourchette est retirée');
  });

  test('approximerCotation : artif composé, fourchette abrégée, chiffres romains', () => {
    const label = (c) => approximerCotation(c)?.label ?? null;
    for (const [saisi, attendu] of [
      ['5c/A1', '5c'], ['6c+/A0', '6c+'], ['A1/6c', '6c'], ['C1-5b', '5b'], ['6a/C1', '6a'],
      ['A1', null], ['A1/A2', null],
      ['6a/b', '6b'], ['6b/c', '6c'], ['6c+/7a', '7a'],
      ['V+', '5b'], ['VI-', '5c'], ['VI+', '6a+'],
      ['4-', '4a'], ['6a-', '6a'],
    ]) assert.equal(label(saisi), attendu, saisi);
  });

  test('la fourchette de cotation se croise avec la pratique et le type de voie', () => {
    const cotationsParType = {
      sportive: { couenne: { '5c': 10, '6a': 4, '7a': 3 }, gv: { '6a': 1, '6b': 2 } },
      trad: { gv: { '6a': 1, 'V+': 2 } },
      artificielle: { gv: { A1: 2 } },
    };
    const dans = compterCroiseDansFourchette(cotationsParType, cotationVersValeur('6a'), cotationVersValeur('6b'));
    assert.deepEqual(dans, { sportive: { couenne: 4, gv: 3 }, trad: { gv: 1 } },
      'cotation illisible (V+, A1) jamais comptée');
    const avec = { ...secteur, nbParTypeFourchette: dans };
    assert.equal(valeurSelection(avec, 'aucun', 'tous'), 8);
    assert.equal(valeurSelection(avec, 'gv', 'tous'), 4, 'grande voie dans le 6a-6b');
    assert.equal(valeurSelection(avec, 'gv', 'sportive'), 3);
    assert.equal(valeurSelection(avec, 'gv', 'trad'), 1);
    assert.equal(valeurSelection(avec, 'couenne', 'trad'), 0);
    // Sans voie dans les bornes, le secteur disparaît même sans autre filtre.
    assert.equal(estFalaiseVideDansMode({ ...secteur, nbParTypeFourchette: {} }, 'aucun', 'tous'), true);
  });

  test('estFalaiseVideDansMode : masque seulement quand un filtre est actif', () => {
    const vide = { nbVoies: 0, nbStyle: {}, nbParType: {} };
    assert.equal(estFalaiseVideDansMode(vide, 'aucun', 'tous'), false, 'sans filtre, un secteur sans voie reste affiché');
    assert.equal(estFalaiseVideDansMode(vide, 'couenne', 'tous'), true);
    assert.equal(estFalaiseVideDansMode(secteur, 'couenne', 'artificielle'), true);
    assert.equal(estFalaiseVideDansMode(secteur, 'gv', 'artificielle'), false);
    assert.equal(estFalaiseVideDansMode(secteur, 'aucun', 'trad'), false);
  });

  test('statsSelection : max et médiane des secteurs concernés', () => {
    const entries = [
      { cat: 'falaise', nbVoies: 10, nbStyle: {}, nbParType: {} },
      { cat: 'falaise', nbVoies: 30, nbStyle: {}, nbParType: {} },
      { cat: 'falaise', nbVoies: 0, nbStyle: {}, nbParType: {} },
      { cat: 'parking' },
    ];
    assert.deepEqual(statsSelection(entries, 'aucun', 'tous'), { max: 30, median: 20 });
  });

  for (const lieu of LIEUX) {
    test(`${lieu} : la page porte le contrôle « Pratique », masqué au départ, « Tous » coché`, async () => {
      const html = await lire(`${lieu}/index.html`);
      assert.match(html, /<div[^>]*id="legende-style"[^>]*\shidden[\s>]/,
        `${lieu} : #legende-style absent ou visible avant que carte.js ne juge les données`);
      for (const s of ['tous', ...STYLES]) {
        assert.ok(html.includes(`data-style="${s}"`), `${lieu} : choix data-style="${s}" absent`);
      }
      assert.match(html, /data-style="tous"\s+checked/, `${lieu} : « Tous » n'est pas coché au départ`);
    });
  }
});

// Détail des voies : sportives, puis trad et artif à la suite. Rendu pur
// (chaînes HTML), donc testable sans navigateur, y compris quand les clés
// voies_trad / voies_artificielles n'existent pas encore dans les routes.
describe('Détail des voies : trad et artif', () => {
  const sportive = { nom: 'S1', numero: 1, cotation: '6a', type_voie: 'couenne' };
  const trad = [
    { nom: 'Trad alpha', numero: 2, cotation: '6a', protection: 'R' },
    { nom: 'Trad beta', numero: 3, cotation: '5c' },
  ];
  const artif = [
    { nom: 'Aid gamma', numero: 4, cotation_artif: 'A2' },
    { nom: 'Aid delta', numero: 5 },
  ];
  const lignes = (html) => [...html.matchAll(/<li class="detail-voie(?: detail-voie-impaire)?">([\s\S]*?)<\/li>/g)].map((m) => m[1]);

  test('le bouton du détail apparaît sans voie sportive, dès qu\u2019une voie trad ou artif est détaillée', () => {
    assert.match(construireHistogramme([], true, 2), /btn-voir-detail-voies/);
    assert.doesNotMatch(construireHistogramme([], true, 2), /voies-histo"/, 'pas d\u2019histogramme sans voie sportive');
    // Rien à détailler : comme avant, aucun bouton.
    assert.equal(construireHistogramme([], true, 0), '');
    assert.equal(construireHistogramme([], true), '');
    assert.equal(construireHistogramme(undefined, false), '');
    // Avec des sportives, appel à deux arguments (ancien) inchangé.
    assert.match(construireHistogramme([sportive], false), /btn-voir-detail-voies/);
  });

  test('sportives, trad puis artif, chaque bloc sous son sous-titre', () => {
    const html = construireDetailVoies({ sportives: [sportive], trad, artificielles: artif });
    assert.deepEqual([...html.matchAll(/detail-voie-groupe">([^<]*)</g)].map((m) => m[1]), ['Sportive', 'Trad', 'Artif']);
    assert.match(html, /4 voies|5 voies/);
    const noms = [...html.matchAll(/detail-voie-nom">([^<]*)</g)].map((m) => m[1]);
    // Tri Cotation, bloc par bloc : 5c avant 6a en trad, A2 avant « sans cotation » en artif.
    assert.deepEqual(noms, ['S1', 'Trad beta', 'Trad alpha', 'Aid gamma', 'Aid delta']);
  });

  test('le carré couenne / grande voie reste réservé aux sportives, les colonnes restent alignées', () => {
    const html = construireDetailVoies({ sportives: [sportive], trad, artificielles: artif });
    const l = lignes(html);
    assert.equal(l.length, 5);
    assert.equal((html.match(/histo-swatch/g) || []).length, 1, 'un carré, pour la seule sportive');
    for (const ligne of l) {
      assert.equal((ligne.match(/<span class="detail-voie-(?:type|nom|cotation|points|hauteur)"/g) || []).length, 5,
        'cinq cellules par ligne, sinon la grille se décale');
    }
    assert.match(l[1], /detail-voie-type"><\/span>/, 'cellule type vide en trad');
    assert.match(l[3], /detail-voie-type"><\/span>/, 'cellule type vide en artif');
  });

  test('artif : le tri vise le grade A/C, pas le passage libre ("5c/A1", "C1-5b")', () => {
    const html = construireDetailVoies({ sportives: [], trad: [], artificielles: [
      { nom: 'x3', cotation_artif: '5c/A2' },
      { nom: 'x1', cotation_artif: 'C1-5b' },
      { nom: 'x2', cotation_artif: 'A1/6c' },
      { nom: 'x9' },
    ] });
    assert.deepEqual([...html.matchAll(/detail-voie-nom">([^<]*)</g)].map((m) => m[1]), ['x1', 'x2', 'x3', 'x9']);
  });

  test('trad : cotation telle que saisie, avec la protection quand elle existe ; artif : cotation_artif', () => {
    const html = construireDetailVoies({ sportives: [], trad, artificielles: artif });
    const l = lignes(html);
    // Ordre : beta (5c, sans protection), alpha (6a R), gamma (A2), delta (sans cotation).
    assert.match(l[0], /detail-voie-cotation">5c<\/span>/);
    assert.doesNotMatch(l[0], /protection/, 'pas de protection : rien à afficher');
    assert.match(l[1], /detail-voie-cotation">6a<span class="detail-voie-protection">R<\/span><\/span>/);
    assert.match(l[2], /detail-voie-cotation">A2<\/span>/);
    assert.match(l[3], /detail-voie-cotation"><\/span>/, 'artif sans cotation_artif : cellule vide, pas de « undefined »');
    assert.doesNotMatch(html, /undefined|null|NaN/);
  });

  test('un seul style : pas de sous-titre, rendu identique à celui d\u2019avant', () => {
    assert.doesNotMatch(construireDetailVoies({ sportives: [sportive], trad: [], artificielles: [] }), /detail-voie-groupe/);
    assert.doesNotMatch(construireDetailVoies({ sportives: [], trad, artificielles: [] }), /detail-voie-groupe/);
  });

  test('clés absentes ou vides : aucune erreur, aucune section vide', () => {
    for (const detail of [{ sportives: [sportive] }, { sportives: [sportive], trad: undefined, artificielles: null }, {}, undefined]) {
      const html = construireDetailVoies(detail);
      assert.doesNotMatch(html, /detail-voie-groupe/);
      assert.doesNotMatch(html, /undefined|NaN/);
    }
    assert.equal(lignes(construireDetailVoies({ sportives: [sportive] })).length, 1);
  });

  test('le mode Position est une seule liste triée par numéro, styles mêlés, sans sous-titre', () => {
    const html = construireDetailVoies({
      sportives: [{ nom: 'S1', numero: 1, cotation: '6a', type_voie: 'couenne' }, { nom: 'S7', numero: 7, cotation: '6b', type_voie: 'couenne' }],
      trad: [{ nom: 'T2', numero: 2, cotation: '5c' }, { nom: 'T9', numero: 9 }],
      artificielles: [{ nom: 'A5', numero: 5, cotation_artif: 'A1' }, { nom: 'Asans' }],
    }, 'position');
    const noms = [...html.matchAll(/detail-voie-nom">([^<]*)</g)].map((m) => m[1]);
    // Numéro croissant tous styles confondus ; sans numéro, en fin de liste.
    assert.deepEqual(noms, ['S1', 'T2', 'A5', 'S7', 'T9', 'Asans']);
    assert.doesNotMatch(html, /detail-voie-groupe/, 'pas de bloc par style en Position');
    assert.equal((html.match(/histo-swatch/g) || []).length, 2, 'le carré reste réservé aux sportives');
    // Le mode Cotation, lui, garde ses blocs.
    assert.match(construireDetailVoies({ sportives: [sportive], trad, artificielles: artif }), /detail-voie-groupe/);
  });

  test('les textes issus des données sont échappés', () => {
    const html = construireDetailVoies({
      sportives: [],
      trad: [{ nom: '<img src=x onerror=alert(1)>', cotation: '6a', protection: '"><b>X' }],
      artificielles: [{ nom: 'A', cotation_artif: '<i>A1' }],
    });
    assert.doesNotMatch(html, /<img|<b>|<i>/);
  });

  test('la colonne « Roche » sépare plusieurs roches par une virgule, sans barre verticale', () => {
    globalThis.window ??= { matchMedia: () => ({ matches: false }) };
    const roche = (typeRoche) => {
      const html = popupFalaise({ nom: 'X', nb_voie_total: 10, nb_voie_sportive: 10, type_roche: typeRoche }, 44, 5, 'X');
      return (/Roche<\/span><span class="col-valeur">([^<]*)</.exec(html) || [])[1];
    };
    assert.equal(roche('calcaire|grès|poudingue'), 'calcaire, grès, poudingue');
    assert.equal(roche('calcaire'), 'calcaire');
  });

  test('la colonne « Grimpe » écrit « artif », jamais « artificielle »', () => {
    // popupFalaise ne touche au navigateur que pour matchMedia (pointeur tactile).
    globalThis.window ??= { matchMedia: () => ({ matches: false }) };
    const grimpe = (p) => {
      const html = popupFalaise({ nom: 'X', nb_voie_total: 10, ...p }, 44, 5, 'X');
      return (/Grimpe<\/span><span class="col-valeur">([^<]*)</.exec(html) || [])[1];
    };
    assert.equal(grimpe({ nb_voie_sportive: 8, nb_voie_trad: 1, nb_voie_artificielle: 1 }), 'sportive, trad, artif');
    assert.equal(grimpe({ nb_voie_sportive: 9, nb_voie_artificielle: 1 }), 'sportive, artif');
    assert.equal(grimpe({ nb_voie_artificielle: 10 }), 'artif');
    assert.equal(grimpe({ nb_voie_sportive: 10 }), 'sportive');
    assert.equal(grimpe({ nb_voie_sportive: 5, nb_voie_moulinette: 5 }), 'sportive, moulinette');
  });
});

// nb_par_type (croisement pratique x couenne / grande voie) dimensionne les
// cercles du site : il doit rester d'accord avec les autres compteurs.
for (const lieu of LIEUX) describe(`Croisement pratique x type de voie — ${lieu}`, () => {
  test('nb_par_type est cohérent avec nb_couenne, nb_gv et les compteurs de pratique', async () => {
    const geo = await geojsonDe(lieu);
    for (const f of geo.features) {
      const p = f.properties;
      if (p.categorie !== 'falaise') continue;
      assert.ok(p.nb_par_type && typeof p.nb_par_type === 'object', `${p.nom} : nb_par_type absent`);
      const sport = p.nb_par_type.sportive || {};
      assert.equal(sport.couenne ?? 0, p.nb_couenne, `${p.nom} : sportives en couenne ≠ nb_couenne`);
      assert.equal(sport.gv ?? 0, p.nb_gv, `${p.nom} : sportives en grande voie ≠ nb_gv`);
      for (const style of STYLES) {
        const somme = Object.values(p.nb_par_type[style] || {}).reduce((a, b) => a + b, 0);
        assert.ok(somme <= p[`nb_voie_${style}`], `${p.nom} : ${somme} voies ${style} typées pour ${p[`nb_voie_${style}`]} au compteur`);
      }
    }
  });
});

// Le détail des voies trad et artif est produit par l'export amont
// (export_geojson.py) : ce test vérifie que ce qu'il a livré reste cohérent
// avec les compteurs de data.geojson, lieu par lieu.
for (const lieu of LIEUX) describe(`Détail des voies exporté — ${lieu}`, () => {
  test('chaque liste détaillée a autant de voies que son compteur', async () => {
    const geo = await geojsonDe(lieu);
    for (const f of geo.features) {
      const p = f.properties;
      if (p.categorie !== 'falaise' || !p.routes) continue;
      const site = JSON.parse(await lire(`${lieu}/routes/${p.routes}.json`));
      const entree = site[String(p.routes_falaise)];
      assert.ok(entree, `${p.nom} : absent de routes/${p.routes}.json`);
      assert.equal((entree.voies_sportives || []).length, p.nb_voie_sportive, `${p.nom} : voies sportives détaillées ≠ compteur`);
      assert.equal((entree.voies_trad || []).length, p.nb_voie_trad, `${p.nom} : voies trad détaillées ≠ compteur`);
      assert.equal((entree.voies_artificielles || []).length, p.nb_voie_artificielle, `${p.nom} : voies artificielles détaillées ≠ compteur`);
    }
  });

  test('un secteur qui a des voies sportives, trad ou artif pointe vers un fichier de routes', async () => {
    const geo = await geojsonDe(lieu);
    for (const f of geo.features) {
      const p = f.properties;
      if (p.categorie !== 'falaise') continue;
      const detaille = p.nb_voie_sportive + p.nb_voie_trad + p.nb_voie_artificielle;
      assert.equal(Boolean(p.routes), detaille > 0,
        `${p.nom} / ${p.secteur} : routes=${p.routes} pour ${detaille} voie(s) détaillable(s) (sans fichier, le site n'affiche aucun bouton de détail)`);
    }
  });
});

// Distance orthodromique, en kilomètres.
function distanceKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dPhi = rad(lat2 - lat1);
  const dLambda = rad(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

describe('Étanchéité entre lieux', () => {
  // Complément du test d'étendue ci-dessus : celui-là attrape une fuite
  // massive, celui-ci une fuite d'un seul point (deux régions voisines, où la
  // diagonale ne dirait rien). Sans second lieu il passe à vide — c'est voulu,
  // il attend le jour où il aura quelque chose à comparer.
  test('aucun point n\'apparaît dans deux lieux à la fois', async () => {
    const parLieu = new Map();
    for (const lieu of LIEUX) {
      const geo = await geojsonDe(lieu);
      parLieu.set(lieu, new Set(geo.features.map(
        (f) => `${f.properties.categorie}|${f.properties.nom}|${f.geometry.coordinates.join(',')}`
      )));
    }
    for (const a of LIEUX) {
      for (const b of LIEUX) {
        if (a >= b) continue;
        const communs = [...parLieu.get(a)].filter((c) => parLieu.get(b).has(c));
        assert.deepEqual(communs, [],
          `${communs.length} point(s) présent(s) à la fois dans ${a} et ${b} — ` +
          'le filtrage par lieu de l\'export laisse passer.');
      }
    }
  });
});

describe('Accessibilité : jetons de couleur', () => {
  test('l\'ocre des couennes atteint le seuil non-textuel (WCAG 1.4.11)', async () => {
    const t = await jetons();
    const ratio = contraste(t.couenne, t.paper);
    assert.ok(ratio >= 3,
      `--couenne (${t.couenne}) : ${ratio.toFixed(2)}:1 sur --paper, seuil 3:1`);
  });

  test('couenne et grande voie restent distinguables entre elles', async () => {
    const t = await jetons();
    const ratio = contraste(t.couenne, t.gv);
    // Contrainte en tension avec la précédente : assombrir --couenne améliore
    // le contraste sur le fond mais le rapproche du brun des grandes voies.
    assert.ok(ratio >= 3,
      `--couenne vs --gv : ${ratio.toFixed(2)}:1, seuil 3:1. ` +
      'Ces deux seuils se contredisent : ne pas assombrir --couenne davantage.');
  });

  // Les modes du sélecteur ne s'affichent jamais ensemble, mais on doit voir
  // que la carte a changé en basculant de l'un à l'autre. --cotation valait
  // d'abord --forest : 1.04:1 face à --gv, soit une luminance identique au
  // brun des grandes voies — le changement de mode passait inaperçu.
  test('les couleurs de mode se distinguent les unes des autres', async () => {
    const t = await jetons();
    const paires = [['cotation', 'gv'], ['cotation', 'couenne'], ['gv', 'couenne']];
    for (const [a, b] of paires) {
      const r = contraste(t[a], t[b]);
      assert.ok(r >= 1.6,
        `--${a} vs --${b} : ${r.toFixed(2)}:1 — trop proche pour qu'un changement de mode se voie`);
    }
    const surFond = contraste(t.cotation, t.paper);
    assert.ok(surFond >= 3,
      `--cotation sur --paper : ${surFond.toFixed(2)}:1, seuil 3:1 (WCAG 1.4.11)`);
  });

  test('les couleurs de texte atteignent AA sur leurs fonds', async () => {
    const t = await jetons();
    const paires = [
      ['ink', 'paper'], ['ink', 'stone'],
      ['muted', 'paper'], ['muted', 'stone'],
      ['forest', 'paper'], ['forest', 'stone'],
    ];
    for (const [texte, fond] of paires) {
      const ratio = contraste(t[texte], t[fond]);
      assert.ok(ratio >= 4.5,
        `--${texte} sur --${fond} : ${ratio.toFixed(2)}:1, seuil AA 4.5:1`);
    }
  });
});

describe('Lisibilité : échelle typographique', () => {
  // Le site s'utilise dehors, écran à bout de bras, en plein soleil. Ces
  // planchers ne sont pas des seuils WCAG (la norme n'impose aucune taille)
  // mais des minima retenus pour ce contexte : les repasser sous ces valeurs
  // doit être un choix explicite, pas une dérive.
  test('aucun palier ne repasse sous les minima retenus', async () => {
    const css = await lire('assets/css/tokens.css');
    const rem = (nom) => {
      const m = new RegExp(`--fs-${nom}:\\s*([\\d.]+)rem`).exec(css);
      assert.ok(m, `Palier --fs-${nom} introuvable`);
      return Number.parseFloat(m[1]) * 16;
    };
    const planchers = { '2xs': 11, xs: 12, sm: 13, base: 14 };
    for (const [nom, mini] of Object.entries(planchers)) {
      const px = rem(nom);
      assert.ok(px >= mini,
        `--fs-${nom} = ${px}px, sous le plancher de ${mini}px retenu pour l'usage en extérieur`);
    }
  });

  // Sur un écran tactile, :hover ne se « dé-survole » jamais après un tap :
  // l'élément touché reste affiché comme sélectionné jusqu'à ce qu'on tape
  // ailleurs. Constaté sur le bouton "Filtres" de la légende (.legende-toggle).
  test('aucun état de survol hors de @media (hover: hover)', async () => {
    const css = (await lireCarteCss()).replace(/\/\*[\s\S]*?\*\//g, '');
    const garde = css.indexOf('@media (hover: hover)');
    assert.ok(garde > 0, 'Bloc @media (hover: hover) absent');
    const avant = css.slice(0, garde);
    const orphelines = [...avant.matchAll(/^[^{}\n]*:hover[^{}\n]*\{/gm)].map(m => m[0].trim());
    assert.deepEqual(orphelines, [],
      'Ces règles :hover resteraient collées après un tap sur mobile — ' +
      'les déplacer dans le bloc @media (hover: hover) en fin de feuille.');
  });

  // 44 px est une contrainte TACTILE (largeur d'un doigt), pas une règle
  // universelle : à la souris le pointeur est précis et l'imposer ne fait
  // qu'alourdir un réglage secondaire. D'où le garde (pointer: coarse) —
  // le test vérifie donc la cible LÀ OÙ elle s'applique, pas partout.
  test('la cible tactile de 44 px est garantie sur pointeur grossier', async () => {
    const css = await lireCarteCss();
    // Découpage par indexOf plutôt que par expression régulière : le bloc
    // s'étend sur plusieurs règles, et une regex multiligne ici demandait
    // des échappements que la moindre réécriture du fichier casse.
    const debut = css.indexOf('@media (pointer: coarse)');
    assert.ok(debut > 0, 'Bloc @media (pointer: coarse) introuvable');
    const bloc = css.slice(debut, css.indexOf('\n}', debut));

    // La légende peut grandir librement : min-height suffit.
    assert.match(bloc, /\.legende-toggle\s*\{[^}]*min-height:\s*44px/,
      'Le bouton de légende est le seul moyen de rouvrir la légende repliée.');

    // Le bouton d'en-tête, lui, ne PEUT pas grandir : l'en-tête a une hauteur
    // fixe dont dépend le calage de la carte (l'avoir fait grossir avait
    // masqué 21px de carte). Sa cible passe donc par un pseudo-élément qui
    // déborde de la boîte visible sans toucher à la mise en page.
    assert.match(bloc, /\.btn-preparer::after\s*\{[^}]*height:\s*44px/,
      "La cible du bouton d'en-tête doit être étendue par ::after, pas par min-height.");
  });

  // Le calage de la carte dépend de la hauteur de l'en-tête. Tant qu'elle
  // était écrite en dur à quatre endroits, tout changement de contenu de
  // l'en-tête la rendait fausse en silence.
  test("la hauteur d'en-tête est un jeton, pas une constante répétée", async () => {
    const carte = await lireCarteCss();
    const base = await lire('assets/css/tokens.css');
    assert.match(base, /--hauteur-entete:\s*\d+px/, 'Jeton --hauteur-entete absent');
    assert.match(carte, /\.map-header\s*\{[^}]*height:\s*var\(--hauteur-entete\)/,
      "L'en-tête doit être CONTRAINT à ce jeton (height), sinon son contenu peut le faire grandir.");
    const enDur = [...carte.matchAll(/^\s*(top|max-height):[^;]*44px/gm)].map(m => m[0].trim());
    assert.deepEqual(enDur, [], 'Calage encore écrit en dur : utiliser var(--hauteur-entete).');
  });

  // iOS Safari zoome la page au focus d'un champ dont la police fait moins de
  // 16 px : la carte saute et il faut pincer pour revenir. Défaut objectif,
  // indépendant de l'échelle choisie.
  // iOS zoome au focus de TOUT contrôle de formulaire sous 16px, <select>
  // compris — vérifié en documentation après avoir failli les en exclure.
  // Le zoom ne se défait pas tout seul : l'utilisateur reste coincé zoomé sur
  // la carte. #mode-figure n'y figure plus : remplacé par des cases à cocher
  // ("Type de voie"), que ce bug Safari ne concerne pas — seuls restent les
  // deux <select> de cotation.
  test('les contrôles de formulaire font 16 px sur mobile', async () => {
    const css = await lireCarteCss();
    // Ancrer sur la SECTION mobile : `.recherche-champ input` existe aussi en
    // règle de base (à --fs-base), qu'un motif non ancré attrapait d'abord.
    const ancre = css.indexOf('Champs de saisie sur mobile');
    assert.ok(ancre > -1, 'Section « Champs de saisie sur mobile » introuvable');
    const section = css.slice(ancre);

    for (const selecteur of ['.recherche-champ input', '#cotation-min', '#cotation-max']) {
      const i = section.indexOf(selecteur);
      assert.ok(i > -1, `${selecteur} absent de la section mobile`);
      const regle = /\{([\s\S]*?)\}/.exec(section.slice(i));
      assert.match(regle[1], /font-size:\s*16px/,
        `${selecteur} : sous 16px, iOS zoome au focus et ne dézoome pas. ` +
        '16px en dur, pas un jeton qui pourrait redescendre.');
    }
  });
});

describe('Sécurité : échappement', () => {
  // hauteur_max_voie_m est un plafond de SECTEUR : la hauteur de la paroi,
  // jamais celle d'une voie et jamais une longueur de corde. Vérifié sur les
  // données — un plafond de 350 m coexiste avec une voie de 13 longueurs.
  // Annoncer « hauteur 350 m » sur une grande voie laisserait croire qu'il
  // faut 350 m de corde : c'est la seule donnée du site dont une mauvaise
  // lecture a une conséquence physique, d'où deux libellés qu'il ne faut
  // jamais fusionner.
  test('la hauteur ne se présente jamais comme une corde sur une grande voie', async () => {
    const { colonneHauteur } = await import('../assets/js/champs-fiche.js');

    assert.deepEqual(colonneHauteur({ hauteur_max_voie_m: 30, nb_gv: 0 }),
      { label: 'Hauteur', valeur: '30 m' }, 'Secteur de couennes : lisible en corde');
    assert.deepEqual(colonneHauteur({ hauteur_max_voie_m: 350, nb_gv: 4 }),
      { label: 'Paroi', valeur: '350 m' }, 'Dès une grande voie : « Paroi », jamais « Hauteur »');
    // Une seule grande voie suffit à basculer : le libellé doit protéger le
    // cas le plus dangereux du secteur, pas le cas majoritaire.
    assert.equal(colonneHauteur({ hauteur_max_voie_m: 150, nb_gv: 1, nb_couenne: 40 }).label, 'Paroi');

    // Donnée absente : la colonne disparaît, jamais de tiret ni de valeur par défaut.
    for (const p of [{ nb_gv: 0 }, { hauteur_max_voie_m: null }, { hauteur_max_voie_m: 0 }, {}]) {
      assert.equal(colonneHauteur(p), null, `Devrait ne rien afficher : ${JSON.stringify(p)}`);
    }
  });

  // Le même contrôle, mais sur les données réellement publiées : c'est là
  // qu'une régénération pourrait introduire un secteur mal étiqueté.
  test('aucun secteur publié ne porte « Hauteur » alors qu\'il a une grande voie', async () => {
    const { colonneHauteur } = await import('../assets/js/champs-fiche.js');
    const fautifs = [];
    let avec = 0;
    for (const lieu of LIEUX) {
      const geo = await geojsonDe(lieu);
      for (const f of geo.features) {
        const p = f.properties;
        if (p.categorie !== 'falaise') continue;
        const c = colonneHauteur(p);
        if (!c) continue;
        avec++;
        if (c.label === 'Hauteur' && (p.nb_gv || 0) > 0) fautifs.push(`${lieu}/${p.secteur}`);
      }
    }
    assert.deepEqual(fautifs, [], `Étiquetés « Hauteur » malgré des grandes voies : ${fautifs.join(', ')}`);
    assert.ok(avec > 0, 'Aucun secteur ne porte de hauteur — le champ est-il bien exporté ?');
  });

  test('escapeHtml échappe aussi les guillemets (contexte attribut)', async () => {
    const { escapeHtml } = await import('../assets/js/utils.js');
    // Le piège d'origine : textContent->innerHTML n'échappe pas " ni ',
    // alors que la fonction sert dans une douzaine d'attributs.
    assert.equal(escapeHtml('a"b'), 'a&quot;b');
    assert.equal(escapeHtml("a'b"), 'a&#39;b');
    assert.equal(escapeHtml('<x>&'), '&lt;x&gt;&amp;');

    const piege = 'Falaise" onmouseover="alert(1)';
    assert.ok(!escapeHtml(piege).includes('"'),
      'Un guillemet non échappé referme l\'attribut et permet d\'injecter un gestionnaire.');
  });

  test('urlSure ne laisse passer que des schémas inoffensifs', async () => {
    globalThis.document = { baseURI: 'https://exemple.org/sorties/x/' };
    const { urlSure } = await import('../assets/js/utils.js');

    assert.equal(urlSure('javascript:alert(1)'), '');
    assert.equal(urlSure('JaVaScRiPt:alert(1)'), '');
    assert.equal(urlSure('data:text/html,<script>x</script>'), '');
    assert.equal(urlSure('https://exemple.org/a'), 'https://exemple.org/a');
    assert.equal(urlSure('geo:44.7,5.0'), 'geo:44.7,5.0');
    assert.equal(urlSure('routes/x.json'), 'routes/x.json'); // relatif accepté
    assert.equal(urlSure(''), '');
    assert.equal(urlSure(null), '');
  });
});

// Le manifeste sert un but précis : un site INSTALLÉ échappe à la purge du
// stockage (7 jours sans visite chez WebKit) et obtient persist() sans
// discuter chez Chrome. Sans lui, une préparation hors-ligne faite trop tôt
// peut avoir disparu à l'arrivée à la falaise. D'où ces vérifications : ce
// n'est pas de la conformité pour la forme.
describe('Manifeste et installation', () => {
  const lireManifeste = async () => JSON.parse(await lire('manifest.webmanifest'));

  test('déclare le minimum exigé pour être installable', async () => {
    const m = await lireManifeste();
    for (const champ of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
      assert.ok(m[champ], `Champ « ${champ} » manquant`);
    }
    assert.equal(m.display, 'standalone');
    const tailles = m.icons.map((i) => i.sizes);
    assert.ok(tailles.includes('192x192'), 'Chrome exige une icône de 192px au moins');
    assert.ok(tailles.includes('512x512'), 'Icône 512px attendue (splash / lanceur)');
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'),
      'Sans icône maskable, Android rogne l\'icône carrée dans sa forme de lanceur');
  });

  // Le piège de ce déploiement : le site est servi depuis un SOUS-CHEMIN
  // (bellice.github.io/carto-escalade/). Une URL commençant par « / » y
  // pointerait sur la racine du domaine — l'application s'installerait en
  // ouvrant une 404.
  test('toutes ses URL sont relatives (site servi depuis un sous-chemin)', async () => {
    const m = await lireManifeste();
    const urls = [m.start_url, m.scope, m.id, ...m.icons.map((i) => i.src)].filter(Boolean);
    for (const url of urls) {
      assert.ok(!url.startsWith('/') && !/^https?:/.test(url),
        `« ${url} » doit être relative : le site n'est pas à la racine du domaine`);
    }
  });

  test('les fichiers d\'icônes existent vraiment', async () => {
    const m = await lireManifeste();
    for (const src of [...m.icons.map((i) => i.src), 'icones/apple-touch-icon.png']) {
      await assert.doesNotReject(lire(src), `Icône déclarée mais absente : ${src}`);
    }
  });

  test('chaque page lie le manifeste par un chemin qui résout', async () => {
    for (const page of ['index.html', ...LIEUX.map((l) => `${l}/index.html`)]) {
      const html = await lire(page);
      const lien = /<link\s+rel="manifest"\s+href="([^"]+)"/.exec(html);
      assert.ok(lien, `${page} : pas de <link rel="manifest">`);
      const resolu = join(RACINE, page, '..', lien[1]);
      await assert.doesNotReject(readFile(resolu, 'utf8'),
        `${page} : « ${lien[1] }» ne mène à aucun fichier`);
    }
  });
});

describe('Pages HTML', () => {
  const pages = PAGES_PUBLIEES;

  test('chaque page a exactement un <h1>', async () => {
    for (const page of pages) {
      const html = await lire(page);
      const n = [...html.matchAll(/<h1[\s>]/g)].length;
      assert.equal(n, 1, `${page} : ${n} <h1> (attendu 1)`);
    }
  });

  test('chaque page déclare une CSP', async () => {
    for (const page of pages) {
      const html = await lire(page);
      assert.match(html, /http-equiv="Content-Security-Policy"/, `${page} : pas de CSP`);
    }
  });

  test('aucun script inline (sinon la CSP devrait autoriser unsafe-inline)', async () => {
    for (const page of pages) {
      const html = await lire(page);
      // <script ...>…</script> avec du contenu = inline. Les <script src> sont
      // vides entre les balises et donc acceptés.
      for (const [, corps] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
        assert.equal(corps.trim(), '',
          `${page} : script inline détecté — externaliser, sinon la CSP doit ` +
          'être relâchée avec unsafe-inline.');
      }
    }
  });

  // Les pages internes (hors publication, donc sans CSP et libres d'un script
  // inline) n'ont personne pour signaler qu'elles ont cessé de fonctionner :
  // charte-graphique.html est restée muette un temps indéterminé sur une simple
  // apostrophe non échappée, palette et échelle typographique comprises. Or
  // c'est LA référence visuelle du site : quand elle n'affiche rien, plus rien
  // ne rend visible une dérive de jeton. On ne peut pas exécuter ces pages ici
  // (pas de DOM), mais on peut exiger qu'elles compilent : new Function analyse
  // le corps sans l'exécuter, ce qui suffit à attraper la classe d'erreur en
  // cause.
  test('les pages internes ont un script inline syntaxiquement valide', async () => {
    const entrees = await readdir(RACINE, { withFileTypes: true });
    const internes = entrees
      .filter((e) => e.isFile() && e.name.endsWith('.html') && !pages.includes(e.name))
      .map((e) => e.name);
    assert.ok(internes.length > 0, 'aucune page interne trouvée — la découverte est-elle cassée ?');
    for (const page of internes) {
      const html = await lire(page);
      for (const [, corps] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
        if (!corps.trim()) continue;
        assert.doesNotThrow(() => new Function(corps),
          `${page} : le script inline ne compile pas — la page s'affichera vide.`);
      }
    }
  });

  // Convention : chaque page carte porte DEUX libellés du même lieu, le nom
  // complet et sa forme courte, et le CSS bascule à 641px (voir .titre-long
  // dans assets/css/). Un lieu dupliqué dont on n'aurait renommé qu'un
  // seul des deux afficherait le nom du lieu précédent sur la moitié des
  // écrans — sans que rien d'autre ne le signale.
  test('chaque page carte porte un nom long et un nom court', async () => {
    for (const lieu of LIEUX) {
      const html = await lire(`${lieu}/index.html`);
      const long = /<span class="titre-long">([^<]+)<\/span>/.exec(html);
      const court = /<span class="titre-court">([^<]+)<\/span>/.exec(html);
      assert.ok(long, `${lieu} : pas de <span class="titre-long"> dans le <h1>`);
      assert.ok(court, `${lieu} : pas de <span class="titre-court"> dans le <h1>`);
      assert.ok(long[1].length > court[1].length,
        `${lieu} : « ${long[1]} » n'est pas plus long que « ${court[1]} » — ` +
        'deux libellés identiques ne servent à rien, en garder un seul.');

      // Le <title> de l'onglet porte le nom complet, jamais la forme courte :
      // c'est lui qu'on voit dans un favori ou un onglet épinglé.
      const titre = /<title>([^<]+)<\/title>/.exec(html);
      assert.ok(titre && titre[1].startsWith(long[1]),
        `${lieu} : le <title> (« ${titre?.[1]} ») devrait commencer par le nom complet « ${long[1]} »`);
    }
  });

  test('chaque page publiée a un seul repère <main>', async () => {
    for (const page of pages) {
      const html = await lire(page);
      const n = [...html.matchAll(/<main[\s>]/g)].length;
      assert.equal(n, 1, `${page} : ${n} <main> (attendu 1)`);
    }
  });

  // Les pages carte sont des copies les unes des autres : seuls le <title>, la
  // description, le <h1> et le repli sans JavaScript (la liste des secteurs)
  // portent le lieu. Toute autre différence est une modification faite dans une
  // page et oubliée dans les autres.
  test('les pages carte ne diffèrent que par le titre, la description, le <h1> et le repli', async () => {
    const normalise = async (lieu) => (await lire(`${lieu}/index.html`))
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<title>[^<]*<\/title>/, '<title></title>')
      .replace(/<meta name="description" content="[^"]*" \/>/, '<meta name="description" />')
      .replace(/<h1 class="titre">.*<\/h1>/, '<h1></h1>')
      .replace(/<noscript>\s*<div class="repli-sans-js">[\s\S]*?<\/noscript>/, '<noscript></noscript>')
      .replace(/\s+/g, ' ');
    const [reference, ...autres] = LIEUX;
    const attendu = await normalise(reference);
    for (const lieu of autres) {
      assert.equal(await normalise(lieu), attendu,
        `${lieu}/index.html diffère de ${reference}/index.html au-delà du titre et du <h1>`);
    }
  });

  // Les pages carte sont écrites par outils/generer-pages.js à partir du gabarit
  // et de outils/lieux.json. Une page retouchée à la main, ou un gabarit modifié
  // sans régénération, ferait diverger les lieux sans rien signaler.
  test('les pages carte correspondent au gabarit (npm run generer)', () => {
    try {
      execFileSync(process.execPath, [join(RACINE, 'outils/generer-pages.js'), '--verifier'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (erreur) {
      assert.fail(String(erreur.stderr || erreur.stdout || erreur.message));
    }
  });

  // Un lieu qui a ses données mais pas d'entrée dans lieux.json garderait une
  // page écrite à la main, que le test précédent ne regarde pas.
  test('lieux.json décrit exactement les lieux qui ont un data.geojson', async () => {
    const slugs = JSON.parse(await lire('outils/lieux.json')).map((lieu) => lieu.slug).sort();
    assert.deepEqual(slugs, LIEUX,
      'Lieu publié sans entrée dans outils/lieux.json, ou entrée sans data.geojson : sa page ne serait pas générée.');
  });

  // Repli sans JavaScript (docs/regles.md, « Fonctionne sans JavaScript ») : chaque page
  // carte porte sa description et un <noscript> qui liste les secteurs du lieu.
  const decoderHtml = (texte) => texte.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  test('chaque page carte a une description de 150 à 160 caractères, propre à son lieu', async () => {
    const vues = new Set();
    for (const lieu of LIEUX) {
      const html = await lire(`${lieu}/index.html`);
      const balise = /<meta name="description" content="([^"]*)" \/>/.exec(html);
      assert.ok(balise, `${lieu} : <meta name="description"> absente`);
      const description = decoderHtml(balise[1]);
      assert.ok(description.length >= 150 && description.length <= 160,
        `${lieu} : description de ${description.length} caractères (attendu 150 à 160)`);
      assert.ok(!vues.has(description), `${lieu} : description identique à celle d'un autre lieu`);
      vues.add(description);
    }
  });

  test('le <noscript> de chaque page carte liste les secteurs, autant que l\'accueil en annonce', async () => {
    const accueil = await lire('index.html');
    for (const lieu of LIEUX) {
      const html = await lire(`${lieu}/index.html`);
      const bloc = /<main id="map"[^>]*>\s*<noscript>([\s\S]*?)<\/noscript>\s*<\/main>/.exec(html);
      assert.ok(bloc, `${lieu} : <noscript> absent de <main id="map">`);
      const repli = bloc[1];
      assert.match(repli, /<h2>La carte nécessite JavaScript<\/h2>/, `${lieu} : titre du repli absent`);
      assert.match(repli, /nécessite JavaScript, qui est désactivé dans votre navigateur/, `${lieu} : message du repli absent`);
      assert.match(repli, /<ul>/, `${lieu} : liste des secteurs absente`);

      const falaises = (await geojsonDe(lieu)).features.map((f) => f.properties).filter((p) => p.categorie === 'falaise');
      const entrees = [...repli.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => decoderHtml(m[1]));
      assert.deepEqual([...entrees].sort(), falaises.map(libelleFalaise).sort(),
        `${lieu} : la liste du repli ne correspond plus à data.geojson (lancer : npm run generer)`);
      const sites = new Set(falaises.map((p) => p.site));
      assert.equal([...repli.matchAll(/<h3>/g)].length, sites.size, `${lieu} : un <h3> par site attendu`);

      // Le chiffre « N secteurs » de l'accueil compte les mêmes falaises.
      const chiffre = new RegExp(`<a href="${lieu}/">[\\s\\S]*?<span class="sortie-chiffres">(\\d+) secteurs`).exec(accueil);
      assert.ok(chiffre, `${lieu} : décompte de secteurs introuvable sur l'accueil`);
      assert.equal(entrees.length, Number(chiffre[1]),
        `${lieu} : ${entrees.length} secteurs listés dans le repli, l'accueil en annonce ${chiffre[1]}`);
    }
  });

  test('chaque page carte charge la feuille de repli dans un <noscript> de l\'en-tête', async () => {
    for (const lieu of LIEUX) {
      const entete = (await lire(`${lieu}/index.html`)).split('</head>')[0];
      assert.match(entete, /<noscript>\s*<link rel="stylesheet" href="\.\.\/assets\/css\/noscript\.css" \/>\s*<\/noscript>/,
        `${lieu} : feuille de repli absente de l'en-tête, ou hors <noscript> (une balise <style> serait refusée par la CSP)`);
    }
  });

  // Garde-fou contre une réintroduction accidentelle de la mention d'attente.
  test('la documentation ne dit plus que le repli sans JavaScript reste à écrire', async () => {
    assert.doesNotMatch(await lire('docs/regles.md'), /repli reste à écrire/);
  });

  // noscript.css ne sert que quand JavaScript est désactivé, cas où le service
  // worker (du JavaScript) n'existe pas : la pré-cacher ne profiterait à
  // personne. Le test qui exige le pré-cache de chaque feuille de assets/css
  // l'exempte (voir plus haut) ; celui-ci vérifie que l'exemption est dite
  // dans sw.js et qu'aucune entrée de PRECACHE ne la contient.
  test('noscript.css est exemptée du pré-cache, et sw.js le dit', async () => {
    const sw = await lire('sw.js');
    assert.doesNotMatch(sw, /'[^'\n]*noscript\.css[^'\n]*'/, 'noscript.css ne doit pas figurer dans PRECACHE');
    assert.match(sw, /noscript\.css n'est pas pré-cachée/, 'sw.js doit expliquer pourquoi noscript.css n\'est pas pré-cachée');
    assert.ok((await readdir(join(RACINE, 'assets/css'))).includes('noscript.css'), 'assets/css/noscript.css absent');
  });

  // Sur CHAQUE page carte : un lieu dupliqué dont on aurait rogné la CSP en la
  // recopiant repartirait avec une carte vide, sans erreur visible.
  test('la CSP de chaque page carte n\'autorise aucun CDN et garde le worker de MapLibre en même origine', async () => {
    for (const lieu of LIEUX) {
      const html = await lire(`${lieu}/index.html`);
      // On extrait la valeur de l'attribut content, PAS le HTML brut : le
      // commentaire qui précède la balise mentionne lui aussi « worker-src »,
      // et une recherche naïve tomberait dessus (erreur commise en écrivant ce
      // test — il passait sur le commentaire, pas sur la directive réelle).
      const balise = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*\/?>/.exec(html);
      assert.ok(balise, `${lieu} : balise CSP introuvable`);
      const politique = balise[1];

      assert.doesNotMatch(politique, /jsdelivr/, `${lieu} : la CSP cite encore jsDelivr, MapLibre est servi par le site.`);
      // Le worker se charge depuis son URL de même origine : 'self' seul. Une
      // directive trop stricte laisse la carte vide SANS violation visible
      // dans la console (une violation dans un worker ne remonte pas).
      const directive = /worker-src([^;]*)/.exec(politique);
      assert.ok(directive, `${lieu} : worker-src absent de la CSP`);
      assert.equal(directive[1].trim(), "'self'", `${lieu} : worker-src doit être 'self' seul (ni CDN ni blob:).`);
      assert.doesNotMatch(politique, /script-src[^;]*unsafe-inline/,
        `${lieu} : script-src ne doit pas autoriser unsafe-inline (scripts externalisés).`);
    }
  });

  // MapLibre est copié dans le dépôt (outils/maj-maplibre.js). Un fichier
  // oublié ou une version incohérente casserait la carte, souvent sans erreur
  // visible : le worker, en particulier, échoue en silence.
  test('MapLibre est servi par le site : fichiers présents, importés localement, pré-cachés', async () => {
    const dossier = join(RACINE, 'assets/vendor/maplibre');
    const presents = (await readdir(dossier)).sort();
    for (const nom of ['LICENSE.txt', 'maplibre-gl-worker.mjs', 'maplibre-gl.css', 'maplibre-gl.mjs']) {
      assert.ok(presents.includes(nom), `assets/vendor/maplibre/${nom} absent (voir outils/maj-maplibre.js)`);
    }
    // Tout module voisin cité en import relatif doit exister, sinon 404 silencieux.
    for (const nom of presents.filter((f) => f.endsWith('.mjs'))) {
      const source = await lire(`assets/vendor/maplibre/${nom}`);
      for (const [, voisin] of source.matchAll(/["'`]\.\/(maplibre-gl[\w.-]*\.mjs)/g)) {
        assert.ok(presents.includes(voisin), `${nom} importe ./${voisin}, absent de assets/vendor/maplibre/`);
      }
    }
    // Aucun import de module distant dans le code du site.
    for (const fichier of await readdir(join(RACINE, 'assets/js'))) {
      const source = await lire(`assets/js/${fichier}`);
      assert.doesNotMatch(source, /from\s+['"]https?:/, `assets/js/${fichier} importe un module distant`);
    }
    // Le pré-cache porte la version réelle : le worker est demandé avec ?v=<version>.
    const version = /\/blob\/v(\d+\.\d+\.\d+)\/LICENSE/.exec(await lire('assets/vendor/maplibre/maplibre-gl.mjs'))?.[1];
    assert.ok(version, 'version de MapLibre introuvable dans l\'en-tête de maplibre-gl.mjs');
    const sw = await lire('sw.js');
    for (const entree of ['maplibre-gl.mjs', 'maplibre-gl.css', `maplibre-gl-worker.mjs?v=${version}`]) {
      assert.ok(sw.includes(`'./assets/vendor/maplibre/${entree}'`),
        `sw.js : './assets/vendor/maplibre/${entree}' absent du PRECACHE (version vendue : ${version})`);
    }
    // Les pages chargent la copie locale.
    for (const lieu of LIEUX) {
      const html = (await lire(`${lieu}/index.html`)).replace(/<!--[\s\S]*?-->/g, '');
      assert.match(html, /rel="modulepreload" href="\.\.\/assets\/vendor\/maplibre\/maplibre-gl\.mjs"/, `${lieu} : préchargement local du module absent`);
      assert.match(html, /rel="preload" as="style" href="\.\.\/assets\/vendor\/maplibre\/maplibre-gl\.css"/, `${lieu} : préchargement local de la feuille absent`);
      assert.doesNotMatch(html, /jsdelivr/, `${lieu} : référence encore jsDelivr`);
    }
  });

  // Le retrait de 'unsafe-inline' sur style-src (docs/architecture.md, « La CSP ») vaut pour
  // toute page publiée. redaction.html, qui contient un <style>, n'a pas de CSP :
  // elle n'est pas publiée, ce que « les fichiers internes sont exclus de la
  // publication » verrouille.
  test('aucune page publiée n\'autorise unsafe-inline dans style-src', async () => {
    for (const page of pages) {
      const html = await lire(page);
      const balise = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*\/?>/.exec(html);
      if (!balise) continue;
      assert.doesNotMatch(balise[1], /style-src[^;]*unsafe-inline/,
        `${page} : style-src autorise unsafe-inline (un style="…" injecté par le JS doit passer par style.setProperty)`);
    }
  });

  // Sans 'unsafe-inline', un attribut style="…" est ignoré en silence : la
  // légende proportionnelle passait de 18/30/52 px à 4 px sans la moindre erreur
  // visible. On interdit donc ces attributs là où ils seraient fabriqués.
  test('aucun attribut style="…" fabriqué par le JS ni écrit dans une page publiée', async () => {
    const motif = /(?<![\w-])style\s*=\s*["'\\$]|setAttribute\(\s*['"]style['"]/;
    for (const fichier of await readdir(join(RACINE, 'assets/js'))) {
      const code = retirerCommentairesJS(await lire(`assets/js/${fichier}`));
      assert.doesNotMatch(code, motif,
        `assets/js/${fichier} fabrique un attribut style="…", refusé par la CSP : utiliser style.setProperty ou une classe`);
    }
    for (const page of pages) {
      const html = (await lire(page)).replace(/<!--[\s\S]*?-->/g, '');
      assert.doesNotMatch(html, /\sstyle\s*=\s*["']/, `${page} : attribut style="…" en dur, refusé par la CSP`);
    }
  });
});

// Règle 4 (docs/regles.md, « Composants ») : Custom Elements natifs sans Shadow DOM par défaut.
describe('Composants (Custom Elements)', () => {
  const code = async (rel) => retirerCommentairesJS(await lire(rel));

  test('<bouton-gps> vit dans un fichier dédié, sans Shadow DOM, et enveloppe un <button>', async () => {
    const composant = await code('assets/js/bouton-gps.js');
    assert.match(composant, /customElements\.define\(\s*['"]bouton-gps['"]/, 'bouton-gps.js doit définir <bouton-gps>');
    assert.doesNotMatch(composant, /attachShadow|shadowRoot/,
      'Pas de Shadow DOM : le composant dépend des feuilles globales (docs/regles.md, « Composants »)');
    assert.match(composant, /querySelector\(\s*['"]button['"]\s*\)/,
      'Le composant doit enrober un <button> déjà présent dans le HTML, pas simuler un bouton');
    assert.match(await code('assets/js/liens-acces.js'), /<bouton-gps lat="[^"]*" lon="[^"]*"><button type="button" class="gps-copie"/,
      'boutonGps() doit écrire un vrai <button> dans <bouton-gps>');
    // Le comportement a quitté le répartiteur de clics : un second câblage copierait deux fois.
    assert.doesNotMatch(await code('assets/js/actions-fiche.js'), /gps-copie/,
      'actions-fiche.js ne doit plus câbler la copie GPS');
  });

  test('<poignee-fiche> vit dans un fichier dédié, sans Shadow DOM, enveloppe un <button> et ne décide pas de l\'état', async () => {
    const composant = await code('assets/js/poignee-fiche.js');
    assert.match(composant, /customElements\.define\(\s*['"]poignee-fiche['"]/, 'poignee-fiche.js doit définir <poignee-fiche>');
    assert.doesNotMatch(composant, /attachShadow|shadowRoot/,
      'Pas de Shadow DOM : le composant dépend des feuilles globales (docs/regles.md, « Composants »)');
    assert.match(composant, /querySelector\(\s*['"]button['"]\s*\)/,
      'Le composant doit enrober un <button> déjà présent dans le HTML, pas simuler un bouton');
    // Il observe, il ne décide pas : ni l'état partagé ni la classe de la fiche ne sont de son ressort.
    assert.doesNotMatch(composant, /fiche-reduite|ficheReduite|etat\.js|classList/,
      'Le composant ne doit toucher ni à l\'état replié/déplié ni à la classe de la fiche : il émet « basculer-fiche » et observe `reduite`');
    assert.match(composant, /observedAttributes[\s\S]*['"]reduite['"]/, 'Le composant doit observer l\'attribut `reduite`');
    assert.match(await code('assets/js/popups.js'), /<poignee-fiche><button type="button" class="poignee-fiche"/,
      'popups.js doit écrire un vrai <button> dans <poignee-fiche>');
    // La décision reste dans le code de la fiche, déclenchée par l'événement et non par un clic intercepté.
    const actions = await code('assets/js/actions-fiche.js');
    assert.doesNotMatch(actions, /closest\(\s*['"]\.poignee-fiche['"]\s*\)/, 'actions-fiche.js ne doit plus intercepter le clic sur la poignée');
    assert.match(actions, /addEventListener\(\s*['"]basculer-fiche['"]/, 'actions-fiche.js doit écouter « basculer-fiche »');
  });

  test('<poignee-fiche> est chargé sans bloquer la carte et préchargé par les pages', async () => {
    assert.match(await code('assets/js/demarrer-sortie.js'), /import\(\s*['"]\.\/poignee-fiche\.js['"]\s*\)/,
      'demarrer-sortie.js doit importer le composant par import() : un import statique ferait tomber la carte si le module manque');
    for (const lieu of LIEUX) {
      assert.match(await lire(`${lieu}/index.html`), /rel="modulepreload" href="\.\.\/assets\/js\/poignee-fiche\.js"/,
        `${lieu} : préchargement de poignee-fiche.js absent`);
    }
  });

  test('aucun Custom Element n\'utilise le Shadow DOM', async () => {
    for (const nom of await readdir(join(RACINE, 'assets/js'))) {
      const source = await code(`assets/js/${nom}`);
      if (!/customElements\.define/.test(source)) continue;
      assert.doesNotMatch(source, /attachShadow/,
        `assets/js/${nom} : Shadow DOM interdit sauf si les quatre conditions de docs/regles.md (« Composants ») sont réunies`);
    }
  });

  test('le composant est chargé sans bloquer la carte et préchargé par les pages', async () => {
    assert.match(await code('assets/js/demarrer-sortie.js'), /import\(\s*['"]\.\/bouton-gps\.js['"]\s*\)/,
      'demarrer-sortie.js doit importer le composant par import() : un import statique ferait tomber la carte si le module manque');
    for (const lieu of LIEUX) {
      assert.match(await lire(`${lieu}/index.html`), /rel="modulepreload" href="\.\.\/assets\/js\/bouton-gps\.js"/,
        `${lieu} : préchargement de bouton-gps.js absent`);
    }
  });
});

// Les variables de design vivent dans assets/css/tokens.css (docs/architecture.md).
describe('Jetons de design et seuil mobile', () => {
  const sansCommentairesCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const feuilles = async () => (await readdir(join(RACINE, 'assets/css'))).filter((f) => f.endsWith('.css')).map((f) => `assets/css/${f}`);

  test('tokens.css ne contient que des variables, aucune règle de style', async () => {
    const css = sansCommentairesCss(await lire('assets/css/tokens.css'));
    assert.equal(css.replace(/:root\s*\{[^}]*\}/g, '').trim(), '',
      'tokens.css ne doit contenir que des variables dans :root, pas de règle de style');
    const declarations = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(';')).map((d) => d.trim()).filter(Boolean);
    assert.ok(declarations.length >= 29, `tokens.css ne porte que ${declarations.length} variables`);
    assert.deepEqual(declarations.filter((d) => !d.startsWith('--')), [], 'Seules des variables (--nom) sont permises dans tokens.css');
  });

  test('style.css ne définit aucune variable : elles vivent dans tokens.css', async () => {
    const css = sansCommentairesCss(await lire('assets/style.css'));
    assert.deepEqual([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]), [],
      'Variable définie dans style.css : la déplacer dans assets/css/tokens.css');
  });

  // Une couleur écrite en dur échappe à tokens.css : changer la palette ou une ombre
  // obligerait à la chercher dans chaque feuille.
  test('aucune couleur en dur hors de tokens.css (hex, rgb, hsl, white, black)', async () => {
    const motif = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|(?<![\w-])(?:white|black)(?![\w-])/;
    const fichiers = ['assets/style.css', ...(await feuilles()).filter((f) => !f.endsWith('tokens.css'))];
    for (const fichier of fichiers) {
      const css = sansCommentairesCss(await lire(fichier));
      for (const [, valeur] of css.matchAll(/(?:^|[;{\s])[\w-]+\s*:\s*([^;{}]+)(?=[;}])/g)) {
        assert.doesNotMatch(valeur, motif, `${fichier} : « ${valeur.trim()} » est une couleur en dur, la déclarer dans tokens.css`);
      }
    }
  });

  // Une variable n'est pas utilisable dans une @media : le seuil est écrit en dur à
  // chaque endroit (tokens.css, docs/architecture.md). 641 complète 640 : max-width
  // 640 et min-width 641 se partagent toutes les largeurs. Un autre seuil doit être
  // décidé, documenté, puis ajouté ici.
  test('le seuil de bascule mobile reste à 640 px (max-width) et 641 px (min-width)', async () => {
    const trouvees = [];
    for (const fichier of ['assets/style.css', ...(await feuilles())]) {
      const css = sansCommentairesCss(await lire(fichier));
      for (const media of css.matchAll(/@media[^{]*/g)) {
        for (const [, sens, px] of media[0].matchAll(/\(\s*(max|min)-width\s*:\s*([\d.]+)px\s*\)/g)) trouvees.push({ fichier, sens, px: Number(px) });
      }
    }
    for (const nom of await readdir(join(RACINE, 'assets/js'))) {
      const fichier = `assets/js/${nom}`;
      const code = retirerCommentairesJS(await lire(fichier));
      for (const [, sens, px] of code.matchAll(/\(\s*(max|min)-width\s*:\s*([\d.]+)px\s*\)/g)) trouvees.push({ fichier, sens, px: Number(px) });
    }
    const attendu = { max: 640, min: 641 };
    assert.deepEqual(trouvees.filter((t) => t.px !== attendu[t.sens]).map((t) => `${t.fichier} : ${t.sens}-width ${t.px}px`), [],
      'Seuil divergent : 640 px pour max-width, 641 px pour min-width (voir docs/architecture.md)');
    assert.ok(trouvees.some((t) => t.sens === 'max' && t.fichier.endsWith('.css')) && trouvees.some((t) => t.sens === 'min' && t.fichier.endsWith('.css'))
      && trouvees.some((t) => t.fichier.endsWith('.js')), 'Le test ne trouve plus le seuil dans le CSS et le JS : son motif est à revoir');
    const doc = await lire('docs/architecture.md');
    const absents = [...new Set(trouvees.map((t) => t.fichier))].filter((f) => !doc.includes(f));
    assert.deepEqual(absents, [], `docs/architecture.md ne cite pas : ${absents.join(', ')}`);
  });
});

describe('Ce que le site publie', () => {
  // GitHub Pages sert la racine du dépôt telle quelle : /tests/parcours.test.js,
  // /package.json et /README.md répondaient 200 sur le site en ligne. Rien de
  // confidentiel, mais aucune raison d'y être. _config.yml les exclut ; ce test
  // le verrouille, parce qu'un fichier retiré de la liste ne se voit pas.
  test('les fichiers internes sont exclus de la publication', async () => {
    const conf = await lire('_config.yml');
    const attendus = ['tests/', 'outils/', 'docs/', 'package.json', 'package-lock.json', 'README.md', 'charte-graphique.html', 'redaction.html'];
    const manquants = attendus.filter((f) => !conf.includes(f));
    assert.deepEqual(manquants, [],
      `_config.yml ne les exclut plus : ${manquants.join(', ')} — ils redeviendraient publics.`);
  });

  // L'inverse du test ci-dessus : exclure un dossier de lieu retirerait la
  // carte elle-même du site, et la suite resterait verte puisque les fichiers
  // sont toujours là sur le disque.
  test("aucun dossier de lieu n'est exclu par erreur", async () => {
    const conf = await lire('_config.yml');
    // Un \s dans un gabarit `…` vaut la lettre « s » : l'ancienne regex ne
    // correspondait jamais, et le test restait vert quel que soit _config.yml.
    // On compare donc des lignes, sans construire d'expression régulière.
    const lignes = conf.split('\n').map((ligne) => ligne.trim().replace(/^-\s+/, '- '));
    const exclus = LIEUX.filter((l) => lignes.includes(`- ${l}`) || lignes.includes(`- ${l}/`));
    assert.deepEqual(exclus, [],
      `_config.yml exclut ${exclus.join(', ')} — ces cartes ne seraient plus publiées.`);
  });
});

describe('Licences', () => {
  const sansRetours = (t) => t.replace(/\s+/g, ' ');
  const CLAUSE = 'Les noms de voies, cotations, longueurs, types de roche et orientations issus des topos cités dans sources.html ne sont pas couverts par cette licence. Ils restent sous les droits de leurs éditeurs respectifs.';

  test('LICENSE.txt : texte MIT, avec le copyright de Tokelau', async () => {
    const t = await lire('LICENSE.txt');
    assert.match(t, /^MIT License/);
    assert.match(t, /Copyright \(c\) \d{4}(-\d{4})? Tokelau/);
  });

  // Les données de topo viennent en partie de topos et de sites tiers : la
  // licence ne couvre que ce que l'éditeur détient. Sans la clause, elle
  // prétendrait licencier des contenus qui ne sont pas à lui.
  test("LICENSE-donnees.txt : texte CC BY-NC-SA 4.0 complet et clause d'exclusion des topos", async () => {
    const t = await lire('LICENSE-donnees.txt');
    assert.ok(t.includes('Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International\nPublic License'),
      'le texte légal CC BY-NC-SA 4.0 manque');
    assert.ok(t.includes('Section 8 -- Interpretation.'), 'le texte légal CC est tronqué');
    assert.ok(sansRetours(t).includes(CLAUSE), "la clause d'exclusion des contenus issus des topos manque");
  });

  test('mentions-legales.html cite les deux licences, et ces fichiers sont publiés', async () => {
    const page = await lire('mentions-legales.html');
    for (const fichier of ['LICENSE.txt', 'LICENSE-donnees.txt']) {
      assert.ok(page.includes(`href="${fichier}"`), `mentions-legales.html ne renvoie plus vers ${fichier}`);
    }
    assert.ok(sansRetours(page).includes('ne sont pas couverts par cette licence'),
      "mentions-legales.html ne rappelle plus l'exclusion des contenus issus des topos");
    const conf = await lire('_config.yml');
    const exclusions = conf.split('\n').map((l) => l.trim());
    for (const fichier of ['LICENSE.txt', 'LICENSE-donnees.txt']) {
      assert.ok(!exclusions.includes(`- ${fichier}`),
        `_config.yml exclut ${fichier} : le lien des mentions légales serait mort`);
    }
  });

  test('mentions-legales.html : sources tierces et licence de MapLibre présentes', async () => {
    const page = await lire('mentions-legales.html');
    for (const attendu of ['MapLibre GL JS', 'BSD-3-Clause', 'assets/vendor/maplibre/LICENSE.txt', 'OpenFreeMap', 'OpenStreetMap contributors', 'Oblyk', 'the Crag']) {
      assert.ok(page.includes(attendu), `mentions-legales.html ne cite plus : ${attendu}`);
    }
    await lire('assets/vendor/maplibre/LICENSE.txt');
  });

  test('package.json et README déclarent la licence', async () => {
    assert.equal(JSON.parse(await lire('package.json')).license, 'MIT');
    const readme = await lire('README.md');
    for (const fichier of ['LICENSE.txt', 'LICENSE-donnees.txt']) {
      assert.ok(readme.includes(`](${fichier})`), `README.md ne renvoie plus vers ${fichier}`);
    }
  });
});

describe('Site construit (outils/construire-site.js)', () => {
  let dossier;

  before(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'site-'));
    construire(RACINE, dossier);
  });
  after(() => rm(dossier, { recursive: true, force: true }));

  const existe = (rel) => stat(join(dossier, rel)).then(() => true, () => false);

  test('les fichiers internes ne sont pas publiés, le site si', async () => {
    for (const rel of ['tests', 'outils', 'README.md', 'CLAUDE.md', 'package.json', '.github', '.git']) {
      assert.equal(await existe(rel), false, `${rel} ne doit pas être publié`);
    }
    for (const rel of ['index.html', 'sw.js', 'manifest.webmanifest', '404.html', 'assets/style.css',
      ...LIEUX.map((l) => `${l}/index.html`), ...LIEUX.map((l) => `${l}/data.geojson`)]) {
      assert.equal(await existe(rel), true, `${rel} doit être publié`);
    }
  });

  test('les données sont copiées à l\'octet près', async () => {
    for (const lieu of LIEUX) {
      const [source, publie] = await Promise.all([lire(`${lieu}/data.geojson`), readFile(join(dossier, lieu, 'data.geojson'), 'utf8')]);
      assert.equal(publie, source, `${lieu}/data.geojson a été modifié par la construction`);
    }
  });

  // Le build retire les commentaires du CSS : appliqué à la feuille de MapLibre,
  // il changerait les octets d'un code tiers qu'on veut publier tel que le paquet
  // npm le livre.
  test('la copie de MapLibre est publiée sans modification', async () => {
    const vendu = join('assets', 'vendor', 'maplibre');
    const noms = await readdir(join(RACINE, vendu));
    assert.ok(noms.includes('maplibre-gl.css') && noms.includes('maplibre-gl.mjs'), 'copie de MapLibre introuvable');
    for (const nom of noms) {
      const [source, publie] = await Promise.all([readFile(join(RACINE, vendu, nom)), readFile(join(dossier, vendu, nom))]);
      assert.ok(source.equals(publie), `${vendu}/${nom} a été modifié par la construction`);
    }
  });

  test('plus aucun commentaire dans le JS, le CSS et le HTML publiés', async () => {
    const fichiers = [];
    const parcourir = async (rel) => {
      for (const e of await readdir(join(dossier, rel), { withFileTypes: true })) {
        const chemin = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await parcourir(chemin);
        else if (/\.(js|css|html)$/.test(e.name)) fichiers.push(chemin);
      }
    };
    await parcourir('');
    assert.ok(fichiers.length > 10, 'aucun fichier à contrôler : la découverte est-elle cassée ?');
    for (const f of fichiers) {
      const texte = await readFile(join(dossier, f), 'utf8');
      const motif = f.endsWith('.html') ? /<!--/ : /^\s*(\/\/|\/\*)/m;
      assert.doesNotMatch(texte, motif, `${f} contient encore un commentaire`);
    }
  });

  test('chaque JS publié reste syntaxiquement valide', async () => {
    const tmp = join(dossier, '..', `verif-${process.pid}.mjs`);
    try {
      for (const rel of [...(await readdir(join(dossier, 'assets/js'))).map((f) => `assets/js/${f}`), 'sw.js']) {
        await writeFile(tmp, await readFile(join(dossier, rel), 'utf8'));
        assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }),
          `${rel} ne se compile plus après retrait des commentaires`);
      }
    } finally {
      await rm(tmp, { force: true });
    }
  });

  test('tout ce que le service worker pré-cache existe dans le site publié', async () => {
    const sw = await readFile(join(dossier, 'sw.js'), 'utf8');
    // Sans la chaîne de requête : le worker de MapLibre est demandé avec ?v=<version>.
    const locaux = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1].split('?')[0]).filter((p) => !p.endsWith('/'));
    for (const rel of locaux) assert.equal(await existe(rel), true, `${rel} est pré-caché mais absent du site publié`);
  });

  // Pièges de la découpe : une regex qui contient des guillemets, un // dans une
  // chaîne ou un gabarit, une division que l'on prendrait pour une regex.
  test('le retrait des commentaires JS respecte chaînes, gabarits et regex', () => {
    const cas = [
      ["const a = 'x//y'; // c\n", "const a = 'x//y';\n"],
      ['s.replace(/[&<>"\']/g, "") // c\n', 's.replace(/[&<>"\']/g, "")\n'],
      ['const t = `a // ${b /* c */} /* d */`;\n', 'const t = `a // ${b } /* d */`;\n'],
      ['const r = a / b; // c\n', 'const r = a / b;\n'],
      ['x();\n  // seul sur sa ligne\ny();\n', 'x();\ny();\n'],
      ['if (/^\\d+$/.test(s)) return /a\\/b/.exec(s);\n', 'if (/^\\d+$/.test(s)) return /a\\/b/.exec(s);\n'],
    ];
    for (const [entree, attendu] of cas) assert.equal(retirerCommentairesJS(entree), attendu);
  });
});

describe('Service worker : les lieux', () => {
  // Oubli silencieux : un lieu absent du PRECACHE s'affiche parfaitement en
  // ligne et ne marche pas hors ligne — c'est-à-dire au seul moment où on en a
  // besoin, en falaise, sans moyen de s'en rendre compte avant d'y être.
  test('chaque lieu a sa page et son data.geojson dans PRECACHE', async () => {
    const sw = await lire('sw.js');
    const manquants = [];
    for (const lieu of LIEUX) {
      for (const fichier of ['index.html', 'data.geojson']) {
        if (!sw.includes(`'./${lieu}/${fichier}'`)) manquants.push(`${lieu}/${fichier}`);
      }
    }
    assert.deepEqual(manquants, [],
      `Absents du PRECACHE de sw.js : ${manquants.join(', ')}. ` +
      'Ces lieux ne se chargeraient pas hors ligne.');
  });

  test('PRECACHE ne cite aucun lieu inexistant', async () => {
    const sw = await lire('sw.js');
    const cites = [...sw.matchAll(/'\.\/([\w-]+)\/data\.geojson'/g)].map((m) => m[1]);
    const fantomes = cites.filter((l) => !LIEUX.includes(l));
    assert.deepEqual(fantomes, [],
      `PRECACHE cite des lieux absents du dépôt : ${fantomes.join(', ')} — ` +
      'l\'install du service worker échouerait entièrement.');
  });

  test('chaque lieu est atteignable depuis l\'accueil', async () => {
    const html = await lire('index.html');
    const orphelins = LIEUX.filter((l) => !html.includes(`href="${l}/"`));
    assert.deepEqual(orphelins, [],
      `Lieux publiés mais absents de la liste de l'accueil : ${orphelins.join(', ')} — ` +
      'personne ne peut y arriver autrement qu\'en devinant l\'URL.');
  });
});
