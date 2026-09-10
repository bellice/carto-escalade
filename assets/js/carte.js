/* carte.js — point d'entrée : orchestration de la carte pour une page sortie.
   Chaque page sortie importe initCarte(dataUrl) et l'appelle avec le chemin
   vers son propre data.geojson. */

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs';
import { escapeHtml } from './utils.js';
import {
  indexerParkingInfos, calculerMaxima, calculerTempsDepuisGite, indexerSources,
  estFalaiseVideDansMode, libelleFalaise,
  compterDansFourchette, valeurCotationApprochee,
  cotationVersValeur, approximerCotation,
} from './donnees.js';
import { construireSourceFalaises, couleurFalaisePourMode, infosLegendePourMode, construireLegendeFalaises } from './symboles.js';
import { addMarker, ouvrirPopupFalaise, ouvrirPanneauFalaise, fermerPanneauFalaise, cablerFermetureManuellePanneau, masquerDetailVoies } from './marqueurs.js';
import { ajouterLabelsSites, ajouterLabelsSecteurs, ZOOM_LABELS_SECTEUR } from './labels.js';
import { margeAvantPopup, margeToutVoir, creerControleToutVoir, reinitialiserPadding, limiterZoneCarte, estDesktop, dureeAnimation, dureeReduite } from './carte-utils.js';
import { monterPreparationHorsLigne } from './hors-ligne.js';
import { cablerActionsFiche } from './actions-fiche.js';

// Seuil de zoom en dessous duquel les falaises sont simplifiées en petit
// point uniforme (voir appliquerSimplificationZoom dans initCarte) — à
// ajuster après un premier test réel sur le terrain.
const ZOOM_SIMPLIFICATION = 13;

// Plafond de la vue d'ensemble (cadrage initial et bouton "Tout voir") : au
// plus près de ZOOM_SIMPLIFICATION sans l'atteindre (le seuil ci-dessus est
// une inégalité STRICTE — s'arrêter pile à 13 afficherait encore les cercles
// pleine taille). Volontairement PAS ZOOM_SIMPLIFICATION - 1 : ce plafond n'a
// besoin que de franchir le seuil, pas de laisser de la marge pour explorer
// en mode points (c'est le rôle du plancher de dézoom dans limiterZoneCarte,
// qui lui garde ce -1). Une marge plus large ici zoomerait plus arrière que
// nécessaire sur un lieu compact, avec un vide inutile autour du massif.
const ZOOM_VUE_ENSEMBLE_MAX = ZOOM_SIMPLIFICATION - 0.1;

// Au-delà de ce zoom, les parkings sont visibles par défaut, sans recherche
// ni falaise sélectionnée (voir appliquerVisibiliteParkings). Calé sur
// ZOOM_LABELS_SECTEUR (labels.js) : le repère "vue détaillée", où l'info
// parking devient la plus actionnable et où les marqueurs sont assez espacés
// pour ne pas se chevaucher. En dessous, ils restent masqués — révélés par
// recherche/sélection seulement.
const ZOOM_PARKINGS = 15;

export function initCarte(dataUrl) {
  // Créée seulement une fois data.geojson chargé, pour pouvoir passer les
  // bounds réelles au constructeur — voir creerCarte.
  let map;

  // Détail des voies d'une falaise (routes/<id>.json), à côté du fichier de
  // données principal dans le dossier de la sortie — charge uniquement la
  // falaise dont on ouvre la fiche (voir marqueurs.js, popup.on('open')).
  const baseRoutes = dataUrl.slice(0, dataUrl.lastIndexOf('/') + 1) + 'routes/';

  // Couleur des falaises en vue d'ensemble (ancien .zoom-eloigne) : résolue
  // depuis le token CSS --clay — MapLibre n'accepte pas var() dans toutes les
  // expressions de style, on lit la valeur réelle une fois au démarrage.
  const couleurCss = (nom) => getComputedStyle(document.documentElement).getPropertyValue(nom).trim() || '#a8452f';
  const COULEUR_ELOIGNE = couleurCss('--clay');

  // Contexte partagé pour ouvrirPopupFalaise (couche native) : mêmes
  // callbacks que les popups des marqueurs DOM parking/gîte.
  const ctxPopup = {
    enSurbrillance,
    onSelectionFalaise: definirFalaiseSelectionnee,
    suivrePopup,
    estFicheReduite: () => ficheReduite,
    urlRoute: (id) => baseRoutes + id + '.json',
  };

  // Contexte pour ouvrirPanneauFalaise (panneau latéral desktop) : pas
  // estFicheReduite (concept mobile uniquement, sans objet pour un panneau
  // desktop). onFermeturePanneau vide la sélection à la fermeture — carte.js
  // reste seul propriétaire de falaiseSelectionneeCle, voir le commentaire
  // dans fermerPanneauFalaise (marqueurs.js) sur pourquoi ce comportement
  // diverge délibérément de la fermeture d'une popup mobile.
  const ctxPanneau = {
    enSurbrillance,
    onSelectionFalaise: definirFalaiseSelectionnee,
    suivrePopup,
    urlRoute: (id) => baseRoutes + id + '.json',
    onFermeturePanneau: () => { falaiseSelectionneeCle = null; appliquerFiltresEtSecteurs(); },
  };

  // Le panneau falaise desktop est-il ouvert ? État réel porté par le DOM
  // (classe .ouvert sur #panneau-falaise), PAS par popupOuverte : ouvrir une
  // popup parking/gîte pendant que le panneau est ouvert écrase popupOuverte
  // (qui n'est alors plus le panneau) sans fermer le panneau — toute logique
  // de fermeture (clic hors falaise, Échap) doit donc lire le DOM, pas
  // popupOuverte.estPanneauFalaise.
  const panneauFalaiseOuvert = () => estDesktop() && document.getElementById('panneau-falaise')?.classList.contains('ouvert');

  const entries = []; // { marker, cat, nom, secteur, cle, recherche, parkingAssocie, nbVoies, nbGrandeVoie, nbCouenne, tempsGite }
  const index = new Map(); // cle -> entree, pour naviguer vers un marqueur lié
  let labelsSecteurs = []; // [{el, marker, nom, cle}], peuplé une fois le geojson chargé
  let labelsSites = []; // [{el, marker, site}], peuplé une fois le geojson chargé — voir appliquerAntiCollisionSites
  const entriesParSecteur = new Map(); // clé de regroupement secteur -> entrees falaise, pour appliquerAntiCollisionSecteurs
  const entriesParSite = new Map(); // site -> entrees falaise, pour appliquerAntiCollisionSites
  let secteursVisibles = null; // vrai quand les noms de secteur sont affichés (zoom >= ZOOM_LABELS_SECTEUR)
  let sitesVisibles = null; // vrai quand les noms de site sont affichés (zoom < ZOOM_LABELS_SECTEUR) — miroir de secteursVisibles, voir appliquerVisibiliteSites
  let falaisesVisibles = new Set(); // clés des falaises actuellement affichées (couche native) — voir appliquerFiltres
  let parkingsAutorises = new Set(); // noms des parkings autorisés (falaises visibles) — voir appliquerFiltres/appliquerVisibiliteParkings
  const etatEstompeParCle = new Map(); // dernier état feature-state "estompe" posé par enSurbrillance, pour ne pas re-poser à l'identique
  // tempsMaxGite/tempsGitePlafond : Infinity tant que le slider n'est pas
  // configuré (pas de falaise sans filtre actif avant que les vraies bornes
  // ne soient connues, voir configurerFiltreTemps) — tempsGitePlafond sert
  // de référence "aucun filtre actif" (voir appliquerFiltres/reinitialiserFiltreTemps),
  // pas de sentinelle séparée à garder synchronisée ailleurs.
  // ensoleillement: tableau des catégories cochées (matin/apres-midi/
  // journee/nord — jamais 'aucune') — vide = aucun filtre actif. Plusieurs
  // cochables à la fois EN OU, chacune une correspondance EXACTE : pas de
  // règle implicite qui devinerait qu'on veut aussi "journee" en cochant
  // Matin + Après-midi (essayé, retiré). Les deux besoins sont réels et
  // opposés — "au moins ce moment-là, peu importe le reste" et "CE moment
  // précis, pas plus" — la coche explicite est la seule façon de les
  // distinguer sans deviner : qui veut le premier coche Journée EN PLUS,
  // qui veut le second ne coche que son bouton. Voir
  // configurerFiltreEnsoleillement.
  const filtres = {
    recherche: '', tempsMaxGite: Infinity, tempsGitePlafond: Infinity, ensoleillement: [],
    // Fourchette de cotation : filtre à part entière, au même titre
    // qu'Ensoleillement ou "Depuis le gîte" — il n'agit ni sur la taille ni
    // sur la couleur des cercles, seulement sur qui reste affiché, et se
    // combine avec "Type de voie" (ce n'est pas un mode de definirModeFigure).
    // min/max : bornes choisies ; plancher/plafond : amplitude réelle des
    // cotations de cette sortie (posés par preparerFourchette). Inactif tant
    // que les deux bornes sont à leurs extrêmes — même logique que le curseur
    // du gîte au plafond. Voir filtreCotationActif / appliquerFiltreCotation.
    cotationMin: -Infinity, cotationMax: Infinity,
    cotationPlancher: -Infinity, cotationPlafond: Infinity,
  };
  let modeFigureActuel = 'aucun'; // mode courant de "Type de voie" (aucun/couenne/gv) — voir appliquerFiltres()
  // Bouton "Épurer" : indépendant de modeFigureActuel (voir construireSourceFalaises)
  // — un filtre "Type de voie" ou "Cotation des voies" actif le reste une
  // fois la vue épurée.
  let epureeActuelle = false;
  let falaiseSelectionneeCle = null; // falaise dont la popup est ouverte (ou origine/cible d'une navigation) — voir appliquerFiltres()

  // Déclarés tôt (référencés par allerVers/reinitialiserRecherche ci-dessous,
  // câblés plus bas dans la fonction).
  const recherche = document.querySelector('.recherche input');
  const btnCentrer = document.querySelector('.btn-centrer');
  const btnEffacer = document.querySelector('.btn-effacer');
  const filtreTemps = document.getElementById('filtre-temps');
  const filtreTempsValeur = document.getElementById('filtre-temps-valeur');
  const legendeTemps = document.getElementById('legende-temps');
  const legendeEnsoleillement = document.getElementById('legende-ensoleillement');
  const btnReinitialiserFiltres = document.getElementById('reinitialiser-filtres');
  const resumeResultats = document.getElementById('legende-resultat');
  const btnVueCarte = document.getElementById('btn-vue-carte');
  const btnVueFiltres = document.getElementById('btn-vue-filtres');
  // Posé par configurerFiltreEnsoleillement une fois les données connues —
  // sert à rafraichirNoteEnsoleillement (avertir qu'un filtre actif masque
  // aussi les falaises sans orientation connue, pas seulement celles qui ne
  // correspondent pas : à Crozon, 16 falaises sur 60 n'ont pas cette donnée
  // et disparaîtraient sinon en silence, comme si la carte était incomplète).
  let falaisesSansOrientationConnue = false;
  let noteEnsoleillementAucune = null;

  // Remet la recherche à zéro (texte, filtre, boutons dépendants) — utilisé
  // par allerVers() et par "Tout voir", qui doivent tous les deux repartir
  // d'un état neutre.
  function reinitialiserRecherche() {
    filtres.recherche = '';
    if (recherche) recherche.value = '';
    if (btnCentrer) btnCentrer.disabled = true;
    if (btnEffacer) btnEffacer.hidden = true;
  }

  // Remet le seuil "Depuis le gîte" à son plafond (= aucune falaise
  // exclue) — utilisé par "Tout voir" et par allerVers() quand la cible
  // d'une navigation serait autrement masquée par ce filtre.
  function reinitialiserFiltreTemps() {
    filtres.tempsMaxGite = filtres.tempsGitePlafond;
    if (filtreTemps) filtreTemps.value = String(filtres.tempsGitePlafond);
    if (filtreTempsValeur && Number.isFinite(filtres.tempsGitePlafond)) {
      filtreTempsValeur.textContent = `≤ ${filtres.tempsGitePlafond} min`;
    }
    rafraichirBoutonReinitialiserFiltres();
  }

  // Remet le filtre "Ensoleillement" à "Peu importe" — même usage que
  // reinitialiserFiltreTemps ("Tout voir" et allerVers quand la cible serait
  // masquée par le filtre courant).
  function reinitialiserFiltreEnsoleillement() {
    filtres.ensoleillement = [];
    if (!legendeEnsoleillement) return;
    legendeEnsoleillement.querySelectorAll('input[data-ensoleillement]').forEach((case_) => {
      case_.checked = false;
    });
    rafraichirBoutonReinitialiserFiltres();
  }

  // Fourchette de cotation resserrée par rapport à l'amplitude réelle des
  // données : au moins une borne a quitté son extrême, donc le filtre exclut
  // des falaises. Sortie sans cotation exploitable (preparerFourchette a
  // retiré la section) : plancher/plafond restent à ±Infinity, toujours faux.
  function filtreCotationActif() {
    return filtres.cotationMin > filtres.cotationPlancher
      || filtres.cotationMax < filtres.cotationPlafond;
  }

  // Remet la fourchette de cotation à l'amplitude complète (= aucune falaise
  // exclue) — même usage que reinitialiserFiltreTemps : "Tout voir",
  // "Réinitialiser", et allerVers quand la cible serait masquée par la
  // fourchette courante. No-op si cette sortie n'a pas de cotation.
  function reinitialiserFiltreCotation() {
    if (!Number.isFinite(filtres.cotationPlancher)) return;
    const selMin = document.getElementById('cotation-min');
    const selMax = document.getElementById('cotation-max');
    if (selMin && selMin.options.length) selMin.selectedIndex = 0;
    if (selMax && selMax.options.length) selMax.selectedIndex = selMax.options.length - 1;
    // majFourchette resynchronise filtres.cotationMin/Max sur les <select>
    // qu'on vient de remettre à leurs extrêmes et recalcule nbDansFourchette.
    majFourchette();
    const source = map.getSource('falaises');
    if (source) source.setData(construireSourceFalaises(entries, modeFigureActuel, maxima, epureeActuelle));
    rafraichirBoutonReinitialiserFiltres();
  }

  // Grise "Réinitialiser" (jamais re-caché après le chargement : voir
  // chargerDonnees) tant qu'aucun des filtres qu'il traite n'est actif — rien
  // à réinitialiser. "Type de voie" et "Cotation des voies" comptent : eux
  // aussi masquent des falaises derrière (estFalaiseVideDansMode et
  // compterDansFourchette, donnees.js), pas seulement une histoire de taille
  // de cercle. Ils sont désormais indépendants l'un de l'autre (combinables),
  // donc valent chacun 1 : un "Couenne" + une fourchette resserrée comptent 2.
  // Recherche exclue : "Tout voir" la traite déjà séparément, et elle ne
  // "reste" jamais active de la même façon (elle se vide au moindre clic
  // ailleurs). Appelé après chaque changement d'un de ces filtres —
  // reinitialiserFiltreTemps/reinitialiserFiltreEnsoleillement/
  // reinitialiserFiltreCotation/definirModeFigure/appliquerFiltreCotation
  // (elles-mêmes appelées aussi par "Tout voir" et allerVers) — pour que le
  // bouton se regrise avec eux. Même décompte affiché sur le bouton "Filtres"
  // — bascule mobile ET repli desktop (voir son texte, .legende-toggle-texte).
  function rafraichirBoutonReinitialiserFiltres() {
    const nActifs = (filtres.ensoleillement.length > 0 ? 1 : 0)
      + (filtres.tempsMaxGite < filtres.tempsGitePlafond ? 1 : 0)
      + (modeFigureActuel !== 'aucun' ? 1 : 0)
      + (filtreCotationActif() ? 1 : 0);
    if (btnReinitialiserFiltres) btnReinitialiserFiltres.disabled = nActifs === 0;
    const libelle = nActifs > 0 ? `Filtres · ${nActifs}` : 'Filtres';
    if (btnVueFiltres) btnVueFiltres.textContent = libelle;
    const texteToggleDesktop = document.querySelector('.legende-toggle-texte');
    if (texteToggleDesktop) texteToggleDesktop.textContent = libelle;
  }

  // Un seul bouton pour tout ce qui masque une falaise (Ensoleillement,
  // Depuis le gîte, Type de voie ET Cotation des voies — choisir "Couenne" ou
  // resserrer une fourchette filtre tout autant que cocher "Matin", voir
  // estFalaiseVideDansMode et compterDansFourchette dans donnees.js) : plus
  // rapide que défaire chaque réglage un par un. Recherche exclue : "Tout
  // voir" la traite séparément.
  function configurerReinitialisationFiltres() {
    if (!btnReinitialiserFiltres) return;
    btnReinitialiserFiltres.addEventListener('click', () => {
      reinitialiserFiltreTemps();
      reinitialiserFiltreEnsoleillement();
      reinitialiserFiltreCotation();
      definirModeFigure('aucun');
      appliquerFiltresEtSecteurs();
    });
  }
  let borneGlobale = null; // étendue de tous les marqueurs, pour le bouton "Tout voir"
  let maxima = { total: 0, couenne: 0, gv: 0 }; // pour la taille des cercles proportionnels

  // cles=null remet tout le monde à l'opacité normale.
  // PIÈGE : passer par marker.setOpacity() et jamais par style.opacity —
  // MapLibre réapplique sa propre valeur interne à chaque 'move'/'render' et
  // écraserait silencieusement toute écriture directe dès le pan suivant.
  function enSurbrillance(cles) {
    const actifs = cles ? new Set(cles) : null;
    entries.forEach((e) => {
      if (e.cat === 'falaise') {
        // Couche native : estompe via feature-state (voir circle-opacity dans
        // construireCoucheFalaises). On ne pose l'état que s'il change : le
        // feature-state relance la source à chaque appel, à éviter pour des
        // milliers de falaises.
        const estompe = Boolean(actifs && !actifs.has(e.cle));
        if (etatEstompeParCle.get(e.cle) !== estompe) {
          etatEstompeParCle.set(e.cle, estompe);
          if (map.getLayer('falaises')) map.setFeatureState({ source: 'falaises', id: e.cle }, { estompe });
        }
      } else if (e.marker) {
        e.marker.setOpacity((!actifs || actifs.has(e.cle)) ? '1' : '0.25');
      }
    });
  }

  // Une entrée a-t-elle un figuré ponctuel visible en ce moment ? Pour les
  // falaises (couche native) on consulte le Set maintenu par appliquerFiltres
  // — l'ancien falaiseVisible lisait le DOM d'un marqueur qui n'existe plus.
  function entreeVisible(entree) {
    if (entree.cat === 'falaise') return falaisesVisibles.has(entree.cle);
    const el = entree.marker && entree.marker.getElement();
    return Boolean(el && el.style.display !== 'none');
  }

  // Point de passage unique pour appliquerFiltres (recherche/mode/sélection) :
  // recalcule dans la foulée quels libellés de secteur ET de site ont encore
  // un figuré ponctuel visible en dessous, et retraite les collisions à
  // l'écran (voir appliquerAntiCollisionSecteurs/appliquerAntiCollisionSites)
  // — sinon un libellé peut rester affiché seul, sans plus aucun marqueur
  // associé (ex. recherche qui ne laisse aucune falaise du secteur/site
  // visible).
  function appliquerFiltresEtSecteurs() {
    appliquerFiltres(entries, filtres, modeFigureActuel, falaiseSelectionneeCle);
    appliquerAntiCollisionSecteurs();
    appliquerAntiCollisionSites();
    rafraichirResumeResultats();
  }

  // Résumé vivant en tête du panneau "Filtres" mobile (voir style-carte.css,
  // #legende-resultat) : falaisesVisibles est déjà tenue à jour par
  // appliquerFiltres juste au-dessus, aucun nouveau calcul nécessaire.
  function rafraichirResumeResultats() {
    if (!resumeResultats) return;
    const n = falaisesVisibles.size;
    resumeResultats.textContent = `${n} secteur${n === 1 ? '' : 's'} affiché${n === 1 ? '' : 's'}`;
  }

  // Change la falaise "active" (popup ouverte) : ses parkings associés
  // deviennent pertinents (voir appliquerFiltres, les parkings sont masqués
  // par défaut — on cherche d'abord le secteur, le parking en découle).
  function definirFalaiseSelectionnee(cle) {
    falaiseSelectionneeCle = cle;
    appliquerFiltresEtSecteurs();
  }

  // Bascule peu coûteuse (garde d'égalité, comme appliquerSimplificationZoom)
  // pour rester réactive PENDANT un geste de zoom continu ; le calcul des
  // recouvrements (plus coûteux : projection + mesure DOM de chaque libellé)
  // attend que la caméra se stabilise (moveend/zoomend) — voir le câblage
  // dans ajouterLabelsDeSecteur.
  function appliquerVisibiliteSecteurs() {
    const visible = map.getZoom() >= ZOOM_LABELS_SECTEUR;
    if (visible === secteursVisibles) return;
    secteursVisibles = visible;
    if (!visible) {
      labelsSecteurs.forEach(({ el }) => { el.style.visibility = 'hidden'; });
    } else {
      appliquerAntiCollisionSecteurs();
    }
  }

  // Même mécanisme que appliquerVisibiliteSecteurs, en miroir : un nom de
  // site ne s'affiche QUE tant que les noms de secteur ne sont pas affichés
  // (zoom < ZOOM_LABELS_SECTEUR). À fort zoom, le nom du secteur suffit à
  // s'orienter — afficher les deux empilés SOUS le point (labels site et
  // secteur tous deux ancrés en 'top', offsets [0,2] et [0,14]) les faisait
  // se chevaucher entre eux ET chevaucher le cercle proportionnel centré sur
  // le point. Cas typique : un site à une seule falaise, où centroïde site
  // == centroïde secteur == position de la falaise (ex. Rocher des Amayères).
  function appliquerVisibiliteSites() {
    const visible = map.getZoom() < ZOOM_LABELS_SECTEUR;
    if (visible === sitesVisibles) return;
    sitesVisibles = visible;
    if (!visible) {
      labelsSites.forEach(({ el }) => { el.style.visibility = 'hidden'; });
    } else {
      appliquerAntiCollisionSites();
    }
  }

  // Décollision au pixel, partagée entre libellés de secteur et de site. Les
  // labels arrivent déjà triés par priorité ; à conflit, le premier retenu
  // gagne. visibility et non display : garde le DOM mesurable, sinon le
  // calcul suivant serait faussé.
  function appliquerAntiCollision(labels, entriesParGroupe, cleDe) {
    const retenus = [];
    labels.forEach((label) => {
      const { el, marker } = label;
      const entreesDuGroupe = entriesParGroupe.get(cleDe(label)) || [];
      if (!entreesDuGroupe.some(entreeVisible)) {
        el.style.visibility = 'hidden';
        return;
      }
      const point = map.project(marker.getLngLat());
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const rect = { left: point.x - w / 2, right: point.x + w / 2, top: point.y, bottom: point.y + h };
      const chevauche = retenus.some(r =>
        rect.left < r.right + 4 && rect.right > r.left - 4 &&
        rect.top < r.bottom + 2 && rect.bottom > r.top - 2
      );
      el.style.visibility = chevauche ? 'hidden' : 'visible';
      if (!chevauche) retenus.push(rect);
    });
  }

  function appliquerAntiCollisionSecteurs() {
    if (!secteursVisibles) return;
    appliquerAntiCollision(labelsSecteurs, entriesParSecteur, (l) => l.nom);
  }

  function appliquerAntiCollisionSites() {
    // Règle de zoom (voir appliquerVisibiliteSites) : pas de nom de site à
    // décollisionner au-delà du seuil des secteurs — ils sont tous masqués.
    if (sitesVisibles === false) return;
    appliquerAntiCollision(labelsSites, entriesParSite, (l) => l.site);
  }

  // Garde la trace de la popup actuellement ouverte : ferme via la touche
  // Échap, et permet à addMarker de savoir si une fermeture est "périmée"
  // (une autre popup a déjà pris le relais entre-temps) avant de réinitialiser
  // l'opacité des marqueurs.
  let popupOuverte = null;
  function suivrePopup(popup, ouverte) {
    popupOuverte = ouverte ? popup : (popupOuverte === popup ? null : popupOuverte);
    return popupOuverte;
  }

  // État replié/déplié de la fiche mobile, PARTAGÉ entre toutes les popups
  // (pas une propriété de telle ou telle falaise) : si l'utilisateur réduit
  // la fiche pour voir plus de carte, ce choix reste valable en passant à une
  // autre falaise/parking — comme le fait la fiche du bas de Google/Apple
  // Maps, dont le niveau (replié/déplié) suit l'utilisateur d'un lieu à
  // l'autre plutôt que d'être réinitialisé à chaque sélection. Mis à jour par
  // l'écouteur délégué ci-dessous, lu par addMarker (voir estFicheReduite) à
  // chaque ouverture de popup pour synchroniser SON contenu sur cet état.
  let ficheReduite = false;

  // Élément .popup actuellement affiché, qu'il vive dans une popup flottante
  // MapLibre (mobile/parking/gîte) ou dans le panneau desktop (panneauFacade,
  // sans .getElement() propre) — les deux cas donnent un point d'entrée DOM
  // différent, factorisé ici pour ne pas le refaire à chaque appelant.
  const popupElementCourant = () => {
    if (!popupOuverte) return null;
    if (popupOuverte.estPanneauFalaise) return document.getElementById('panneau-falaise')?.querySelector('.popup') || null;
    return popupOuverte.getElement ? popupOuverte.getElement().querySelector('.popup') : null;
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Échap ferme d'abord le NIVEAU LE PLUS PROFOND, comme "← Retour"/la
      // croix : le détail des voies s'il est ouvert (retour à la fiche,
      // popup/panneau gardé ouvert), sinon la fiche/popup elle-même — jamais
      // les deux d'un coup. Un 2e Échap juste après ferme alors le niveau
      // suivant normalement.
      const popupEl = popupElementCourant();
      if (popupEl && popupEl.classList.contains('mode-detail-voies')) {
        masquerDetailVoies(popupEl, ficheReduite);
        return;
      }
      // Ferme d'abord une éventuelle popup flottante (parking/gîte), puis le
      // panneau falaise s'il reste ouvert. L'état du panneau est lu dans le
      // DOM (panneauFalaiseOuvert), pas dans popupOuverte : une popup
      // parking/gîte ouverte par-dessus le panneau écrase popupOuverte sans
      // fermer le panneau, qui resterait sinon fermable seulement par son
      // bouton ×.
      if (popupOuverte && !(estDesktop() && popupOuverte.estPanneauFalaise)) {
        popupOuverte.remove();
      } else if (panneauFalaiseOuvert()) {
        fermerPanneauFalaise(map, ctxPanneau);
      }
    }
  });

  // Actions du contenu des fiches (poignée, détail des voies, tri, GPS,
  // partage, navigation) : voir actions-fiche.js. Extrait d'ici parce que ce
  // répartiteur de 120 lignes ne touchait que trois variables de cette
  // closure — d'où les quatre rappels ci-dessous, et rien de plus.
  cablerActionsFiche({
    urlRoute: (id) => baseRoutes + id + '.json',
    lireFicheReduite: () => ficheReduite,
    ecrireFicheReduite: (v) => { ficheReduite = v; },
    popupCourante: () => popupOuverte,
    allerVers,
  });

  // Simplifie TOUS les marqueurs en petit point uniforme sous
  // ZOOM_SIMPLIFICATION (vue d'ensemble) : à cette échelle, les cercles
  // proportionnels se chevauchent trop entre eux pour rester lisibles
  // (certains sommets ont leurs secteurs à quelques dizaines de mètres les
  // uns des autres). Les parkings/gîte suivent la même règle — un parking à
  // 22px à côté de falaises réduites à 7px jurerait visuellement, même si
  // eux n'ont pas de recouvrement à résoudre en soi. Restaurés dès qu'on
  // zoome sur un site — cf. .zoom-eloigne dans le CSS.
  let modeSimplifieActuel = null;
  function appliquerSimplificationZoom() {
    const simplifie = map.getZoom() < ZOOM_SIMPLIFICATION;
    if (simplifie === modeSimplifieActuel) return;
    modeSimplifieActuel = simplifie;
    // Falaises : la réduction à un petit point uniforme est portée par des
    // expressions de zoom dans la couche native (voir construireCoucheFalaises)
    // — on ne touche ici qu'aux marqueurs DOM restants (parkings, gîte).
    entries.forEach((entree) => {
      if (entree.cat === 'falaise' || !entree.marker) return;
      entree.marker.getElement().classList.toggle('zoom-eloigne', simplifie);
    });
    rafraichirLegendeFalaises();
  }
  // Son map.on('zoom', ...) est enregistré dans creerCarte : map n'existe
  // pas encore à ce stade du code.

  // Reconstruit la mini-légende falaises selon le mode "Cercles" courant, le
  // bouton "Épurer" ET l'état de simplification par zoom — sinon la légende
  // continuerait de montrer des cercles de référence à une échelle où seuls
  // des points uniformes sont réellement affichés (trompeur).
  // Deux raisons distinctes de n'avoir aucune taille à légender, jamais
  // confondues : "épurée" prime sur le zoom (un choix explicite, avec un
  // message qui ne dit pas "zoomez" — dézoomer n'y changerait rien).
  function rafraichirLegendeFalaises() {
    const { max, median, remplissage } = infosLegendePourMode(modeFigureActuel, maxima);
    const raisonSansTaille = epureeActuelle ? 'epuree' : modeSimplifieActuel ? 'zoom' : null;
    construireLegendeFalaises(max, median, remplissage, raisonSansTaille, maxima.total);
  }

  // Couche native (rendu GPU) plutôt qu'un marqueur DOM par falaise : passe à
  // l'échelle quand le geojson atteindra des milliers d'entrées, et le tri des
  // cercles par taille se fait dans la SOURCE, sans réordonnancement DOM.
  // promoteId: 'cle' — le feature-state s'indexe sur la clé falaise, stable.
  // Les marqueurs DOM (parkings, gîte, libellés) passent au-dessus de cette
  // couche : les falaises restent SOUS les parkings.
  function construireCoucheFalaises() {
    map.addSource('falaises', {
      type: 'geojson',
      promoteId: 'cle',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'falaises',
      type: 'circle',
      source: 'falaises',
      paint: {
        'circle-radius': ['step', ['zoom'], 3.5, ZOOM_SIMPLIFICATION, ['get', 'r']],
        'circle-color': expressionCouleurCercles(),
        'circle-stroke-width': ['step', ['zoom'], 1, ZOOM_SIMPLIFICATION, 2],
        'circle-stroke-color': '#ffffff',
        'circle-opacity': ['case', ['boolean', ['feature-state', 'estompe'], false], 0.25, 1],
      },
    });
    map.on('mouseenter', 'falaises', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'falaises', () => { map.getCanvas().style.cursor = ''; });

    // Cible tactile des cercles : couche native (GPU), pas de DOM à agrandir
    // comme poserTailleMarqueur — on élargit donc la RECHERCHE du clic, pas
    // le cercle. Seulement au doigt (souris déjà précise) ; le plus proche
    // l'emporte s'il y a plusieurs candidats, pour ne pas répéter l'erreur
    // déjà corrigée sur les libellés de site (WCAG 2.5.8) : capter le clic
    // du voisin. 18px vise ~44px de capture même sur le plus petit cercle.
    const MARGE_TACTILE_FALAISE = 18;
    function falaiseAuPoint(point) {
      const direct = map.queryRenderedFeatures(point, { layers: ['falaises'] })[0];
      if (direct) return direct.properties.cle;
      if (!window.matchMedia('(pointer: coarse)').matches) return undefined;
      const zone = [
        [point.x - MARGE_TACTILE_FALAISE, point.y - MARGE_TACTILE_FALAISE],
        [point.x + MARGE_TACTILE_FALAISE, point.y + MARGE_TACTILE_FALAISE],
      ];
      const candidats = map.queryRenderedFeatures(zone, { layers: ['falaises'] });
      if (!candidats.length) return undefined;
      const distance = (f) => {
        const p = map.project(f.geometry.coordinates);
        return Math.hypot(p.x - point.x, p.y - point.y);
      };
      candidats.sort((a, b) => distance(a) - distance(b));
      return candidats[0].properties.cle;
    }

    // UN SEUL écouteur, jamais un map.on('click','falaises') séparé : les deux
    // se déclenchent sur le même clic, et le premier change le padding caméra
    // de façon SYNCHRONE avant que le second ne s'exécute. Bug constaté :
    // queryRenderedFeatures renvoyait 0 résultat au même pixel, le rendu ayant
    // déjà changé dessous — le panneau se refermait aussitôt ouvert.
    map.on('click', (e) => {
      // Un clic parti d'un marqueur ou d'une popup REMONTE jusqu'ici — c'est
      // même le mécanisme par lequel MapLibre ouvre la popup d'un marqueur.
      // Sans ce garde, cliquer sur le P ouvrait la popup parking puis la
      // refermait aussitôt : « je ne peux plus cliquer sur le parking ».
      const cible = e.originalEvent && e.originalEvent.target;
      if (cible && typeof cible.closest === 'function' &&
          (cible.closest('.maplibregl-marker') || cible.closest('.maplibregl-popup'))) {
        return;
      }

      const cle = falaiseAuPoint(e.point);
      if (cle) {
        // Sous ZOOM_LABELS_SECTEUR, les secteurs ne sont pas encore nommés
        // individuellement (trop serrés pour rester lisibles, voir
        // labels.js) : cliquer un cercle zoome alors sur CE point précis —
        // flyTo vers une cible seule, comme allerVers (recherche), PAS un
        // fitBounds sur tout le site (zoomerSurSite, réservée au clic sur le
        // NOM du site). Cadrer le site entier ici faisait sauter la caméra
        // vers son centre géographique, potentiellement loin du cercle
        // cliqué et dans une direction sans rapport avec lui — repéré en
        // usage réel sur un site étalé, animation désorientante sur un
        // secteur excentré. Au-delà du seuil, le secteur visé est déjà
        // lisible : le clic ouvre directement sa fiche, comme un clic sur
        // son étiquette (voir ajouterLabelsDeSecteur).
        if (map.getZoom() >= ZOOM_LABELS_SECTEUR) {
          ouvrirFalaise(cle);
        } else {
          const entree = index.get(cle);
          if (entree) {
            map.stop();
            reinitialiserPadding(map);
            map.flyTo({
              center: [entree.lon, entree.lat],
              zoom: Math.max(map.getZoom(), ZOOM_LABELS_SECTEUR),
              padding: margeToutVoir(),
              ...dureeReduite(),
            });
          }
        }
      } else if (popupOuverte && !(estDesktop() && popupOuverte.estPanneauFalaise)) {
        // Une popup FLOTTANTE (parking/gîte, ou fiche falaise mobile) est
        // ouverte : on ne ferme QUE celle-là. Les popups sont créées avec
        // closeOnClick:false (voir marqueurs.js) précisément pour reprendre
        // la main ici : sur desktop, une popup parking peut être affichée
        // PAR-DESSUS le panneau falaise resté ouvert — la fermer ne doit PAS
        // fermer le panneau (sur mobile, même résultat qu'avant — le
        // closeOnClick natif — mais centralisé).
        popupOuverte.remove();
        // Le 'close' de la popup a remis toutes les falaises en pleine
        // opacité (enSurbrillance(null)). Si le panneau falaise est resté
        // ouvert (desktop), on restaure la surbrillance de la falaise
        // sélectionnée (+ ses parkings) : la relation parking -> falaises
        // qu'on vient de refermer reste ainsi visible à l'écran, la card
        // falaise restant ouverte.
        if (estDesktop() && panneauFalaiseOuvert() && falaiseSelectionneeCle) {
          const entree = index.get(falaiseSelectionneeCle);
          if (entree) enSurbrillance([falaiseSelectionneeCle, ...entree.parkingAssocie]);
        }
      } else if (panneauFalaiseOuvert()) {
        // Aucune popup flottante, mais le panneau desktop est ouvert : le
        // clic sur le vide le ferme (équivalent du closeOnClick natif d'une
        // vraie maplibregl.Popup, à recréer explicitement puisque le panneau
        // n'en est pas une). État du panneau lu dans le DOM
        // (panneauFalaiseOuvert), pas dans popupOuverte.estPanneauFalaise.
        fermerPanneauFalaise(map, ctxPanneau);
      }
    });
  }

  // Popup flottante sur mobile, panneau latéral sur desktop. Ferme la fiche
  // ouverte SAUF si le panneau desktop l'est déjà : on remplace alors son
  // contenu, sans fermeture/réouverture visible.
  // cameraDejaEncadree évite que ouvrirPanneauFalaise ne coupe l'animation
  // d'allerVers avec son map.stop() — voir marqueurs.js.
  function ouvrirFalaise(cle, cameraDejaEncadree = false) {
    const entree = index.get(cle);
    if (!entree) return;
    if (popupOuverte && !(estDesktop() && popupOuverte.estPanneauFalaise)) {
      popupOuverte.remove();
    }
    definirFalaiseSelectionnee(cle);
    popupOuverte = estDesktop()
      ? ouvrirPanneauFalaise(map, entree, ctxPanneau, cameraDejaEncadree)
      : ouvrirPopupFalaise(map, entree, ctxPopup, cameraDejaEncadree);
  }

  // Couleur de la couche "falaises" : COULEUR_ELOIGNE (vue lointaine) OU
  // teinte du mode — sauf "Épurer" enclenché, qui impose COULEUR_ELOIGNE
  // aussi zoomé. Factorisé : deux déclencheurs distincts (mode, épuré).
  function expressionCouleurCercles() {
    const couleur = epureeActuelle ? COULEUR_ELOIGNE : couleurFalaisePourMode(modeFigureActuel);
    return ['step', ['zoom'], COULEUR_ELOIGNE, ZOOM_SIMPLIFICATION, couleur];
  }

  // Change le mode "Type de voie" (aucun/couenne/gv — la grandeur encodée par
  // la taille des cercles) et redessine tout ce qui en dépend — utilisé par
  // les boutons eux-mêmes et par allerVers (voir plus bas) : naviguer vers
  // une falaise doit garantir qu'elle reste visible, quitte à sortir d'un
  // thème qui l'aurait masquée (voir estFalaiseVideDansMode). "Cotation des
  // voies" ne passe pas par ici : c'est un filtre indépendant qui se combine
  // avec ce mode (voir appliquerFiltreCotation).
  function definirModeFigure(nouveauMode) {
    modeFigureActuel = nouveauMode;
    boutonsTypeVoie.forEach((b) => {
      const actif = b.dataset.mode === nouveauMode;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-pressed', String(actif));
    });
    // Couche native : remplace les features (un mode en exclut certaines,
    // voir construireSourceFalaises) et la couleur du thème. setData
    // remplace l'ancien dessinerFalaise + trierCerclesParTaille : le tri par
    // taille est fait dans construireSourceFalaises (valeur décroissante).
    // epureeActuelle transmis tel quel : changer de mode ne doit pas
    // désactiver la vue épurée en cours.
    const source = map.getSource('falaises');
    if (source) source.setData(construireSourceFalaises(entries, modeFigureActuel, maxima, epureeActuelle));
    if (map.getLayer('falaises')) {
      map.setPaintProperty('falaises', 'circle-color', expressionCouleurCercles());
    }
    rafraichirLegendeFalaises();
    // Un changement de mode peut vider un thème entier (ex. "Grande voie" sur
    // un secteur 100% couenne) : le libellé de secteur n'a plus de figuré
    // ponctuel sous lui, voir appliquerAntiCollisionSecteurs. Les parkings
    // eux-mêmes sont retraités par appliquerFiltresEtSecteurs() (appelé par
    // le sélecteur après definirModeFigure).
    appliquerAntiCollisionSecteurs();
    rafraichirBoutonReinitialiserFiltres();
  }

  // Navigue vers le marqueur "cle" (falaise ou parking lié depuis une popup),
  // en levant les filtres actifs si besoin pour garantir qu'il soit visible.
  // "origineCle" (facultatif) : la popup depuis laquelle on clique un lien
  // croisé — dans ce cas on cadre sur les DEUX points plutôt que de voler
  // uniquement vers la cible, pour garder la relation spatiale visible.
  // "conserverRecherche" (facultatif) : ne pas effacer le champ de recherche
  // — utilisé par centrerSurRecherche(), où la recherche vient de motiver
  // l'action elle-même (l'effacer serait perdre ce qu'on vient de taper).
  function allerVers(cle, origineCle, conserverRecherche) {
    const cible = index.get(cle);
    if (!cible) return;

    if (!conserverRecherche) reinitialiserRecherche();

    const origine = origineCle ? index.get(origineCle) : null;

    // Naviguer vers une falaise garantit qu'elle reste visible : si le mode
    // "Type de voie" actif la masquerait (aucune donnée pour ce thème — voir
    // estFalaiseVideDansMode), on repasse sur "Toutes les voies" plutôt que
    // de laisser une popup s'ouvrir sans aucun figuré en dessous. Même
    // vérification pour l'origine d'un lien croisé (cas plus rare, mais même
    // risque). Même logique pour "Depuis le gîte" (falaise au-delà du seuil),
    // l'ensoleillement, et la fourchette de cotation (aucune voie dans les
    // bornes choisies) : chacun peut masquer la cible d'une navigation
    // explicite, chacun est levé si c'est le cas.
    const tempsGiteEmpecheVisibilite = (entree) => entree.tempsGite != null && entree.tempsGite > filtres.tempsMaxGite;
    const ensoleillementEmpecheVisibilite = (entree) => filtres.ensoleillement.length && !filtres.ensoleillement.includes(entree.ensoleillement);
    const cotationEmpecheVisibilite = (entree) => filtreCotationActif()
      && !compterDansFourchette(entree.cotations, filtres.cotationMin, filtres.cotationMax);
    const seraitMasquee = (entree) => entree && entree.cat === 'falaise' && (
      estFalaiseVideDansMode(entree, modeFigureActuel)
      || tempsGiteEmpecheVisibilite(entree)
      || ensoleillementEmpecheVisibilite(entree)
      || cotationEmpecheVisibilite(entree));
    const cibleSeraitMasquee = seraitMasquee(cible);
    const origineSeraitMasquee = seraitMasquee(origine);
    if (cibleSeraitMasquee || origineSeraitMasquee) {
      definirModeFigure('aucun');
      reinitialiserFiltreTemps();
      reinitialiserFiltreEnsoleillement();
      reinitialiserFiltreCotation();
    }

    // Cible falaise -> elle devient la sélection (ses parkings deviennent
    // pertinents). Sinon (cible parking/gîte), on garde l'origine si c'est
    // une falaise (ex. lien "Parking" depuis une falaise) pour que son
    // parking reste visible ; sans ça le close de la popup d'origine (juste
    // avant cet appel, voir le lien "lien-secteur" de l'écouteur délégué)
    // masquerait la cible qu'on est justement en train de rejoindre.
    falaiseSelectionneeCle = cible.cat === 'falaise' ? cible.cle
      : (origine && origine.cat === 'falaise') ? origine.cle
      : null;
    appliquerFiltresEtSecteurs();

    // PIÈGE MapLibre : le padding d'un fitBounds/flyTo PERSISTE, et le cadrage
    // suivant l'ADDITIONNE au sien au lieu de le remplacer. Sur mobile la
    // somme dépassait la hauteur du conteneur et MapLibre abandonnait le
    // cadrage en silence — d'où reinitialiserPadding() à chaque fois.
    map.stop();
    reinitialiserPadding(map);

    // Position à l'écran d'une entrée : marqueur DOM (parking/gîte) ou
    // coordonnées directes (falaise en couche native — plus de marqueur).
    const pointDe = (e) => (e.marker ? e.marker.getLngLat() : [e.lon, e.lat]);

    // Le panneau DROIT ne s'ouvre que pour une falaise : sa largeur n'est
    // réservée que si la cible en est une, ou s'il est déjà ouvert (lien
    // parking depuis une fiche falaise). L'état est lu dans le DOM et non dans
    // popupOuverte : un 2e clic sur le lien parking ferme la popup avant cet
    // appel, popupOuverte n'est alors plus le panneau — sans ce garde, le
    // cadrage perdait le centrage falaise+parking (bug constaté).
    // duration:800 explicite : la durée par défaut se calcule sur la distance
    // et dépassait 2 s sur un grand saut, la caméra bougeant encore longtemps
    // après l'affichage de la fiche.
    const reserverPanneauDroit = cible.cat === 'falaise' || panneauFalaiseOuvert();
    if (origine) {
      const bounds = new maplibregl.LngLatBounds();
      bounds.extend(pointDe(origine));
      bounds.extend(pointDe(cible));
      map.fitBounds(bounds, { padding: margeAvantPopup(reserverPanneauDroit), maxZoom: 16, duration: dureeAnimation(800) });
    } else {
      map.flyTo({ center: pointDe(cible), zoom: Math.max(map.getZoom(), 15), padding: margeAvantPopup(reserverPanneauDroit), duration: dureeAnimation(800) });
    }

    if (cible.cat === 'falaise') {
      // cameraDejaEncadree=true : le fitBounds/flyTo ci-dessus vient déjà de
      // lancer la bonne animation caméra (bon padding, bon zoom) — voir le
      // commentaire de ouvrirFalaise/ouvrirPanneauFalaise sur pourquoi ne
      // pas la court-circuiter avec un 2e cadrage ici serait un bug.
      ouvrirFalaise(cible.cle, true);
      // PAS de enSurbrillance ici pour ce cas : ouvrirFalaise vient déjà d'en
      // poser une correcte (falaise + SES parkings associés, voir
      // ouvrirPanneauFalaise/ouvrirPopupFalaise). Un appel enSurbrillance
      // générique juste après, sans parkingAssocie, l'écraserait aussitôt et
      // ré-estompait le parking à 0.25 (bug réel constaté : après une
      // recherche+"Voir" sur une falaise, son parking associé restait grisé
      // malgré tout). S'il y a une origine (lien croisé), on l'ajoute à la
      // liste déjà posée par ouvrirFalaise plutôt que la remplacer.
      if (origine) enSurbrillance([origine.cle, cible.cle, ...cible.parkingAssocie]);
    } else {
      cible.marker.togglePopup();
      enSurbrillance(origine ? [origine.cle, cible.cle] : [cible.cle]);
    }
  }

  const etatChargement = document.getElementById('etat-chargement');

  // Enveloppé dans une fonction rappelable (au lieu d'un fetch nu) pour que
  // le bouton "Réessayer" puisse relancer exactement la même séquence : sans
  // ça, un échec au chargement initial était définitif et n'offrait que le
  // rechargement manuel de la page — inconfortable sur un réseau qui va et
  // vient, et perdant si la page elle-même n'est plus servie.
  //
  // Le corps est la LISTE DES ÉTAPES ; celles qui n'appartiennent qu'au
  // chargement sont définies juste en dessous, dans le même ordre. Cet
  // ordre n'est pas libre : creerCarte passe en premier (tout le
  // reste écrit dans map), construireEntrees avant tout ce qui lit
  // entries/index/maxima, et appliquerFiltresEtSecteurs après les deux
  // familles de libellés, dont elle retraite les collisions.
  function chargerDonnees() {
    if (etatChargement) {
      etatChargement.textContent = 'Chargement de la carte…';
      etatChargement.classList.remove('erreur');
    }
    return fetch(dataUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} sur ${dataUrl}`);
        return r.json();
      })
      .then((geojson) => {
        creerCarte(geojson);
        const tempsDepuisGite = construireEntrees(geojson);
        afficherCoucheFalaises();
        ouvrirLienProfond();
        ajouterLabelsDeSite(geojson);
        // Construit AUSSI la légende falaises initiale : à ce premier appel
        // l'état passe de null à une valeur, donc rafraichirLegendeFalaises
        // s'exécute. Elle n'est construite explicitement nulle part ailleurs.
        appliquerSimplificationZoom();
        ajouterLabelsDeSecteur(geojson);
        remplirAutocompletion(geojson);
        ajusterLegendeAuxDonnees(geojson);
        configurerFiltreTemps(tempsDepuisGite);
        configurerFiltreEnsoleillement();
        configurerReinitialisationFiltres();
        // "Réinitialiser" devient visible une fois pour toutes ici, puis ne
        // fait plus que se griser/dégriser (rafraichirBoutonReinitialiserFiltres)
        // : "Type de voie" est proposé pour toute sortie (toutes ont des
        // voies), il y a donc toujours quelque chose que ce bouton peut
        // remettre à zéro. Le garder affiché en permanence évite le saut du
        // DOM quand un premier filtre s'active.
        if (btnReinitialiserFiltres) btnReinitialiserFiltres.hidden = false;
        appliquerFiltresEtSecteurs();
        if (etatChargement) etatChargement.remove();
        preparerFourchette();
        monterHorsLigne(geojson);
      })
      .catch(afficherEchecChargement);
  }

  // La carte est créée AVEC ses bounds réelles (calculées juste avant) plutôt
  // qu'avec un fitBounds animé après coup : elle naît dans la bonne vue, sans
  // animation ni tuiles téléchargées pour un centre provisoire. C'est
  // possible parce que data.geojson est préchargé (<link rel="preload">) et
  // que son fetch est plus court que le parse de maplibre-gl.mjs.
  function creerCarte(geojson) {
    borneGlobale = new maplibregl.LngLatBounds();
    geojson.features.forEach(f => borneGlobale.extend(f.geometry.coordinates));
    map = new maplibregl.Map({
      container: 'map',
      // "positron" (fond neutre, peu de POI/labels) plutôt que "liberty"
      // (style généraliste chargé) : le fond doit rester discret pour que
      // les marqueurs falaise/parking/gîte restent la figure dominante
      // (principe figure-fond) — et un style plus simple charge/peint
      // aussi plus vite.
      style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: borneGlobale,
      // ZOOM_VUE_ENSEMBLE_MAX, pas un plafond arbitraire : sur un lieu
      // compact (Dentelles de Montmirail), ajuster pile aux marqueurs
      // dépassait le seuil de simplification et affichait les cercles
      // proportionnels pleine taille dès l'arrivée — mesuré, 99 paires de
      // cercles sur 51 se chevauchaient, jusqu'à 94% de recouvrement, rendant
      // leur taille illisible. Sur Crozon et la Drôme, le zoom d'ajustement
      // naturel est déjà sous ce seuil : rien ne change pour eux.
      fitBoundsOptions: { padding: margeToutVoir(), maxZoom: ZOOM_VUE_ENSEMBLE_MAX },
      attributionControl: false,
    });
    // La vue initiale est déjà la bonne (pas d'animation au chargement) : on
    // peut poser immédiatement les limites de dérive, sans attendre un
    // moveend (ex- fitToMarkers). ZOOM_SIMPLIFICATION - 1 : garantit de
    // pouvoir dézoomer jusqu'à la vue en petits points, pas juste l'effleurer.
    limiterZoneCarte(map, ZOOM_SIMPLIFICATION - 1);
    // Câble le bouton fermer (×) du panneau falaise desktop — sans effet
    // sur mobile, le panneau reste display:none hors media query.
    cablerFermetureManuellePanneau(map, ctxPanneau);

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    // Contrôle "Tout voir" ajouté via l'API de contrôles MapLibre (pas un
    // bouton positionné en absolu à la main) : la carte gère elle-même
    // l'empilement des contrôles partageant un coin, donc pas de collision
    // possible avec NavigationControl au-dessus, quelle que soit sa hauteur
    // réelle (icônes zoom+boussole, variable selon les options).
    map.addControl(creerControleToutVoir(() => {
      // « Tout voir » vide la sélection juste en dessous : la fiche doit
      // suivre, sinon le panneau resterait affiché avec un contenu périmé,
      // en contradiction avec « panneau ouvert <=> falaise sélectionnée ».
      if (popupOuverte) popupOuverte.remove();
      reinitialiserPadding(map);
      // Même plafond que le cadrage initial (voir ce commentaire) : "Tout
      // voir" doit revenir à la même vue qu'à l'arrivée, pas à une vue plus
      // zoomée qui réintroduirait le chevauchement des cercles.
      if (borneGlobale) map.fitBounds(borneGlobale, { padding: margeToutVoir(), maxZoom: ZOOM_VUE_ENSEMBLE_MAX });
      // "Vue d'ensemble" signifie repartir à zéro : ni sélection, ni
      // recherche, ni aucun filtre qui masque des falaises — sinon la caméra
      // revient mais les marqueurs restent restreints, contradiction avec
      // "tout voir". Type de voie compris (couenne/gv masquent des falaises
      // comme les autres).
      falaiseSelectionneeCle = null;
      reinitialiserRecherche();
      reinitialiserFiltreTemps();
      reinitialiserFiltreEnsoleillement();
      reinitialiserFiltreCotation();
      definirModeFigure('aucun');
      appliquerFiltresEtSecteurs();
    }), 'top-right');

    // Le contrôle d'attribution démarre parfois "déplié" (classe posée
    // avant que notre config compact ne s'applique pleinement) — on force
    // l'état replié une fois la carte chargée, sans empêcher l'utilisateur
    // de le rouvrir ensuite.
    map.on('load', () => {
      const attrib = document.querySelector('.maplibregl-ctrl-attrib');
      if (attrib) attrib.classList.remove('maplibregl-compact-show');
    });
    map.on('zoom', appliquerSimplificationZoom);
    // L'affichage des parkings dépend aussi du zoom (voir
    // appliquerVisibiliteParkings) — rafraîchi à chaque zoom, sans repasser
    // par appliquerFiltres.
    map.on('zoom', appliquerVisibiliteParkings);
  }

  // Peuple entries/index (l'index de travail de toute la page) et les deux
  // regroupements dont dépend l'anti-collision des libellés. Renvoie les
  // temps depuis le gîte : c'est la seule sortie de cette étape dont une
  // autre a besoin ensuite (configurerFiltreTemps).
  function construireEntrees(geojson) {
    const parkingInfos = indexerParkingInfos(geojson);
    maxima = calculerMaxima(geojson);
    const tempsDepuisGite = calculerTempsDepuisGite(geojson);
    const sourcesIndex = indexerSources(geojson);
    geojson.features.forEach(f => {
      const entree = addMarker(map, f, parkingInfos, maxima, enSurbrillance, definirFalaiseSelectionnee, suivrePopup, () => ficheReduite, (id) => baseRoutes + id + '.json');
      entries.push(entree);
      index.set(entree.cle, entree);
      if (entree.cat !== 'falaise') return;

      entree.tempsGite = tempsDepuisGite.get(entree.cle) ?? null;
      // Résolu une fois ici (topo_id -> {nom, url}) plutôt que dans
      // popups.js : ce module ne connaît que p (voir son en-tête, "chaque
      // fonction ne dépend que de ses paramètres") — pas d'accès à
      // geojson.sources depuis là-bas.
      const topo = entree.p.topo_id ? sourcesIndex.get(entree.p.topo_id) : null;
      // trim() : au moins un nom de source.csv porte un espace de fin
      // parasite (saisie manuelle) -- corrigé ici plutôt que de compter
      // sur une donnée toujours propre.
      entree.p.topoNom = topo ? topo.nom.trim() : null;
      entree.p.topoUrl = topo ? topo.url : null;
      entree.p.topoEditeur = topo ? topo.auteur : null;
      entree.p.topoType = topo ? topo.type : null;
      // Année déjà résolue côté export (geojson.sources[].annee, voir
      // export_geojson.py/annee_depuis_millesime) : évite de re-parser un
      // format de date ici, notamment le format "JJ/MM/AA" qui ne se
      // laisse pas trivialement découper par simple slice().
      entree.p.topoAnnee = topo ? topo.annee : null;

      const cleSecteur = entree.secteur || entree.nom;
      if (!entriesParSecteur.has(cleSecteur)) entriesParSecteur.set(cleSecteur, []);
      entriesParSecteur.get(cleSecteur).push(entree);

      const site = f.properties.site;
      if (site) {
        if (!entriesParSite.has(site)) entriesParSite.set(site, []);
        entriesParSite.get(site).push(entree);
      }
    });
    return tempsDepuisGite;
  }

  // MapLibre exige le STYLE chargé avant addSource/addLayer : on attend
  // 'load' s'il ne l'est pas — cas normal, le style est plus lent que le
  // geojson préchargé. La source est ajoutée vide puis remplie, le filtre
  // re-posé dans le même tick : aucun flash de points non filtrés.
  function afficherCoucheFalaises() {
    const poser = () => {
      construireCoucheFalaises();
      map.getSource('falaises').setData(construireSourceFalaises(entries, 'aucun', maxima));
    };
    if (map.isStyleLoaded()) {
      poser();
    } else {
      map.once('load', () => {
        poser();
        appliquerFiltresEtSecteurs();
      });
    }
  }

  // Lien profond (?falaise=<cle>, produit par le bouton « Partager » — voir
  // actions-fiche.js) : ouvre directement la fiche d'une falaise précise au
  // chargement, en réutilisant allerVers (même mécanique que "Voir" après une
  // recherche, pas de code de navigation en double). Clé absente ou inconnue :
  // comportement normal, inchangé.
  function ouvrirLienProfond() {
    const cle = new URLSearchParams(location.search).get('falaise');
    if (cle && index.has(cle)) allerVers(cle);
  }

  // Cadre sur l'étendue d'un site — pas de popup (ce n'est pas une entité
  // unique), juste la caméra. Réservée au clic sur son NOM (vue d'ensemble),
  // PAS au clic sur un cercle de secteur : voir le handler de clic de la
  // carte pour pourquoi un cercle zoome sur son propre point plutôt que de
  // cadrer ici tout le site.
  // La recherche se réinitialise (même logique qu'allerVers : une recherche
  // active pourrait sinon masquer des falaises du site qu'on vient justement
  // de rejoindre) ; la sélection courante n'a pas besoin d'être touchée, elle
  // ne cache rien ici.
  function falaisesDuSite(site) {
    return entries.filter((en) => en.cat === 'falaise' && en.p.site === site);
  }

  function zoomerSurSite(site) {
    const falaises = falaisesDuSite(site);
    if (!falaises.length) return;
    reinitialiserRecherche();
    appliquerFiltresEtSecteurs();
    const bounds = new maplibregl.LngLatBounds();
    falaises.forEach((en) => bounds.extend([en.lon, en.lat]));
    reinitialiserPadding(map);
    // Pas de duration explicite : le défaut de MapLibre convient à ce
    // cadrage plus large (essayé en 800 puis 1000ms fixes, aucun des deux ne
    // retrouvait le rythme d'origine — reparti de zéro). dureeReduite()
    // n'ajoute une duration que pour l'annuler (prefers-reduced-motion),
    // jamais pour en imposer une.
    map.fitBounds(bounds, { padding: margeToutVoir(), maxZoom: 16, ...dureeReduite() });
  }

  function ajouterLabelsDeSite(geojson) {
    labelsSites = ajouterLabelsSites(map, geojson, (site) => zoomerSurSite(site));
    // Règle de hiérarchie des libellés : les noms de site ne s'affichent que
    // sous le seuil d'apparition des noms de secteur (zoom <
    // ZOOM_LABELS_SECTEUR), voir appliquerVisibiliteSites. À trancher dès
    // maintenant (le cadrage initial peut déjà être au seuil) puis à chaque
    // zoom.
    map.on('zoom', appliquerVisibiliteSites);
    appliquerVisibiliteSites();
    map.on('moveend', appliquerAntiCollisionSites);
    map.on('zoomend', appliquerAntiCollisionSites);
  }

  // Noms de secteur : masqués par défaut, affichés seulement à fort zoom
  // (voir ZOOM_LABELS_SECTEUR) une fois que les cercles proportionnels sont
  // assez espacés à l'écran pour rester lisibles. appliquerVisibiliteSecteurs
  // et appliquerAntiCollisionSecteurs sont déclarées bien plus haut (elles
  // doivent aussi être appelables depuis definirModeFigure et
  // appliquerFiltresEtSecteurs) ; elles masquent en plus un libellé sans
  // figuré ponctuel visible en dessous, ou en collision à l'écran avec un
  // autre déjà affiché.
  // Clic sur un label de secteur : ouvre sa fiche, exactement comme un clic
  // direct sur son cercle (ouvrirFalaise, même fonction, même absence de
  // mouvement de caméra — la falaise est déjà dans le cadre puisque son
  // étiquette y est visible). Contrairement à ajouterLabelsDeSite : pas de
  // fitBounds ni de reinitialiserRecherche ici, secteur et cercle désignent
  // la MÊME entité (même cle), pas un site qui en coiffe plusieurs.
  function ajouterLabelsDeSecteur(geojson) {
    labelsSecteurs = ajouterLabelsSecteurs(map, geojson, (cle) => ouvrirFalaise(cle));
    map.on('zoom', appliquerVisibiliteSecteurs);
    map.on('moveend', appliquerAntiCollisionSecteurs);
    map.on('zoomend', appliquerAntiCollisionSecteurs);
    appliquerVisibiliteSecteurs();

    // Survol d'un cercle -> surbrillance de l'étiquette qu'un clic au même
    // point activerait (même bascule de zoom que le clic ci-dessus) : sans
    // ça, les deux figurés d'une même cible réagissaient différemment à la
    // souris. Map plutôt qu'un .find() à chaque mousemove (évènement
    // fréquent, un .find() y répéterait un parcours linéaire en continu).
    const labelSecteurParCle = new Map(labelsSecteurs.map((l) => [l.cle, l.el]));
    const labelSiteParNom = new Map(labelsSites.map((l) => [l.site, l.el]));
    let elementSurvole = null;
    const survoler = (el) => {
      if (el === elementSurvole) return;
      elementSurvole?.classList.remove('survole');
      elementSurvole = el || null;
      elementSurvole?.classList.add('survole');
    };
    map.on('mousemove', 'falaises', (e) => {
      const cle = e.features[0]?.properties.cle;
      if (!cle) { survoler(null); return; }
      survoler(map.getZoom() >= ZOOM_LABELS_SECTEUR
        ? labelSecteurParCle.get(cle)
        : labelSiteParNom.get(index.get(cle)?.p.site));
    });
    map.on('mouseleave', 'falaises', () => survoler(null));
  }

  // Retire de la légende ce que CETTE sortie ne contient pas : un réglage qui
  // ne peut rien changer vaut moins que pas de réglage du tout.
  function ajusterLegendeAuxDonnees(geojson) {
    // Les modes "Couenne"/"Grande voie" n'ont de sens que si au moins une
    // falaise a des voies typées. Relit les "entries" déjà construites
    // (nbGrandeVoie/nbCouenne précalculés à la génération, voir
    // export_geojson.py) plutôt que de rescanner le geojson brut une 2e fois.
    const auMoinsUneAvecType = entries.some(e =>
      e.cat === 'falaise' && (e.nbGrandeVoie > 0 || e.nbCouenne > 0)
    );
    if (!auMoinsUneAvecType) {
      ['option-couenne', 'option-gv'].forEach((id) => {
        const opt = document.getElementById(id);
        if (opt) opt.remove();
      });
    }

    // La clé "Gîte" de la légende n'a de sens que si la sortie en a un.
    const aGite = geojson.features.some(f => f.properties.categorie === 'hebergement');
    if (!aGite) {
      const legendeGite = document.getElementById('legende-gite');
      if (legendeGite) legendeGite.remove();
    }
  }

  // Filtre "Depuis le gîte" : masqué par défaut (voir HTML, attribut hidden)
  // tant qu'on n'a pas confirmé qu'au moins une falaise a un temps calculable
  // — un slider sans borne réelle n'aurait rien à montrer. Bornes au multiple
  // de 5, pour un pas net plutôt que des valeurs à la minute près.
  function configurerFiltreTemps(tempsDepuisGite) {
    const tempsValeurs = Array.from(tempsDepuisGite.values());
    if (!tempsValeurs.length || !filtreTemps || !filtreTempsValeur || !legendeTemps) return;

    // Les DEUX bornes arrondissent AU-DESSUS. Le plancher était un
    // Math.floor : avec un minimum réel de 8 min il donnait 5, position à
    // laquelle aucune falaise ne passe le filtre — un cran mort en tête de
    // course, vérifié sur les deux lieux. Arrondir au-dessus garantit qu'à la
    // position la plus basse il reste au moins la falaise la plus proche.
    const plancher = Math.ceil(Math.min(...tempsValeurs) / 5) * 5;
    const plafond = Math.ceil(Math.max(...tempsValeurs) / 5) * 5;
    // Tous les trajets dans le même cran de 5 min : le curseur n'offrirait
    // aucun choix. Cas réel de Pen-Hir, dont les parkings sont à 4 et 5 min
    // du gîte — il s'affichait avec deux positions, dont une qui masquait
    // les 49 falaises. Un réglage qui ne peut rien changer vaut moins que pas
    // de réglage : même règle que les modes couenne/grande voie, retirés
    // quand aucune voie n'est typée.
    if (plancher >= plafond) return;
    filtres.tempsGitePlafond = plafond;
    filtres.tempsMaxGite = plafond;
    filtreTemps.min = String(plancher);
    filtreTemps.max = String(plafond);
    filtreTemps.step = '5';
    filtreTemps.value = String(plafond);
    filtreTempsValeur.textContent = `≤ ${plafond} min`;
    legendeTemps.hidden = false;
    filtreTemps.addEventListener('input', () => {
      filtres.tempsMaxGite = Number(filtreTemps.value);
      filtreTempsValeur.textContent = `≤ ${filtreTemps.value} min`;
      rafraichirBoutonReinitialiserFiltres();
      appliquerFiltresEtSecteurs();
    });
  }

  // Filtre "Ensoleillement" : masqué par défaut (voir HTML, attribut hidden)
  // tant qu'aucune falaise de la sortie n'a d'orientation exploitable — un
  // filtre qui ne pourrait jamais retenir personne vaut moins que pas de
  // filtre, même règle que configurerFiltreTemps.
  function configurerFiltreEnsoleillement() {
    if (!legendeEnsoleillement) return;
    const cases = legendeEnsoleillement.querySelectorAll('input[data-ensoleillement]');
    if (!cases.length) return;
    const exploitable = entries.some((e) => e.cat === 'falaise' && e.ensoleillement !== 'aucune');
    if (!exploitable) return;
    legendeEnsoleillement.hidden = false;
    falaisesSansOrientationConnue = entries.some((e) => e.cat === 'falaise' && e.ensoleillement === 'aucune');
    // Cochables ensemble EN OU (voir le commentaire de filtres.ensoleillement),
    // mais deux groupes, pas un seul : "Matin/Journée/Après-midi" cherchent
    // tous du soleil (se combinent librement entre elles), "Non" cherche son
    // ABSENCE — une intention opposée, pas une nuance de la même recherche.
    // Cocher l'une décoche donc l'autre groupe en entier (Matin + Non
    // cochées ensemble ne voudrait rien dire).
    cases.forEach((case_) => {
      case_.addEventListener('change', () => {
        if (case_.checked) {
          const memeGroupe = (c) => (c.dataset.ensoleillement === 'nord') === (case_.dataset.ensoleillement === 'nord');
          cases.forEach((c) => {
            if (c !== case_ && !memeGroupe(c)) c.checked = false;
          });
        }
        filtres.ensoleillement = Array.from(cases)
          .filter((c) => c.checked)
          .map((c) => c.dataset.ensoleillement);
        rafraichirBoutonReinitialiserFiltres();
        appliquerFiltresEtSecteurs();
      });
    });
  }

  // « Préparer » : monté seulement ici, une fois connus les points réels de
  // la sortie (falaises + parkings + gîte) — ce sont eux qui déterminent les
  // tuiles à télécharger. Idempotent : ne fait rien si le bloc existe déjà
  // (rechargement après un "Réessayer").
  function monterHorsLigne(geojson) {
    const hote = document.getElementById('preparation-hors-ligne');
    if (!hote || hote.querySelector('.btn-preparer')) return;
    monterPreparationHorsLigne({
      map,
      points: geojson.features.map(f => f.geometry.coordinates),
      conteneur: hote,
    });
  }

  function afficherEchecChargement(err) {
    console.error('Erreur de chargement des données', err);
    if (!etatChargement) return;
    etatChargement.textContent = '';
    etatChargement.classList.add('erreur');
    const message = document.createElement('span');
    message.textContent = navigator.onLine
      ? 'Impossible de charger les données de la sortie.'
      : 'Hors ligne, et ces données ne sont pas encore en cache.';
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'btn-reessayer';
    bouton.textContent = 'Réessayer';
    bouton.addEventListener('click', chargerDonnees);
    etatChargement.append(message, bouton);
  }

  chargerDonnees();

  // Indicateur hors-ligne : sans lui, rien ne distingue une carte servie
  // depuis le cache d'une carte à jour — or c'est précisément l'information
  // dont on a besoin en falaise pour savoir si l'on peut se fier à ce qu'on
  // lit. Purement passif (aucun blocage) : le site reste utilisable hors
  // ligne, on le signale simplement.
  const bandeauReseau = document.createElement('div');
  bandeauReseau.className = 'bandeau-hors-ligne';
  bandeauReseau.setAttribute('role', 'status');
  bandeauReseau.textContent = 'Hors ligne — données en cache';
  bandeauReseau.hidden = navigator.onLine;
  // Dans le panneau latéral et non dans <body> : sur desktop il s'y place en
  // flux sous la légende, dont la hauteur varie au repli — un ancrage en
  // pixels serait faux la moitié du temps. Sur mobile le panneau n'a aucune
  // règle (voir style-carte.css) : l'élément s'y positionne contre le
  // viewport, exactement comme .recherche et .legende le font déjà.
  (document.getElementById('panneau-lateral') || document.body).appendChild(bandeauReseau);
  const majReseau = () => {
    bandeauReseau.hidden = navigator.onLine;
    // Le réseau revient : on retente automatiquement ce qui avait échoué au
    // chargement initial, sans attendre un clic.
    if (navigator.onLine && etatChargement && etatChargement.isConnected
        && etatChargement.classList.contains('erreur')) {
      chargerDonnees();
    }
  };
  window.addEventListener('online', majReseau);
  window.addEventListener('offline', majReseau);

  // --- Recherche par nom (et secteur) ---
  if (recherche) {
    recherche.addEventListener('input', () => {
      filtres.recherche = recherche.value.trim().toLowerCase();
      appliquerFiltresEtSecteurs();
      if (btnCentrer) btnCentrer.disabled = !filtres.recherche;
      if (btnEffacer) btnEffacer.hidden = !recherche.value;
    });
    recherche.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        centrerSurRecherche();
      }
    });
  }

  // --- Effacer la recherche ---
  if (btnEffacer) {
    btnEffacer.addEventListener('click', () => {
      reinitialiserRecherche();
      appliquerFiltresEtSecteurs();
      if (recherche) recherche.focus();
    });
  }

  // --- Centrer sur le(s) résultat(s) de recherche ---
  // Action explicite (bouton ou Entrée), jamais automatique pendant la frappe :
  // on ne veut pas faire sauter la carte à chaque caractère tapé.
  function centrerSurRecherche() {
    const q = filtres.recherche;
    if (!q) return;
    // Choisir un résultat depuis le panneau "Filtres" mobile doit ramener
    // sur la carte pour le voir — sinon la caméra bouge derrière un panneau
    // qui reste affiché, et le résultat semble n'avoir rien fait.
    definirVueMobile('carte');
    // Le clavier mobile est encore ouvert : le prochain tap servirait à le
    // fermer plutôt qu'à atteindre sa cible. Bug constaté — après une
    // recherche, le lien « voir sur la carte » du parking restait sans effet.
    if (recherche) recherche.blur();
    const correspondances = entries.filter((e) => e.cat === 'falaise' && e.recherche.includes(q));
    if (!correspondances.length) return;

    if (correspondances.length === 1) {
      allerVers(correspondances[0].cle, undefined, true);
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    correspondances.forEach((e) => bounds.extend(e.marker ? e.marker.getLngLat() : [e.lon, e.lat]));
    reinitialiserPadding(map);
    // Pas de duration explicite, même raison que zoomerSurSite.
    map.fitBounds(bounds, { padding: margeToutVoir(), maxZoom: 16, ...dureeReduite() });
  }

  if (btnCentrer) {
    btnCentrer.disabled = true; // rien à centrer tant que le champ est vide
    btnCentrer.addEventListener('click', centrerSurRecherche);
  }

  // --- Repli/déploiement des FILTRES desktop uniquement (fermé par défaut,
  // cf. HTML) : .legende-cercles (pictos + cercles proportionnels) n'est
  // plus concernée depuis que c'est un sibling séparé de .legende, affiché
  // en permanence des deux côtés desktop et mobile — seuls les réglages
  // (#legende-contenu) se replient. ---
  const legendeToggle = document.querySelector('.legende-toggle');
  const legendeContenu = document.getElementById('legende-contenu');
  if (legendeToggle && legendeContenu) {
    legendeToggle.addEventListener('click', () => {
      const vaOuvrir = legendeContenu.hidden;
      legendeContenu.hidden = !vaOuvrir;
      legendeToggle.setAttribute('aria-expanded', String(vaOuvrir));
      // L'état visuel est porté par l'icône (rotation CSS via aria-expanded,
      // voir .legende-toggle-icone) — le aria-label reste explicite pour le
      // lecteur d'écran (une icône seule ne l'est pas).
      legendeToggle.setAttribute('aria-label', vaOuvrir ? 'Réduire les filtres' : 'Déplier les filtres');
      // Le libellé VISIBLE ("Filtres" / "Filtres · N") ne dit plus l'état —
      // c'est le rôle du chevron (rotation CSS via aria-expanded, voir
      // .legende-toggle-icone) — mais LE nombre de filtres actifs, tenu à
      // jour par rafraichirBoutonReinitialiserFiltres. Le aria-label reste
      // le seul endroit qui dit l'état, explicitement, pour qui n'a pas
      // l'icône.
    });
  }

  // --- Bascule mobile "Carte" / "Filtres" (voir style-carte.css, @media
  // max-width:640px) : sous 641px, remplace la légende flottante par un
  // aller-retour plein écran entre la carte et le panneau de filtres —
  // #panneau-lateral, invisible hors media query. Sans effet ≥641px (garde
  // en plus de celle du CSS, au cas où un futur appel oublierait le
  // contexte) : #map reste alors la seule vue, comme aujourd'hui.
  // inert sur la carte pendant "Filtres" : contrairement à la fiche mobile
  // (qui ne recouvre qu'une partie de l'écran, zoom/"Tout voir" restent
  // volontairement joignables), ce panneau remplace la carte en entier —
  // sans inert, ces contrôles resteraient dans l'ordre de tabulation tout en
  // étant invisibles. Même mécanisme déjà en place pour #panneau-falaise
  // (voir ouvrirPanneauFalaise/fermerPanneauFalaise, marqueurs.js).
  function definirVueMobile(vue) {
    if (estDesktop()) return;
    const enFiltres = vue === 'filtres';
    document.body.classList.toggle('mode-filtres', enFiltres);
    if (btnVueCarte) btnVueCarte.setAttribute('aria-pressed', String(!enFiltres));
    if (btnVueFiltres) btnVueFiltres.setAttribute('aria-pressed', String(enFiltres));
    if (map) map.getContainer().toggleAttribute('inert', enFiltres);
  }
  if (btnVueCarte) btnVueCarte.addEventListener('click', () => definirVueMobile('carte'));
  if (btnVueFiltres) btnVueFiltres.addEventListener('click', () => definirVueMobile('filtres'));

  // --- "Type de voie" (grandeur encodée par la taille des cercles) : boutons
  // à choix unique, même grammaire que .btn-tri-voies ailleurs sur le site
  // (un seul actif à la fois, aria-pressed). Remplace l'ancien select unique
  // "Cercles", qui mélangeait deux questions différentes (quel type de voie,
  // quelle cotation) dans un seul contrôle à 4 choix exclusifs. "Cotation des
  // voies" juste en dessous est désormais un filtre indépendant qui se
  // combine avec ce mode (fourchette 5a-6b + "Grande voie" = falaises avec
  // des grandes voies, dont au moins une voie cotée 5a-6b) : il ne touche pas
  // la taille des cercles, une falaise garde une seule grandeur affichée par
  // sa taille à la fois (voir symboles.js). ---
  const boutonsTypeVoie = document.querySelectorAll('.legende-figure .btn-tri-voies');
  boutonsTypeVoie.forEach((bouton) => {
    bouton.addEventListener('click', () => {
      definirModeFigure(bouton.dataset.mode);
      // Une falaise sans donnée pour ce thème disparaît (source reconstruite
      // par construireSourceFalaises) — son parking ne doit pas rester
      // affiché seul, sans rien à proposer.
      appliquerFiltresEtSecteurs();
    });
  });

  // --- Bouton "Épurer" (taille uniforme, indépendant du mode ci-dessus) ---
  const btnEpuree = document.querySelector('.btn-epuree');
  if (btnEpuree) {
    btnEpuree.addEventListener('click', () => {
      epureeActuelle = !epureeActuelle;
      // aria-pressed porte à la fois l'état accessible ET le style visuel
      // (voir .btn-epuree[aria-pressed="true"]) — une seule source de vérité
      // pour l'état, pas une classe CSS à garder synchronisée avec lui.
      btnEpuree.setAttribute('aria-pressed', String(epureeActuelle));
      // Libellé = action à venir, comme Masquer/Afficher. "Proportionner" :
      // terme du module qui dessine ces cercles (voir l'en-tête de symboles.js).
      btnEpuree.textContent = epureeActuelle ? 'Proportionner' : 'Épurer';
      btnEpuree.setAttribute('aria-label', epureeActuelle
        ? 'Réafficher la taille des cercles'
        : "Simplifier l'affichage des cercles");
      const source = map.getSource('falaises');
      if (source) source.setData(construireSourceFalaises(entries, modeFigureActuel, maxima, epureeActuelle));
      if (map.getLayer('falaises')) {
        map.setPaintProperty('falaises', 'circle-color', expressionCouleurCercles());
      }
      rafraichirLegendeFalaises();
    });
  }

  // --- Fourchette de cotation ---
  // Deux <select> plutôt qu'un curseur à deux poignées : aucun élément natif
  // ne fait ça, et une version maison serait à la fois du code à maintenir et
  // un piège d'accessibilité (cible tactile minuscule, inutilisable au
  // clavier). Deux listes déroulantes sont natives, accessibles et lisibles
  // au doigt — cohérent avec le parti « texte plutôt qu'icône » du site.
  const selectCotationMin = document.getElementById('cotation-min');
  const selectCotationMax = document.getElementById('cotation-max');

  // Synchronise filtres.cotationMin/Max sur les <select> et recalcule
  // nbDansFourchette (nombre de voies de la falaise dans la fourchette
  // choisie) pour chaque falaise. Fait une seule fois par changement de
  // bornes, plutôt qu'à la volée dans appliquerFiltres/construireSourceFalaises
  // qui s'exécutent pour chaque falaise à chaque rendu de la couche.
  function majFourchette() {
    if (!selectCotationMin || !selectCotationMax || !selectCotationMin.options.length) return;
    const min = Number(selectCotationMin.value);
    const max = Number(selectCotationMax.value);
    filtres.cotationMin = min;
    filtres.cotationMax = max;
    entries.forEach((entree) => {
      if (entree.cat !== 'falaise') return;
      entree.nbDansFourchette = compterDansFourchette(entree.cotations, min, max);
    });
  }

  // Applique la fourchette de cotation courante : filtre indépendant (ne
  // touche ni taille ni couleur des cercles, donc pas un mode via
  // definirModeFigure) qui se combine avec "Type de voie". Reconstruit la
  // source pour que nbDansFourchette, à jour, atteigne le filtre natif de la
  // couche (voir construireSourceFalaises / appliquerFiltres), puis relance
  // la cascade de visibilité et le décompte du bouton "Réinitialiser".
  function appliquerFiltreCotation() {
    majFourchette();
    const source = map.getSource('falaises');
    if (source) source.setData(construireSourceFalaises(entries, modeFigureActuel, maxima, epureeActuelle));
    appliquerFiltresEtSecteurs();
    rafraichirBoutonReinitialiserFiltres();
  }

  // Peuple les deux listes avec les cotations RÉELLEMENT présentes dans la
  // sortie, triées par difficulté. Proposer l'échelle complète 3a→9c+
  // afficherait une quarantaine de crans dont la plupart ne correspondent à
  // aucune voie ici — autant de choix qui ne feraient rien.
  function preparerFourchette() {
    if (!selectCotationMin || !selectCotationMax) return;
    const parValeur = new Map();
    entries.forEach((entree) => {
      if (entree.cat !== 'falaise' || !entree.cotations) return;
      for (const cotation of Object.keys(entree.cotations)) {
        const valeur = valeurCotationApprochee(cotation);
        if (valeur == null) continue;
        // Une même valeur peut venir de plusieurs écritures ("4-" et "4a") :
        // on ne garde qu'un libellé par valeur, le plus standard (le plus
        // court une fois normalisé).
        const libelle = cotationVersValeur(cotation) != null
          ? cotation
          : approximerCotation(cotation).label;
        if (!parValeur.has(valeur)) parValeur.set(valeur, libelle);
      }
    });
    const crans = [...parValeur.entries()].sort((a, b) => a[0] - b[0]);
    if (!crans.length) {
      // Plus d'option "cotation" à retirer d'un select (voir "Type de voie"
      // plus haut, qui n'en propose plus) : "Cotation des voies" n'existe
      // désormais que comme section à part entière, retirée en bloc ici si
      // aucune cotation exploitable n'existe dans cette sortie.
      const bloc = document.getElementById('legende-cotation');
      if (bloc) bloc.remove();
      return;
    }
    const options = crans.map(([valeur, libelle]) =>
      `<option value="${valeur}">${escapeHtml(libelle)}</option>`).join('');
    selectCotationMin.innerHTML = options;
    selectCotationMax.innerHTML = options;
    selectCotationMin.value = String(crans[0][0]);
    selectCotationMax.value = String(crans[crans.length - 1][0]);

    // Amplitude réelle des cotations de cette sortie : sert de repère
    // « inactif » à filtreCotationActif (au repos les deux bornes sont ici)
    // et de cible à reinitialiserFiltreCotation.
    filtres.cotationPlancher = crans[0][0];
    filtres.cotationPlafond = crans[crans.length - 1][0];
    filtres.cotationMin = filtres.cotationPlancher;
    filtres.cotationMax = filtres.cotationPlafond;

    // Bornes croisées : plutôt que de refuser la saisie, on pousse l'autre
    // borne — l'utilisateur obtient toujours une fourchette valide sans avoir
    // à comprendre pourquoi son choix a été rejeté.
    const corriger = (deplace) => {
      const min = Number(selectCotationMin.value);
      const max = Number(selectCotationMax.value);
      if (min > max) {
        if (deplace === 'min') selectCotationMax.value = String(min);
        else selectCotationMin.value = String(max);
      }
      // Filtre indépendant : on n'appelle pas definirModeFigure — resserrer
      // la fourchette ne doit pas désélectionner "Type de voie".
      appliquerFiltreCotation();
    };
    selectCotationMin.addEventListener('change', () => corriger('min'));
    selectCotationMax.addEventListener('change', () => corriger('max'));
    majFourchette();
  }

  // Parkings : visibles par défaut à fort zoom (>= ZOOM_PARKINGS), et
  // toujours révélés par une recherche ou une falaise sélectionnée (à tout
  // zoom) — le tout restreint aux parkings des falaises visibles
  // (parkingsAutorises, construit par appliquerFiltres). Contrairement aux
  // falaises (filtre de couche GPU), les parkings sont des marqueurs DOM :
  // leur affichage se pilote ici, re-exécuté sur chaque zoom sans repasser
  // par appliquerFiltres (qui re-poserait inutilement le filtre de la couche).
  function appliquerVisibiliteParkings() {
    // Déclencheurs d'affichage : recherche active, falaise sélectionnée, ou
    // fort zoom (>= ZOOM_PARKINGS) — à tout autre moment, tout est masqué.
    const zoomPousse = map.getZoom() >= ZOOM_PARKINGS;
    const montrerParkings = Boolean(filtres.recherche) || Boolean(falaiseSelectionneeCle) || zoomPousse;

    // Parkings autorisés : ceux déjà portés par recherche/sélection
    // (parkingsAutorises, construit par appliquerFiltres) +, à fort zoom,
    // ceux de TOUTES les falaises visibles — le mode "vue détaillée" par
    // défaut. (À fort zoom sans filtre, falaisesVisibles contient toutes les
    // falaises, donc tous leurs parkings s'affichent.)
    const aMontrer = new Set(parkingsAutorises);
    if (zoomPousse) {
      entries.forEach((entree) => {
        if (entree.cat === 'falaise' && falaisesVisibles.has(entree.cle)) {
          entree.parkingAssocie.forEach((nom) => aMontrer.add(nom));
        }
      });
    }

    entries.forEach((entree) => {
      if (entree.cat !== 'parking') return;
      entree.marker.getElement().style.display = (montrerParkings && aMontrer.has(entree.nom)) ? '' : 'none';
    });
  }

  // NOTE portée : cette fonction est déplacée ICI, dans initCarte — depuis
  // la couche native elle utilise map et falaisesVisibles via la closure
  // (elle ne peut plus rester au niveau module, comme avant).
  //
  // Ensoleillement : correspondance EXACTE avec la catégorie choisie, un
  // seul bouton actif à la fois (voir configurerFiltreEnsoleillement) — pas
  // de logique de combinaison, chaque bouton fait exactement ce que son nom
  // dit.
  //
  // Un filtre actif masque aussi les falaises SANS orientation connue
  // (elles ne peuvent satisfaire aucune catégorie) — sans le dire, une
  // carte à Crozon (16 falaises sur 60 concernées) semblerait avoir perdu
  // des données plutôt que simplement filtrer. Note construite en JS, pas
  // statique dans le HTML : comme .legende-note ailleurs dans ce fichier,
  // n'existe que si elle a effectivement quelque chose à dire (filtre actif
  // ET lieu concerné).
  function rafraichirNoteEnsoleillement(filtreActif) {
    if (!legendeEnsoleillement) return;
    const utile = Boolean(filtreActif) && falaisesSansOrientationConnue;
    if (utile && !noteEnsoleillementAucune) {
      noteEnsoleillementAucune = document.createElement('p');
      noteEnsoleillementAucune.className = 'legende-note';
      noteEnsoleillementAucune.textContent = 'Falaises sans orientation connue non affichées.';
      legendeEnsoleillement.after(noteEnsoleillementAucune);
    } else if (!utile && noteEnsoleillementAucune) {
      noteEnsoleillementAucune.remove();
      noteEnsoleillementAucune = null;
    }
  }

  function appliquerFiltres(entries, filtres, mode, falaiseSelectionneeCle) {
  // Le mode "Cercles" et le filtre de trajet masquent des falaises mais
  // n'autorisent PAS leurs parkings : bouger le slider réafficherait des
  // dizaines de parkings d'un coup. Seuls trois déclencheurs les autorisent
  // (voir appliquerVisibiliteParkings) : une recherche active, la falaise
  // sélectionnée si elle reste visible, et le zoom >= ZOOM_PARKINGS — ce
  // dernier ne passe pas par ce set.
  parkingsAutorises = new Set();

  // Couche native : on pose le FILTRE de la couche, pas un display DOM, et on
  // miroite le résultat dans falaisesVisibles pour l'anti-collision.
  // tempsGite null -> coalesce 0 : une falaise sans trajet calculé n'est
  // jamais exclue par le slider. L'exclusion par MODE se fait, elle, dans la
  // SOURCE et non ici.
  const conditions = [];
  if (filtres.recherche) conditions.push(['>=', ['index-of', filtres.recherche, ['get', 'recherche']], 0]);
  if (Number.isFinite(filtres.tempsMaxGite)) conditions.push(['<=', ['coalesce', ['get', 'tempsGite'], 0], filtres.tempsMaxGite]);
  // Union des catégories cochées, chacune une correspondance EXACTE (voir
  // le commentaire de filtres.ensoleillement) — pas de repli "on suppose
  // que ça passe" ici, contrairement au temps depuis le gîte où l'absence
  // de mesure ne doit jamais exclure : une falaise sans orientation
  // exploitable ne peut satisfaire aucune catégorie cochée.
  if (filtres.ensoleillement.length) {
    conditions.push(['in', ['get', 'ensoleillement'], ['literal', filtres.ensoleillement]]);
  }
  // Fourchette de cotation resserrée : ne garde que les falaises avec au
  // moins une voie dans les bornes (nbDansFourchette, propriété posée par
  // construireSourceFalaises et rafraîchie à chaque changement de bornes via
  // appliquerFiltreCotation qui reconstruit la source). Indépendant du mode
  // "Type de voie" ci-dessus : les deux conditions se cumulent dans le 'all'.
  if (filtreCotationActif()) {
    conditions.push(['>', ['coalesce', ['get', 'nbDansFourchette'], 0], 0]);
  }
  if (map.getLayer('falaises')) map.setFilter('falaises', conditions.length ? ['all', ...conditions] : null);
  rafraichirNoteEnsoleillement(filtres.ensoleillement.length > 0);

  falaisesVisibles = new Set();
  entries.forEach((entree) => {
    if (entree.cat !== 'falaise') return;
    const visible =
      (!filtres.recherche || entree.recherche.includes(filtres.recherche)) &&
      !estFalaiseVideDansMode(entree, mode) &&
      (entree.tempsGite == null || entree.tempsGite <= filtres.tempsMaxGite) &&
      (!filtres.ensoleillement.length || filtres.ensoleillement.includes(entree.ensoleillement)) &&
      (!filtreCotationActif() || entree.nbDansFourchette > 0);
    if (visible) {
      falaisesVisibles.add(entree.cle);
      if (filtres.recherche) entree.parkingAssocie.forEach((nom) => parkingsAutorises.add(nom));
    }
  });

  // La falaise sélectionnée ne compte que si elle est toujours effectivement
  // visible (recherche/mode/temps compris, cf. falaisesVisibles posé juste
  // au-dessus) — sinon son parking ne doit pas rester affiché seul, sans
  // qu'aucune falaise visible ne le justifie.
  if (falaiseSelectionneeCle) {
    const falaise = entries.find((e) => e.cat === 'falaise' && e.cle === falaiseSelectionneeCle);
    if (falaise && falaisesVisibles.has(falaise.cle)) {
      falaise.parkingAssocie.forEach((nom) => parkingsAutorises.add(nom));
    }
  }

  // Visibilité des marqueurs parking : dépend aussi du zoom (voir
  // appliquerVisibiliteParkings) — appelée ici après le calcul des parkings
  // autorisés, et sur chaque zoom via map.on('zoom').
  appliquerVisibiliteParkings();
}
} // fin de initCarte

function remplirAutocompletion(geojson) {
  const datalist = document.getElementById('falaises-liste');
  if (!datalist) return;
  const libelles = geojson.features
    .filter(f => f.properties.categorie === 'falaise')
    .map(f => libelleFalaise(f.properties))
    .sort((a, b) => a.localeCompare(b, 'fr'));
  datalist.innerHTML = libelles.map(txt => `<option value="${escapeHtml(txt)}"></option>`).join('');
}
