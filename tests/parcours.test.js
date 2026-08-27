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
  REPERES, CHEMIN_SORTIE,
  exposerCarte, attendreCarte, ouvrirFalaise, nouveauContexte,
} from './aide-carte.js';

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
