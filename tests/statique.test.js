// statique.test.js — vérifications sans navigateur, sans dépendance.
//
// Tourne avec le lanceur intégré de Node (`node --test`) : rien à installer.
// Ce niveau attrape la majorité des régressions vues en pratique, en quelques
// dizaines de millisecondes — il doit rester le filet qu'on lance sans y
// penser, avant même d'ouvrir un navigateur.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (rel) => readFile(join(RACINE, rel), 'utf8');

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
  const css = await lire('assets/style.css');
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

describe('Données exportées', () => {
  // Régression réelle : une reconstruction de la base efface le cache des
  // temps de trajet (alimenté par API, jamais par les CSV). trajet_gite_min
  // repassait à null partout et le curseur « Trajet depuis le gîte »
  // disparaissait du site — silencieusement.
  test('les parkings ont tous un temps de trajet depuis le gîte', async () => {
    const geo = JSON.parse(await lire('sorties/2026-10-drome-saou/data.geojson'));
    const parkings = geo.features.filter((f) => f.properties.categorie === 'parking');

    assert.ok(parkings.length > 0, 'Aucun parking dans data.geojson');
    const sansTrajet = parkings.filter((p) => p.properties.trajet_gite_min == null);
    assert.deepEqual(sansTrajet.map((p) => p.properties.nom), [],
      'trajet_gite_min manquant : relancer scripts/refresh_trajet_gite.py ' +
      '(build_db.py vide ce cache) puis réexporter, sinon le curseur disparaît.');
  });

  test('la table des sources porte auteur et année exploitables', async () => {
    const geo = JSON.parse(await lire('sorties/2026-10-drome-saou/data.geojson'));
    assert.ok(Array.isArray(geo.sources) && geo.sources.length, 'geojson.sources absent');

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

  test('chaque falaise avec des voies pointe vers un fichier routes existant', async () => {
    const geo = JSON.parse(await lire('sorties/2026-10-drome-saou/data.geojson'));
    const fichiers = new Set(await readdir(join(RACINE, 'sorties/2026-10-drome-saou/routes')));

    for (const f of geo.features) {
      const p = f.properties;
      if (!p.routes) continue;
      assert.ok(fichiers.has(`${p.routes}.json`),
        `${p.nom} référence routes/${p.routes}.json, absent du dépôt`);
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

describe('Sécurité : échappement', () => {
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

describe('Pages HTML', () => {
  const pages = ['index.html', 'sorties/2026-10-drome-saou/index.html'];

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

  test('la CSP de la page carte autorise le worker MapLibre depuis le CDN', async () => {
    const html = await lire('sorties/2026-10-drome-saou/index.html');
    // On extrait la valeur de l'attribut content, PAS le HTML brut : le
    // commentaire qui précède la balise mentionne lui aussi « worker-src »,
    // et une recherche naïve tomberait dessus (erreur commise en écrivant ce
    // test — il passait sur le commentaire, pas sur la directive réelle).
    const balise = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*\/?>/.exec(html);
    assert.ok(balise, 'Balise CSP introuvable');
    const politique = balise[1];

    const directive = /worker-src[^;]*/.exec(politique);
    assert.ok(directive, 'worker-src absent de la CSP');
    // Piège vérifié : MapLibre charge maplibre-gl-worker.mjs directement
    // depuis jsdelivr. L'omettre laisse la carte vide SANS aucune violation
    // visible dans la console (une violation dans un worker ne remonte pas).
    assert.match(directive[0], /cdn\.jsdelivr\.net/,
      'worker-src doit inclure le CDN : sinon la carte reste vide, silencieusement.');
    assert.doesNotMatch(politique, /script-src[^;]*unsafe-inline/,
      'script-src ne doit pas autoriser unsafe-inline (scripts externalisés).');
  });
});
