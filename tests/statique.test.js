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
    const geo = JSON.parse(await lire('drome-saou/data.geojson'));
    const parkings = geo.features.filter((f) => f.properties.categorie === 'parking');

    assert.ok(parkings.length > 0, 'Aucun parking dans data.geojson');
    const sansTrajet = parkings.filter((p) => p.properties.trajet_gite_min == null);
    assert.deepEqual(sansTrajet.map((p) => p.properties.nom), [],
      'trajet_gite_min manquant : relancer scripts/refresh_trajet_gite.py ' +
      '(build_db.py vide ce cache) puis réexporter, sinon le curseur disparaît.');
  });

  test('la table des sources porte auteur et année exploitables', async () => {
    const geo = JSON.parse(await lire('drome-saou/data.geojson'));
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

  // Le filtre par fourchette lit ce résumé au chargement : sans lui, il
  // faudrait télécharger routes/*.json (350 Ko) juste pour savoir quelles
  // falaises afficher.
  test('chaque falaise sportive embarque sa répartition de cotations', async () => {
    const geo = JSON.parse(await lire('drome-saou/data.geojson'));
    const sportives = geo.features.filter((f) => (f.properties.nb_voie_sportive || 0) > 0);

    assert.ok(sportives.length > 0, 'Aucune falaise sportive dans data.geojson');
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

  test('chaque falaise avec des voies pointe vers un fichier routes existant', async () => {
    const geo = JSON.parse(await lire('drome-saou/data.geojson'));
    const fichiers = new Set(await readdir(join(RACINE, 'drome-saou/routes')));

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
    const css = await lire('assets/style.css');
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
  // ailleurs. Constaté sur le bouton Masquer/Afficher de la légende.
  test('aucun état de survol hors de @media (hover: hover)', async () => {
    const css = (await lire('assets/style-carte.css')).replace(/\/\*[\s\S]*?\*\//g, '');
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
    const css = await lire('assets/style-carte.css');
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
    const carte = await lire('assets/style-carte.css');
    const base = await lire('assets/style.css');
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
  // la carte. Le poids visuel du sélecteur se règle par la POLICE (voir
  // .legende-figure select), pas par la taille.
  test('les contrôles de formulaire font 16 px sur mobile', async () => {
    const css = await lire('assets/style-carte.css');
    // Ancrer sur la SECTION mobile : `.recherche-champ input` existe aussi en
    // règle de base (à --fs-base), qu'un motif non ancré attrapait d'abord.
    const ancre = css.indexOf('Champs de saisie sur mobile');
    assert.ok(ancre > -1, 'Section « Champs de saisie sur mobile » introuvable');
    const section = css.slice(ancre);

    for (const selecteur of ['.recherche-champ input', '#mode-figure', '#cotation-min', '#cotation-max']) {
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
    for (const page of ['index.html', 'drome-saou/index.html']) {
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
  const pages = ['index.html', '404.html', 'drome-saou/index.html'];

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
    const html = await lire('drome-saou/index.html');
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
