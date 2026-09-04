// parcours.test.js — parcours réels dans un navigateur.
//
// Complète statique.test.js : ici on vérifie ce qui ne se lit pas dans les
// fichiers — que la carte démarre, que les fiches s'ouvrent, et surtout que
// le site se comporte correctement quand le réseau lâche.
//
// Nécessite une connexion : le style du fond de carte vient d'OpenFreeMap.
// Voir tests/LISEZMOI.md.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { demarrerServeur } from './serveur.js';
import {
  REPERES, CHEMIN_SORTIE, trouverLieux,
  exposerCarte, attendreCarte, ouvrirFalaise, nouveauContexte,
} from './aide-carte.js';

const LIEUX = await trouverLieux();

let serveur;
let navigateur;

before(async () => {
  serveur = await demarrerServeur();
  navigateur = await chromium.launch({ args: ['--no-sandbox'] });
});

after(async () => {
  await navigateur?.close();
  await serveur?.arreter();
});

// Les parcours détaillés du reste du fichier se jouent sur la Drôme, dont les
// REPERES sont des falaises précises. Ici, un seul test par lieu : la carte
// s'ouvre-t-elle ? C'est ce qui manquerait le jour où un lieu est ajouté — sa
// page dupliquée peut très bien pointer sur le mauvais data.geojson ou avoir
// perdu une directive CSP, et rien d'autre dans la suite ne le verrait.
describe('Chaque lieu publié démarre', () => {
  for (const lieu of LIEUX) {
    test(`${lieu} : la carte s'ouvre et peint ses falaises`, { timeout: 90000 }, async () => {
      const { contexte, page, erreurs, violationsCsp } = await nouveauContexte(navigateur);
      try {
        await exposerCarte(page);
        await page.goto(`${serveur.base}/${lieu}/index.html`, { waitUntil: 'domcontentloaded' });
        await attendreCarte(page);

        const etat = await page.evaluate(() => ({
          style: window.__carteTest.isStyleLoaded(),
          falaises: window.__carteTest.queryRenderedFeatures({ layers: ['falaises'] }).length,
        }));
        assert.equal(etat.style, true, `${lieu} : le style du fond n'est pas chargé (CSP ? réseau ?)`);
        assert.ok(etat.falaises > 0, `${lieu} : aucune falaise peinte — data.geojson bien rattaché ?`);
        assert.deepEqual(violationsCsp, [], `${lieu} : violations CSP`);
        assert.deepEqual(erreurs, [], `${lieu} : erreurs JavaScript`);
      } finally {
        await contexte.close();
      }
    });
  }
});

describe('Démarrage', () => {
  test('la carte se charge sans erreur ni violation CSP', { timeout: 90000 }, async () => {
    const { contexte, page, erreurs, violationsCsp } = await nouveauContexte(navigateur);
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);

      // Régression possible : une directive CSP trop stricte bloque le worker
      // MapLibre et laisse la carte vide, SANS violation visible dans la page.
      // D'où la vérification directe de l'état du style plutôt que la seule
      // absence d'erreurs.
      const styleCharge = await page.evaluate(() => window.__carteTest.isStyleLoaded());
      assert.equal(styleCharge, true, 'Le style du fond n\'est pas chargé (CSP ? réseau ?)');

      const nbFalaises = await page.evaluate(
        () => window.__carteTest.queryRenderedFeatures({ layers: ['falaises'] }).length
      );
      assert.ok(nbFalaises > 0, 'Aucune falaise peinte sur la carte');

      assert.deepEqual(violationsCsp, [], 'Violations CSP détectées');
      assert.deepEqual(erreurs, [], 'Erreurs JavaScript détectées');
    } finally {
      await contexte.close();
    }
  });

  // Régression réelle : une reconstruction de la base vide le cache des temps
  // de trajet, trajet_gite_min repasse à null, et ce curseur disparaît de
  // l'interface sans le moindre message. statique.test.js couvre la donnée ;
  // ici on couvre le fait qu'elle atteint bien l'écran.
  test('le curseur « trajet depuis le gîte » est proposé', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);

      const filtre = await page.evaluate(() => {
        const bloc = document.getElementById('legende-temps');
        const curseur = document.getElementById('filtre-temps');
        return {
          visible: bloc ? !bloc.hidden : false,
          min: curseur?.min,
          max: curseur?.max,
        };
      });
      assert.equal(filtre.visible, true,
        'Curseur absent : trajet_gite_min probablement null (relancer refresh_trajet_gite.py)');
      assert.ok(Number(filtre.max) > Number(filtre.min), 'Bornes du curseur incohérentes');
    } finally {
      await contexte.close();
    }
  });
});

// Le curseur promet un choix : chacune de ses positions doit laisser au moins
// une falaise. Défaut mesuré sur les DEUX lieux avant correction — la borne
// basse était un Math.floor, donc « ≤ 5 min » alors que la falaise la plus
// proche est à 8 : un cran de tête qui vidait la carte. Pire à Pen-Hir, dont
// les parkings sont à 4 et 5 min du gîte : le curseur n'avait que deux
// positions, dont une qui masquait les 49 falaises.
describe('Filtre « depuis le gîte »', () => {
  for (const lieu of LIEUX) {
    test(`${lieu} : aucune position du curseur ne vide la carte`, { timeout: 90000 }, async () => {
      const { contexte, page } = await nouveauContexte(navigateur);
      try {
        await exposerCarte(page);
        await page.goto(`${serveur.base}/${lieu}/index.html`, { waitUntil: 'domcontentloaded' });
        await attendreCarte(page);

        const r = await page.evaluate(async () => {
          const sl = document.getElementById('filtre-temps');
          const bloc = document.getElementById('legende-temps');
          // Masqué : soit aucun gîte, soit tous les trajets dans le même cran
          // — dans les deux cas il n'y a pas de choix à offrir, c'est correct.
          if (!sl || !bloc || bloc.hidden) return { masque: true };
          const compte = () => window.__carteTest.queryRenderedFeatures({ layers: ['falaises'] }).length;
          const vides = [];
          for (let v = Number(sl.min); v <= Number(sl.max); v += Number(sl.step)) {
            sl.value = String(v);
            sl.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise((res) => setTimeout(res, 110));
            if (compte() === 0) vides.push(v);
          }
          return { masque: false, min: sl.min, max: sl.max, vides };
        });

        if (r.masque) return;
        assert.deepEqual(r.vides, [],
          `${lieu} : position(s) ${r.vides.join(', ')} min du curseur (${r.min}-${r.max}) ` +
          "ne laissent aucune falaise — un cran qui vide la carte n'offre aucun choix.");
      } finally {
        await contexte.close();
      }
    });
  }
});

// Au parking, les deux gestes utiles sont « Itinéraire » et le relevé GPS.
// Ils étaient poussés hors de l'écran par la liste des secteurs desservis :
// au parking principal de Pen-Hir, 45 liens occupaient 396 px alors que la
// partie visible de la fiche mobile en fait 380. La liste se replie désormais
// au-delà d'un seuil ; ce test vérifie l'effet, pas le mécanisme.
describe('Fiche parking chargée', () => {
  for (const lieu of LIEUX) {
    test(`${lieu} : le parking le plus fourni garde ses actions visibles`, { timeout: 90000 }, async () => {
      const { contexte, page } = await nouveauContexte(navigateur, { viewport: { width: 390, height: 844 } });
      try {
        await exposerCarte(page);
        await page.goto(`${serveur.base}/${lieu}/index.html`, { waitUntil: 'domcontentloaded' });
        await attendreCarte(page);

        // Le parking qui dessert le plus de secteurs : c'est lui qui fait mal.
        const cible = await page.evaluate(async () => {
          const geo = await (await fetch('data.geojson')).json();
          const compte = new Map();
          for (const f of geo.features) {
            for (const nom of f.properties.parking_associe || []) {
              compte.set(nom, (compte.get(nom) || 0) + 1);
            }
          }
          const [nom, n] = [...compte.entries()].sort((a, b) => b[1] - a[1])[0] || [];
          if (!nom) return null;
          const el = [...document.querySelectorAll('.maplibregl-marker')]
            .find((e) => (e.getAttribute('aria-label') || '').includes(nom));
          if (!el) return null;
          el.click();
          return { nom, n };
        });
        assert.ok(cible, `${lieu} : aucun marqueur de parking trouvé`);

        await page.waitForSelector('.popup .actions', { timeout: 10000 });
        await page.waitForTimeout(400);

        const vu = await page.evaluate(() => {
          const pop = document.querySelector('.popup');
          const act = pop.querySelector('.actions');
          const r = act.getBoundingClientRect();
          return {
            actionsVisibles: r.top >= 0 && r.bottom <= innerHeight,
            basActions: Math.round(r.bottom),
            vue: innerHeight,
          };
        });
        assert.equal(vu.actionsVisibles, true,
          `${lieu} : « ${cible.nom} » dessert ${cible.n} secteurs et repousse ses actions ` +
          `jusqu'à ${vu.basActions}px sur une vue de ${vu.vue}px — replier la liste.`);
      } finally {
        await contexte.close();
      }
    });
  }
});

describe('Recherche', () => {
  // Le champ ne cherchait que dans « nom · secteur » : taper « Saoû » ne
  // renvoyait RIEN, alors que 40 des 111 secteurs en dépendent et que c'est le
  // nom que tout le monde emploie. Le site s'appelle Saoû, la falaise porte un
  // autre nom — le terme le plus évident était le seul introuvable.
  test('trouve par site, par falaise et par secteur', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);
      // Vue large : toutes les falaises dans le viewport, sinon le comptage
      // mesurerait le cadrage plutôt que le filtre.
      await page.evaluate(() => window.__carteTest.jumpTo({ center: [5.35, 44.70], zoom: 8.5 }));
      await page.waitForTimeout(1200);

      const compter = async (terme) => {
        await page.fill('.recherche-champ input', terme);
        await page.waitForTimeout(700);
        return page.evaluate(() =>
          window.__carteTest.queryRenderedFeatures({ layers: ['falaises'] }).length);
      };

      const total = await compter('');
      assert.ok(total > 50, `Vue de départ trop restreinte (${total} secteurs)`);

      const parSite = await compter('Saoû');
      assert.ok(parSite > 1,
        `« Saoû » ne renvoie que ${parSite} secteur(s) : le SITE n'est pas cherchable — ` +
        'voir le champ "recherche" construit dans marqueurs.js.');
      assert.ok(parSite < total, '« Saoû » doit restreindre, pas tout garder');

      assert.ok(await compter('Grand Regardé') > 0, 'Recherche par nom de falaise cassée');
      assert.ok(await compter('Drayas') > 0, 'Recherche par nom de secteur cassée');
      assert.equal(await compter('zzzz'), 0, 'Un terme absent ne doit rien renvoyer');
    } finally {
      await contexte.close();
    }
  });
});

describe('Filtre par fourchette de cotation', () => {
  test('restreint les falaises et suit les bornes choisies', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);

      // Les bornes ne s'affichent que dans leur mode : ailleurs, elles
      // laisseraient croire qu'elles filtrent.
      assert.equal(await page.evaluate(() => document.getElementById('legende-cotation').hidden), true,
        'La fourchette ne doit pas être visible hors du mode cotation');

      await page.selectOption('#mode-figure', 'cotation');
      await page.waitForTimeout(600);

      const complet = await page.evaluate(() => ({
        visible: !document.getElementById('legende-cotation').hidden,
        crans: document.querySelectorAll('#cotation-min option').length,
        falaises: window.__carteTest.queryRenderedFeatures({ layers: ['falaises'] }).length,
      }));
      assert.equal(complet.visible, true);
      assert.ok(complet.crans > 5,
        'Les listes doivent être peuplées avec les cotations réellement présentes');

      // Fourchette débutant : doit réduire nettement. Sur ce jeu de données,
      // filtrer par PRÉSENCE laisserait ~100 falaises sur 107 ; c'est le
      // comptage par fourchette qui donne du signal.
      await page.selectOption('#cotation-min', { label: '4a' });
      await page.selectOption('#cotation-max', { label: '5c' });
      await page.waitForTimeout(600);

      const restreint = await page.evaluate(() =>
        window.__carteTest.queryRenderedFeatures({ layers: ['falaises'] }).length);
      assert.ok(restreint < complet.falaises,
        `La fourchette doit masquer des falaises (${restreint} vs ${complet.falaises})`);
      // Pas de compte affiché : les modes couenne/grande voie masquent eux
      // aussi sans annoncer de total — n'en afficher un que pour la fourchette
      // serait incohérent. Voir majFourchette (carte.js).
      assert.equal(await page.evaluate(() => Boolean(document.getElementById('cotation-resume'))), false,
        'Le résumé chiffré a été retiré par cohérence entre modes');

      // Bornes croisées : on corrige au lieu de refuser.
      await page.selectOption('#cotation-min', { label: '7a' });
      await page.waitForTimeout(600);
      const croise = await page.evaluate(() => ({
        min: Number(document.getElementById('cotation-min').value),
        max: Number(document.getElementById('cotation-max').value),
      }));
      assert.ok(croise.min <= croise.max,
        'Choisir un minimum supérieur au maximum doit pousser l\'autre borne, pas produire une plage vide');
    } finally {
      await contexte.close();
    }
  });
});

describe('Légende sur mobile', () => {
  // Deux débordements distincts sont déjà passés par là, d'où les DEUX
  // largeurs testées :
  //  - mobile : le correctif iOS (champs à 16 px) avait fait gonfler le
  //    <select>, qui se dimensionne sur son option la plus longue — 297 px
  //    dans une colonne de 280 ;
  //  - bureau : input[type=range] porte un margin:2px de la feuille de style
  //    du navigateur, que width:100% et box-sizing ne rattrapent pas.
  test('aucun débordement horizontal, mode cotation compris', { timeout: 120000 }, async () => {
    for (const vue of [
      { largeur: 390, hauteur: 844, tactile: true, nom: 'mobile' },
      { largeur: 1280, hauteur: 900, tactile: false, nom: 'bureau' },
    ]) {
      const contexte = await navigateur.newContext({
        viewport: { width: vue.largeur, height: vue.hauteur },
        hasTouch: vue.tactile, isMobile: vue.tactile,
      });
      const page = await contexte.newPage();
      try {
        await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
        await page.waitForTimeout(2500);

        const deborde = () => page.evaluate(() => {
          const el = document.querySelector('.legende-contenu');
          return el.scrollWidth > el.clientWidth;
        });
        assert.equal(await deborde(), false, `Débordement de la légende au chargement (${vue.nom})`);

        await page.selectOption('#mode-figure', 'cotation');
        await page.waitForTimeout(700);
        assert.equal(await deborde(), false, `Débordement une fois la fourchette affichée (${vue.nom})`);
      } finally {
        await contexte.close();
      }
    }
  });

  test('le bouton ne reste pas surligné après un tap', { timeout: 90000 }, async () => {
    const contexte = await navigateur.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    });
    const page = await contexte.newPage();
    try {
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
      await page.waitForTimeout(2500);

      const fondNormal = await page.evaluate(() =>
        getComputedStyle(document.querySelector('.legende-toggle')).backgroundColor);

      await (await page.$('.legende-toggle')).tap();
      await page.waitForTimeout(500);

      const apres = await page.evaluate(() => {
        const b = document.querySelector('.legende-toggle');
        return {
          fond: getComputedStyle(b).backgroundColor,
          hauteur: Math.round(b.getBoundingClientRect().height),
          anneau: b.matches(':focus-visible'),
        };
      });
      assert.equal(apres.fond, fondNormal,
        'Le fond de survol reste collé après un tap — règle :hover non protégée par (hover: hover)');
      assert.equal(apres.anneau, false,
        'Pas d\'anneau de focus au tactile (il doit rester réservé au clavier)');
      assert.ok(apres.hauteur >= 44, `Cible tactile de ${apres.hauteur}px, minimum 44px`);
    } finally {
      await contexte.close();
    }
  });
});

describe('En-tête sur mobile', () => {
  // Régression réelle : une fois la carte préparée, le bouton passait de
  // « Hors-ligne » (98px) à « Hors-ligne 28/08 » (144px). Le lien de retour
  // n'avait pas flex-shrink:0 — flex le rétrécissait à 62px, sous la largeur
  // de son propre texte, qui repassait sur DEUX lignes. D'où la flèche qui
  // « se décalait » et le titre coupé.
  // On teste l'invariant plutôt que l'état : quel que soit le libellé porté
  // par le bouton, la navigation ne doit pas bouger. C'est aussi vrai pour
  // les libellés d'erreur, qu'on ne peut pas déclencher facilement.
  test('aucun libellé du bouton ne déforme la navigation', { timeout: 90000 }, async () => {
    const contexte = await navigateur.newContext({
      viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true,
    });
    const page = await contexte.newPage();
    try {
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
      await page.waitForTimeout(2500);

      const depart = await page.evaluate(() => {
        const b = document.querySelector('.btn-preparer');
        return { libelle: b.textContent, aria: b.getAttribute('aria-label'), title: b.title };
      });
      // Un substantif seul (« Hors-ligne ») se lit comme un STATUT dans un
      // en-tête ; le libellé au repos doit nommer l'action.
      assert.equal(depart.libelle, 'Préparer',
        'Le libellé au repos doit être un verbe d\'action');
      assert.ok(depart.aria && depart.aria.length > depart.libelle.length,
        'aria-label doit porter l\'action complète');
      assert.equal(depart.title, depart.aria,
        'title et aria-label ne doivent pas diverger');

      const mesurer = (libelle) => page.evaluate((txt) => {
        const btn = document.querySelector('.btn-preparer');
        if (txt !== null) btn.textContent = txt;
        const lien = document.querySelector('.map-header a').getBoundingClientRect();
        return {
          lienLargeur: Math.round(lien.width),
          lienHauteur: Math.round(lien.height),
          entete: Math.round(document.querySelector('.map-header').getBoundingClientRect().height),
          bouton: Math.round(btn.getBoundingClientRect().width),
          deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      }, libelle);

      const reference = await mesurer(null);

      for (const libelle of ['Préparer', 'Prête', 'Repréparer', 'Annuler', '100 %', 'Espace plein', 'Échec']) {
        const m = await mesurer(libelle);
        assert.equal(m.lienLargeur, reference.lienLargeur,
          `« ${libelle} » rétrécit le lien de retour (${m.lienLargeur}px au lieu de ${reference.lienLargeur})`);
        assert.ok(m.lienHauteur < 24,
          `« ${libelle} » fait passer le lien de retour sur deux lignes (${m.lienHauteur}px)`);
        assert.equal(m.entete, reference.entete,
          `« ${libelle} » change la hauteur de l'en-tête (${m.entete}px)`);
        assert.equal(m.deborde, false, `« ${libelle} » provoque un débordement horizontal`);
      }

      // Le passage « action faite » doit RÉTRÉCIR le bouton, jamais
      // l'élargir : c'est ce qui rend le défaut d'origine impossible.
      const action = (await mesurer('Préparer')).bouton;
      const faite = (await mesurer('Prête')).bouton;
      assert.ok(faite <= action,
        `Le libellé de l'état préparé (${faite}px) doit tenir dans celui de l'action (${action}px)`);
    } finally {
      await contexte.close();
    }
  });
});

describe('Fiche falaise', () => {
  test('affiche les métadonnées, l\'histogramme et la référence topo', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);
      await ouvrirFalaise(page, REPERES.lesRoches);

      const fiche = await page.evaluate(() => ({
        titre: document.querySelector('.popup h3')?.textContent,
        colonnes: Array.from(document.querySelectorAll('.col-label')).map((e) => e.textContent),
        cases: document.querySelectorAll('.histo-case').length,
        groupes: Array.from(document.querySelectorAll('.fiche-groupe-titre')).map((e) => e.textContent),
        badgesPage: Array.from(document.querySelectorAll('.topo-page-badge')).map((e) => e.textContent),
        libelleAchat: document.querySelector('.topo-achat')?.textContent,
        aria: document.querySelector('.voies-histo')?.getAttribute('aria-label'),
      }));

      assert.equal(fiche.titre, 'Les Roches');
      assert.deepEqual(fiche.colonnes, ['Voies', 'Grimpe', 'Roche']);
      assert.equal(fiche.cases, 44, 'Une case par voie sportive');
      assert.deepEqual(fiche.groupes, ['Accès', 'Topo papier', 'Pour aller plus loin']);
      assert.deepEqual(fiche.badgesPage, ['p. 34']);
      assert.equal(fiche.libelleAchat, 'Acheter ce topo',
        'Le libellé doit refléter le type de source (payant / brochure gratuite)');

      // Redondance textuelle exigée par WCAG 1.4.1 : la distinction
      // couenne / grande voie ne doit pas exister QUE dans la couleur.
      assert.match(fiche.aria, /couennes?/,
        'La répartition doit être énoncée dans le résumé accessible');
    } finally {
      await contexte.close();
    }
  });

  test('le détail des voies bascule entre tri cotation et tri position', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);
      await ouvrirFalaise(page, REPERES.laTour); // mixte couennes + grandes voies

      await page.click('.btn-voir-detail-voies');
      await page.waitForSelector('.detail-voies-liste', { timeout: 10000 });

      const cotation = await page.evaluate(() => ({
        actif: document.querySelector('.btn-tri-voies.actif')?.dataset.tri,
        sousLignes: document.querySelectorAll('.detail-voie-longueur').length,
      }));
      assert.equal(cotation.actif, 'cotation', 'Le tri par cotation est le défaut');
      assert.equal(cotation.sousLignes, 0,
        'Le tri cotation ne doit pas éclater les grandes voies en longueurs');

      await page.click('.btn-tri-voies[data-tri="position"]');
      await page.waitForTimeout(300);

      const position = await page.evaluate(() => ({
        actif: document.querySelector('.btn-tri-voies.actif')?.dataset.tri,
        sousLignes: document.querySelectorAll('.detail-voie-longueur').length,
      }));
      assert.equal(position.actif, 'position');
      assert.ok(position.sousLignes > 0,
        'Le tri position doit détailler les longueurs des grandes voies');

      await page.click('.btn-retour-fiche');
      await page.waitForTimeout(300);
      const retour = await page.evaluate(() => Boolean(document.querySelector('.voies-histo')));
      assert.equal(retour, true, 'Le retour doit ramener à l\'histogramme');
    } finally {
      await contexte.close();
    }
  });
});

// Deux façons d'atteindre une falaise sans passer par le champ de recherche.
// Toutes deux sont dans le chemin de démarrage (carte.js, ouvrirLienProfond
// et ajouterLabelsDeSite) : elles s'exécutent une fois, au chargement, et un
// échec y est silencieux — la carte s'affiche normalement, simplement pas là
// où on l'attendait.
describe('Navigation directe', () => {
  // Le lien produit par « Partager » est la façon dont un secteur circule
  // dans le club. L'URL n'est pas fabriquée par le test : on reprend celle
  // que le bouton construirait vraiment, sinon on ne testerait que sa propre
  // idée du format.
  test('un lien partagé rouvre la fiche de la bonne falaise', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    let lien;
    let nomAttendu;
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);
      await ouvrirFalaise(page, REPERES.laTour);

      const partage = await page.evaluate(() => {
        const btn = document.querySelector('.popup .btn-partager');
        return btn && {
          requete: `?falaise=${encodeURIComponent(btn.dataset.cle)}`,
          nom: document.querySelector('.popup h3')?.textContent,
        };
      });
      assert.ok(partage, 'Pas de bouton « Partager » dans la fiche');
      lien = CHEMIN_SORTIE + partage.requete;
      nomAttendu = partage.nom;
    } finally {
      await contexte.close();
    }

    const { contexte: contexte2, page: page2, erreurs } = await nouveauContexte(navigateur);
    try {
      await exposerCarte(page2);
      await page2.goto(serveur.base + lien, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page2);
      await page2.waitForSelector('.popup h3', { timeout: 15000 });

      const titre = await page2.textContent('.popup h3');
      assert.equal(titre, nomAttendu, 'Le lien partagé n\'ouvre pas la bonne fiche');
      assert.deepEqual(erreurs, [], 'Erreurs JavaScript détectées');
    } finally {
      await contexte2.close();
    }
  });

  // Le nom de site est le seul repère qui cadre sur PLUSIEURS falaises d'un
  // coup ; rien d'autre dans la suite ne l'active.
  //
  // La caméra est délibérément envoyée AILLEURS entre la sélection du libellé
  // et le clic : sans ce détour, la première version de ce test passait
  // encore après suppression du fitBounds du gestionnaire — le site restait
  // dans le cadre de la vue d'ensemble, donc l'assertion ne mesurait rien.
  // Le clic reste possible hors écran, le marqueur MapLibre restant dans le
  // DOM quelle que soit la position de la caméra.
  test('cliquer un nom de site cadre sur toutes ses falaises', { timeout: 90000 }, async () => {
    const { contexte, page, erreurs } = await nouveauContexte(navigateur);

    // Les falaises d'un site donné sont-elles toutes dans le cadre courant ?
    const cadreContient = (nomSite) => page.evaluate(async (s) => {
      const geo = await (await fetch('data.geojson')).json();
      const bornes = window.__carteTest.getBounds();
      const points = geo.features
        .filter((f) => f.properties.categorie === 'falaise' && f.properties.site === s)
        .map((f) => f.geometry.coordinates);
      return { nb: points.length, toutes: points.every((c) => bornes.contains(c)), aucune: points.every((c) => !bornes.contains(c)) };
    }, nomSite);

    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);

      // Les noms de site disparaissent au-delà de ZOOM_LABELS_SECTEUR (15) :
      // c'est la vue d'ensemble qu'il faut pour en trouver un.
      await page.evaluate(() => window.__carteTest.jumpTo({ zoom: 11 }));
      await page.waitForTimeout(800);

      const site = await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('.label-site'))
          .find((e) => e.style.visibility !== 'hidden' && e.offsetWidth > 0);
        return el ? el.textContent : null;
      });
      assert.ok(site, 'Aucun nom de site visible en vue d ensemble');

      // Détour : on se pose sur la falaise la plus éloignée du site visé.
      await page.evaluate(async (s) => {
        const geo = await (await fetch('data.geojson')).json();
        const falaises = geo.features.filter((f) => f.properties.categorie === 'falaise');
        const [lon0, lat0] = falaises.find((f) => f.properties.site === s).geometry.coordinates;
        const distance = (c) => (c[0] - lon0) ** 2 + (c[1] - lat0) ** 2;
        const loin = falaises.map((f) => f.geometry.coordinates).sort((a, b) => distance(b) - distance(a))[0];
        window.__carteTest.jumpTo({ center: loin, zoom: 14 });
      }, site);
      await page.waitForTimeout(600);

      const depart = await cadreContient(site);
      assert.ok(depart.nb > 0, `Site ${site} introuvable dans data.geojson`);
      assert.equal(depart.aucune, true, `Le détour n a pas sorti ${site} du cadre : le test ne mesurerait rien`);

      await page.evaluate((s) => {
        Array.from(document.querySelectorAll('.label-site')).find((e) => e.textContent === s).click();
      }, site);
      await page.waitForTimeout(1800); // fitBounds animé

      const arrivee = await cadreContient(site);
      assert.equal(arrivee.toutes, true,
        `Les ${depart.nb} falaises de ${site} ne sont pas revenues dans le cadre après le clic`);
      assert.deepEqual(erreurs, [], 'Erreurs JavaScript détectées');
    } finally {
      await contexte.close();
    }
  });
});
describe('Résilience réseau', () => {
  // LE bug de référence : la promesse rejetée restait en cache, donc réessayer
  // échouait même une fois le réseau revenu. Service worker désactivé, sinon
  // il sert les données depuis son cache et le chemin d'échec n'est jamais
  // emprunté.
  test('un échec de chargement est signalé, puis rattrapable', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur, { serviceWorkers: 'block' });
    try {
      let couper = true;
      await page.route('**/routes/*.json', (route) => (couper ? route.abort('failed') : route.continue()));
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);
      await ouvrirFalaise(page, REPERES.lesRoches);

      const enPanne = await page.evaluate(() => ({
        message: Boolean(document.querySelector('.detail-indisponible')),
        bouton: Boolean(document.querySelector('.btn-reessayer-voies')),
        histo: Boolean(document.querySelector('.voies-histo')),
      }));
      assert.equal(enPanne.message, true,
        'Un échec doit être annoncé, pas faire disparaître silencieusement le bloc');
      assert.equal(enPanne.bouton, true, 'Un bouton Réessayer doit être proposé');
      assert.equal(enPanne.histo, false);

      couper = false;
      await page.click('.btn-reessayer-voies');
      await page.waitForSelector('.voies-histo', { timeout: 10000 });

      const retabli = await page.evaluate(() => ({
        cases: document.querySelectorAll('.histo-case').length,
        message: Boolean(document.querySelector('.detail-indisponible')),
      }));
      assert.ok(retabli.cases > 0,
        'Réessayer doit repartir sur le réseau : si la promesse rejetée reste ' +
        'en cache, ce clic ne peut jamais aboutir.');
      assert.equal(retabli.message, false);
    } finally {
      await contexte.close();
    }
  });

  test('le bandeau hors-ligne suit l\'état du réseau', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);

      const lire = () => page.evaluate(() => document.querySelector('.bandeau-hors-ligne')?.hidden);
      assert.equal(await lire(), true, 'Bandeau masqué tant qu\'on est en ligne');

      await contexte.setOffline(true);
      await page.waitForTimeout(500);
      assert.equal(await lire(), false, 'Bandeau affiché hors ligne');

      await contexte.setOffline(false);
      await page.waitForTimeout(500);
      assert.equal(await lire(), true, 'Bandeau masqué au retour du réseau');
    } finally {
      await contexte.close();
    }
  });

  // L'indicateur était une barre pleine largeur ancrée en bas, en z-index 30 :
  // il masquait ENTIÈREMENT l'attribution OpenStreetMap (obligation de
  // crédit), mangeait 7px de la légende dépliée et 27px de la fiche mobile.
  // La règle qui en sort : recouvrir le canevas de carte est gratuit,
  // recouvrir de l'interface ne l'est pas.
  test('l\'indicateur hors-ligne ne recouvre aucun élément d\'interface',
    { timeout: 150000 }, async () => {
      const chevauche = (a, b) => Boolean(a && b)
        && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

      for (const vue of [
        { largeur: 390, hauteur: 844, tactile: true, nom: 'mobile' },
        { largeur: 1280, hauteur: 900, tactile: false, nom: 'bureau' },
      ]) {
        const { contexte, page } = await nouveauContexte(navigateur, {
          viewport: { width: vue.largeur, height: vue.hauteur },
        });
        try {
          await exposerCarte(page);
          await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
          await attendreCarte(page);
          await contexte.setOffline(true);
          await page.waitForTimeout(600);

          const releve = () => page.evaluate(() => {
            const g = (s) => {
              const e = document.querySelector(s);
              if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
              const b = e.getBoundingClientRect();
              return b.width && b.height
                ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom } : null;
            };
            return {
              puce: g('.bandeau-hors-ligne'),
              attribution: g('.maplibregl-ctrl-bottom-right'),
              legende: g('.legende'),
              fiche: g('.maplibregl-popup'),
              recherche: g('.recherche'),
              zoom: g('.maplibregl-ctrl-top-right'),
            };
          });

          const controler = async (etat) => {
            const r = await releve();
            assert.ok(r.puce, `${vue.nom} / ${etat} : l'indicateur doit être visible hors ligne`);
            assert.ok(r.attribution,
              `${vue.nom} / ${etat} : l'attribution OpenStreetMap doit rester visible`);
            for (const cible of ['attribution', 'legende', 'fiche', 'recherche', 'zoom']) {
              assert.equal(chevauche(r.puce, r[cible]), false,
                `${vue.nom} / ${etat} : l'indicateur recouvre ${cible}`);
            }
          };

          await controler('au repos');
          // Légende dépliée puis fiche ouverte : les deux états qui remplissent
          // le bas de l'écran, donc ceux où l'ancien bandeau gênait.
          await ouvrirFalaise(page, REPERES.lesRoches);
          await controler('fiche ouverte');
        } finally {
          await contexte.close();
        }
      }
    });

  // Le pire défaut trouvé sur cette fonctionnalité : hors ligne, un clic sur
  // « Préparer » enregistrait « prête, 463 tuiles » en UNE seconde alors que
  // 465 fichiers sur 469 avaient échoué. Une confiance fausse ne se découvre
  // qu'au pied de la falaise, sans réseau pour rattraper.
  test('hors ligne, préparer est refusé et n\'enregistre aucune fausse réussite',
    { timeout: 120000 }, async () => {
      const { contexte, page } = await nouveauContexte(navigateur);
      try {
        await exposerCarte(page);
        await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
        await attendreCarte(page);
        await page.evaluate(() => localStorage.removeItem('preparation-hors-ligne'));

        await contexte.setOffline(true);
        await page.waitForTimeout(600);

        const bouton = () => page.evaluate(() => {
          const b = document.querySelector('.btn-preparer');
          return { libelle: b.textContent, desactive: b.disabled, title: b.title };
        });
        const avant = await bouton();
        assert.equal(avant.desactive, true,
          'Hors ligne, préparer ne peut rien produire : le bouton doit être désactivé');
        assert.match(avant.title, /réseau/i, 'La raison doit être dite, pas seulement le grisé');

        // Clic forcé : désactiver ne suffit pas, le réseau peut aussi tomber
        // PENDANT une préparation. C'est le garde-fou sur le résultat qui doit
        // tenir, seul.
        await page.evaluate(() => {
          const b = document.querySelector('.btn-preparer');
          b.disabled = false;
          b.click();
        });
        await page.waitForFunction(
          () => !/%|Annuler/.test(document.querySelector('.btn-preparer').textContent),
          { timeout: 60000 }
        );

        const apres = await bouton();
        assert.equal(apres.libelle, 'Échec',
          'Un lot entièrement en échec ne doit jamais s\'afficher comme une réussite');
        assert.equal(
          await page.evaluate(() => localStorage.getItem('preparation-hors-ligne')), null,
          'Aucun état ne doit être écrit : un état correct antérieur doit survivre'
        );
        assert.match(apres.title, /sans réseau/i, 'La cause doit être nommée');
      } finally {
        await contexte.close();
      }
    });

  // Régression réelle : un module ajouté sans être pré-caché faisait échouer
  // l'import et donc TOUTE la carte, au premier chargement hors ligne.
  test('la page se recharge entièrement hors ligne', { timeout: 120000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    try {
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
      // Laisse le service worker terminer son pré-cache (install + routes).
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForTimeout(3000);

      await contexte.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
      await page.waitForTimeout(2000);

      const horsLigne = await page.evaluate(() => ({
        marqueursOuLegende: Boolean(document.querySelector('.legende-contenu')),
        erreurDonnees: Boolean(document.querySelector('.etat-chargement.erreur')),
        boutonPreparer: Boolean(document.querySelector('.btn-preparer')),
      }));
      assert.equal(horsLigne.erreurDonnees, false,
        'Les données doivent venir du pré-cache, sans erreur');
      assert.equal(horsLigne.marqueursOuLegende, true);
      assert.equal(horsLigne.boutonPreparer, true,
        'hors-ligne.js doit être pré-caché, sinon son import fait tomber toute la carte');
    } finally {
      await contexte.close();
    }
  });

  // Les liens du site pointent vers des RÉPERTOIRES (/sorties/x/) alors que
  // PRECACHE contient des fichiers (/sorties/x/index.html) : sans le repli
  // vers index.html dans le handler de navigation, la clé de cache ne
  // correspond pas et la page est introuvable hors ligne — alors qu'elle est
  // bel et bien en cache.
  test('l\'URL courte d\'une sortie se charge hors ligne', { timeout: 120000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    const REPERTOIRE_SORTIE = CHEMIN_SORTIE.replace(/index\.html$/, '');
    try {
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForTimeout(3000);

      await contexte.setOffline(true);
      await page.goto(serveur.base + REPERTOIRE_SORTIE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
      await page.waitForTimeout(2000);

      assert.equal(
        await page.evaluate(() => Boolean(document.querySelector('.legende-contenu'))), true,
        'La page doit se charger depuis le cache même demandée par son URL de répertoire'
      );
      assert.equal(
        await page.evaluate(() => Boolean(document.querySelector('.etat-chargement.erreur'))), false,
        'Aucune erreur de données attendue : tout vient du pré-cache'
      );
    } finally {
      await contexte.close();
    }
  });

  // Télécharger 21 Mo ne sert à rien si le navigateur les évince avant la
  // sortie (stockage « best-effort » par défaut ; WebKit purge en plus après
  // 7 jours sans visite). Deux exigences se testent ici :
  //  - persist() ne doit PAS partir au chargement, sinon on réclame une
  //    permission avant que l'utilisateur ait exprimé quoi que ce soit ;
  //  - quand la durabilité n'est pas acquise, « Prête » doit le dire.
  test('la préparation réclame un stockage durable, et le dit si elle ne l\'obtient pas',
    { timeout: 120000 }, async () => {
      for (const durable of [false, true]) {
        // serviceWorkers bloqués : au rechargement, le SW resservirait
        // carte.js depuis SON cache, hors de portée de page.route — la carte
        // ne serait alors jamais exposée aux tests. Le SW n'est pas le sujet
        // ici (il l'est dans le test précédent).
        const { contexte, page } = await nouveauContexte(navigateur, { serviceWorkers: 'block' });
        try {
          await page.addInitScript((valeur) => {
            window.__appelsStockage = [];
            const vrai = navigator.storage;
            Object.defineProperty(navigator, 'storage', {
              configurable: true,
              value: {
                persisted: async () => { window.__appelsStockage.push('persisted'); return valeur; },
                persist: async () => { window.__appelsStockage.push('persist'); return valeur; },
                estimate: () => vrai.estimate(),
              },
            });
          }, durable);
          await exposerCarte(page);
          await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
          await attendreCarte(page);

          // Simuler une carte déjà préparée SANS télécharger 21 Mo : il faut
          // le vrai segment de build, sinon le bouton bascule sur
          // « Repréparer » et on ne teste pas l'état visé.
          const modele = await page.evaluate(() => {
            const url = window.__carteTest.getSource('openmaptiles').tiles[0];
            const m = /\/planet\/([^/]+)\//.exec(url);
            return m ? m[1] : url;
          });
          await page.evaluate((mod) => localStorage.setItem('preparation-hors-ligne',
            JSON.stringify({ date: new Date().toISOString(), modele: mod, nbTuiles: 463 })), modele);

          await page.reload({ waitUntil: 'domcontentloaded' });
          await attendreCarte(page);
          await page.waitForTimeout(800);

          const vu = await page.evaluate(() => {
            const b = document.querySelector('.btn-preparer');
            return { libelle: b.textContent, title: b.title, appels: window.__appelsStockage.slice() };
          });

          assert.equal(vu.libelle, 'Prête', `Libellé inattendu (durable=${durable})`);
          assert.ok(vu.appels.includes('persisted'),
            'persisted() doit être interrogé au montage, sinon la description ment aux visites suivantes');
          assert.ok(!vu.appels.includes('persist'),
            'persist() ne doit être demandé qu\'au clic, jamais au chargement');
          assert.equal(vu.title.includes('peut libérer cet espace'), !durable,
            `La réserve sur la durabilité doit apparaître si et seulement si elle n'est pas acquise (durable=${durable})`);
        } finally {
          await contexte.close();
        }
      }
    });
});

describe('Accessibilité et sécurité', () => {
  test('le focus entre dans la fiche puis revient au déclencheur', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur);
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);

      // Parcours clavier réel : la recherche est le chemin praticable, les
      // falaises étant peintes dans une couche native non focalisable.
      await page.fill('input[type="search"]', 'Les Roches');
      await page.waitForTimeout(400);
      await page.focus('.btn-centrer');
      const avant = await page.evaluate(() => document.activeElement?.className);

      await page.keyboard.press('Enter');
      await page.waitForSelector('.popup', { timeout: 10000 });
      await page.waitForTimeout(800);

      const pendant = await page.evaluate(() =>
        document.getElementById('panneau-falaise')?.contains(document.activeElement));
      assert.equal(pendant, true, 'Le focus doit entrer dans la fiche à l\'ouverture');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const apres = await page.evaluate(() => document.activeElement?.className);
      assert.equal(apres, avant, 'Le focus doit revenir à l\'élément déclencheur');
    } finally {
      await contexte.close();
    }
  });

  test('le mouvement réduit est respecté (caméra et transitions)', { timeout: 90000 }, async () => {
    const contexte = await navigateur.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await contexte.newPage();
    try {
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);

      const resultat = await page.evaluate(async () => {
        const { dureeAnimation } = await import('/assets/js/carte-utils.js');
        const sonde = document.querySelector('#panneau-falaise');
        return {
          duree: dureeAnimation(800),
          transition: getComputedStyle(sonde).transitionDuration,
        };
      });

      assert.equal(resultat.duree, 0,
        'Les vols de caméra doivent être instantanés quand le mouvement réduit est demandé');
      // Comparaison NUMÉRIQUE : le navigateur peut renvoyer la durée en
      // notation scientifique ("1e-05s"), qu'un test sur la chaîne raterait.
      const secondes = Number.parseFloat(resultat.transition);
      assert.ok(Number.isFinite(secondes) && secondes < 0.05,
        `Les transitions doivent être neutralisées (obtenu : ${resultat.transition})`);
    } finally {
      await contexte.close();
    }
  });

  test('des données piégées n\'injectent ni attribut ni URL exécutable', { timeout: 90000 }, async () => {
    const { contexte, page } = await nouveauContexte(navigateur, { serviceWorkers: 'block' });
    try {
      await page.route('**/data.geojson', async (route) => {
        const reponse = await route.fetch();
        const geo = JSON.parse(await reponse.text());
        const cible = geo.features.find((f) => f.properties.nom === 'Les Roches');
        cible.properties.nom = 'Piege" onmouseover="window.__injecte=1" data-x="';
        cible.properties.lien_oblyk = 'javascript:window.__injecte2=1';
        await route.fulfill({
          response: reponse,
          body: JSON.stringify(geo),
          headers: { ...reponse.headers(), 'content-type': 'application/json' },
        });
      });
      await exposerCarte(page);
      await page.goto(serveur.base + CHEMIN_SORTIE, { waitUntil: 'domcontentloaded' });
      await attendreCarte(page);
      await ouvrirFalaise(page, REPERES.lesRoches);
      await page.hover('.popup h3').catch(() => {});
      await page.waitForTimeout(300);

      const resultat = await page.evaluate(() => ({
        injecte: Boolean(window.__injecte || window.__injecte2),
        titre: document.querySelector('.popup h3')?.textContent,
        schemas: Array.from(document.querySelectorAll('.popup a'))
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && h.toLowerCase().startsWith('javascript:')),
      }));

      assert.equal(resultat.injecte, false, 'Du code injecté par les données a été exécuté');
      assert.match(resultat.titre, /^Piege" onmouseover=/,
        'Le nom piégé doit s\'afficher comme du texte littéral');
      assert.deepEqual(resultat.schemas, [], 'Une URL javascript: a survécu à urlSure');
    } finally {
      await contexte.close();
    }
  });
});
