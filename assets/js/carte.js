/* carte.js — point d'entrée : orchestration de la carte pour une page sortie.
   Chaque page sortie importe initCarte(dataUrl) et l'appelle avec le chemin
   vers son propre data.geojson. */

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs';
import { escapeHtml } from './utils.js';
import {
  indexerParkingInfos, calculerMaxima, calculerTempsDepuisGite, indexerSources,
  estFalaiseVideDansMode, libelleFalaise,
  compterDansFourchette, maximaFourchette, valeurCotationApprochee,
  cotationVersValeur, approximerCotation,
} from './donnees.js';
import { construireSourceFalaises, couleurFalaisePourMode, infosLegendePourMode, construireLegendeFalaises } from './symboles.js';
import { addMarker, ouvrirPopupFalaise, ouvrirPanneauFalaise, fermerPanneauFalaise, cablerFermetureManuellePanneau, synchroniserPoignee, afficherDetailVoies, masquerDetailVoies, basculerTriDetailVoies, remplirPlaceholderVoies } from './marqueurs.js';
import { ajouterLabelsSites, ajouterLabelsSecteurs, ZOOM_LABELS_SECTEUR } from './labels.js';
import { margeAvantPopup, margeToutVoir, creerControleToutVoir, reinitialiserPadding, limiterZoneCarte, estDesktop, dureeAnimation } from './carte-utils.js';
import { monterPreparationHorsLigne } from './hors-ligne.js';

// Seuil de zoom en dessous duquel les falaises sont simplifiées en petit
// point uniforme (voir appliquerSimplificationZoom dans initCarte) — à
// ajuster après un premier test réel sur le terrain.
const ZOOM_SIMPLIFICATION = 13;

// Au-delà de ce zoom, les parkings sont visibles par défaut, sans recherche
// ni falaise sélectionnée (voir appliquerVisibiliteParkings). Calé sur
// ZOOM_LABELS_SECTEUR (labels.js) : le repère "vue détaillée", où l'info
// parking devient la plus actionnable et où les marqueurs sont assez espacés
// pour ne pas se chevaucher. En dessous, ils restent masqués — révélés par
// recherche/sélection seulement.
const ZOOM_PARKINGS = 15;

export function initCarte(dataUrl) {
  // La carte est créée APRÈS le chargement de data.geojson : les bounds
  // réelles passent au CONSTRUCTEUR plutôt qu'à un fitBounds animé. Elle naît
  // donc dans la bonne vue, sans animation ni tuiles téléchargées pour un
  // centre provisoire — c'est l'objectif premier ici.
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

  const entries = []; // { marker, cat, nom, secteur, cle, recherche, parkingAssocie, nbVoies, nbFaciles, nbGrandeVoie, nbCouenne, tempsGite }
  const index = new Map(); // cle -> entree, pour naviguer vers un marqueur lié
  let labelsSecteurs = []; // [{el, marker, nom}], peuplé une fois le geojson chargé
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
  const filtres = { recherche: '', tempsMaxGite: Infinity, tempsGitePlafond: Infinity };
  const blocCotation = document.getElementById('legende-cotation');
  let modeFigureActuel = 'aucun'; // mode courant du sélecteur "Cercles" — voir appliquerFiltres()
  let falaiseSelectionneeCle = null; // falaise dont la popup est ouverte (ou origine/cible d'une navigation) — voir appliquerFiltres()

  // Déclarés tôt (référencés par allerVers/reinitialiserRecherche ci-dessous,
  // câblés plus bas dans la fonction).
  const recherche = document.querySelector('.recherche input');
  const btnCentrer = document.querySelector('.btn-centrer');
  const btnEffacer = document.querySelector('.btn-effacer');
  const filtreTemps = document.getElementById('filtre-temps');
  const filtreTempsValeur = document.getElementById('filtre-temps-valeur');
  const legendeTemps = document.getElementById('legende-temps');

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
  // map.on(...) une fois le geojson chargé.
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

  // Actions du contenu de popup (poignée, copier, lien vers un secteur) :
  // UN SEUL écouteur délégué, posé une fois ici, qui retrouve sa cible via
  // closest() à chaque clic — plutôt que ré-attacher des écouteurs sur des
  // nœuds DOM précis à chaque ouverture (ancien attachPopupActions). Robuste
  // à toute réécriture ultérieure du contenu par MapLibre, quelle qu'en soit
  // la cause exacte (bug observé : la poignée ne répondait plus après avoir
  // déplacé la carte).
  document.addEventListener('click', (e) => {
    const poignee = e.target.closest('.poignee-fiche');
    if (poignee) {
      const contenu = poignee.closest('.maplibregl-popup-content');
      if (!contenu) return;
      ficheReduite = contenu.classList.toggle('fiche-reduite');
      synchroniserPoignee(poignee, ficheReduite);
      return;
    }

    // "Voir le détail des voies" / "Retour" : swap de contenu dans le même
    // .popup (mobile ou panneau desktop), voir afficherDetailVoies/
    // masquerDetailVoies (marqueurs.js) pour la mécanique DOM complète.
    const btnDetail = e.target.closest('.btn-voir-detail-voies');
    if (btnDetail) {
      const popupEl = btnDetail.closest('.popup');
      const placeholder = btnDetail.closest('.voies-histo-placeholder');
      if (popupEl && placeholder) {
        afficherDetailVoies(popupEl, placeholder.dataset.routeFalaise);
      }
      return;
    }
    const btnRetour = e.target.closest('.btn-retour-fiche');
    if (btnRetour) {
      const popupEl = btnRetour.closest('.popup');
      // ficheReduite (variable de module, plus haut) : restaure l'état
      // replié/déplié tel qu'il était AVANT l'ouverture du détail (jamais
      // modifié par afficherDetailVoies, voir marqueurs.js).
      if (popupEl) masquerDetailVoies(popupEl, ficheReduite);
      return;
    }
    // Bascule Cotation/Position (voir popups.js, construireDetailVoies) :
    // même chemin data-route-falaise que "Voir le détail des voies"
    // ci-dessus, le bouton de tri vit dans le même .voies-histo-placeholder.
    // "Réessayer" après un échec de chargement du détail des voies (voir
    // marqueurs.js) : on repart du placeholder lui-même, qui porte encore ses
    // data-route/data-route-falaise.
    const btnReessayer = e.target.closest('.btn-reessayer-voies');
    if (btnReessayer) {
      const placeholder = btnReessayer.closest('.voies-histo-placeholder');
      if (placeholder) remplirPlaceholderVoies(placeholder, (id) => baseRoutes + id + '.json');
      return;
    }

    const btnTri = e.target.closest('.btn-tri-voies');
    if (btnTri) {
      const popupEl = btnTri.closest('.popup');
      const placeholder = btnTri.closest('.voies-histo-placeholder');
      if (popupEl && placeholder) {
        basculerTriDetailVoies(popupEl, placeholder.dataset.routeFalaise, btnTri.dataset.tri);
      }
      return;
    }

    const gpsBtn = e.target.closest('.gps-copie');
    if (gpsBtn) {
      // Bascule le mot d'action, jamais la valeur : la laisser affichée
      // pendant la confirmation permet de relire ce qu'on vient de copier.
      const action = gpsBtn.querySelector('.gps-action');
      const coords = `${Number(gpsBtn.dataset.lat).toFixed(5)}, ${Number(gpsBtn.dataset.lon).toFixed(5)}`;
      navigator.clipboard.writeText(coords).then(() => {
        if (action) action.textContent = 'Copié !';
        gpsBtn.classList.add('copied');
        setTimeout(() => {
          if (action) action.textContent = 'Copier';
          gpsBtn.classList.remove('copied');
        }, 1500);
      });
      return;
    }

    // Partager cette falaise (voir popups.js, popupFalaise) : construit le
    // même lien profond que lit le handler ?falaise= plus haut (initCarte) —
    // navigator.share() sur les navigateurs qui le supportent (feuille de
    // partage native, mobile surtout), repli presse-papiers sinon, même
    // mécanique de confirmation que .gps-copie ci-dessus (texte du bouton
    // lui-même, pas de mot-action séparé à gérer ici).
    const btnPartager = e.target.closest('.btn-partager');
    if (btnPartager) {
      const url = `${location.origin}${location.pathname}?falaise=${encodeURIComponent(btnPartager.dataset.cle)}`;
      if (navigator.share) {
        navigator.share({ title: btnPartager.dataset.nom, url }).catch(() => {});
      } else {
        const texteOriginal = btnPartager.textContent;
        navigator.clipboard.writeText(url).then(() => {
          btnPartager.textContent = 'Lien copié !';
          setTimeout(() => { btnPartager.textContent = texteOriginal; }, 1500);
        });
      }
      return;
    }

    // Les lignes .parking-ligne (fiche falaise) empruntent le même chemin que
    // les .lien-secteur : navigation + garde du panneau ouvert sur desktop.
    const lienSecteur = e.target.closest('.lien-secteur, .parking-ligne');
    if (lienSecteur) {
      const popupEl = lienSecteur.closest('.popup');
      const origineCle = popupEl ? popupEl.dataset.cle : undefined;
      // Même garde que ouvrirFalaise : sur desktop, si c'est le panneau droit
      // (fiche falaise) qui est ouvert, on le LAISSE en place — les panneaux
      // gauche et droit sont indépendants, garder la card ouverte conserve le
      // contexte pendant qu'on affiche le parking associé (lien "Voir sur la
      // carte"). Sinon (popup parking/gîte flottante, ou mobile) comportement
      // inchangé : une seule fiche à la fois.
      if (popupOuverte && !(estDesktop() && popupOuverte.estPanneauFalaise)) {
        popupOuverte.remove();
      }
      allerVers(lienSecteur.dataset.nom, origineCle);
    }
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
  // map.on('zoom', appliquerSimplificationZoom) est enregistré après la
  // création de la carte, dans le .then (voir plus bas) — map n'existe pas
  // encore à ce stade du code.

  // Reconstruit la mini-légende falaises selon le mode "Cercles" courant ET
  // l'état de simplification par zoom — sinon la légende continuerait de
  // montrer des cercles de référence à une échelle où seuls des points
  // uniformes sont réellement affichés (trompeur).
  function rafraichirLegendeFalaises() {
    const { max, median, remplissage } = infosLegendePourMode(modeFigureActuel, maxima);
    construireLegendeFalaises(max, median, remplissage, modeSimplifieActuel, maxima.total);
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
        'circle-color': ['step', ['zoom'], COULEUR_ELOIGNE, ZOOM_SIMPLIFICATION, couleurFalaisePourMode('aucun')],
        'circle-stroke-width': ['step', ['zoom'], 1, ZOOM_SIMPLIFICATION, 2],
        'circle-stroke-color': '#ffffff',
        'circle-opacity': ['case', ['boolean', ['feature-state', 'estompe'], false], 0.25, 1],
      },
    });
    map.on('mouseenter', 'falaises', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'falaises', () => { map.getCanvas().style.cursor = ''; });
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

      const features = map.queryRenderedFeatures(e.point, { layers: ['falaises'] });
      const cle = features[0] && features[0].properties.cle;
      if (cle) {
        ouvrirFalaise(cle);
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
      : ouvrirPopupFalaise(map, entree, ctxPopup);
  }

  // Change le mode "Cercles" et redessine tout ce qui en dépend — utilisé
  // par le sélecteur lui-même ET par allerVers (voir plus bas) : naviguer
  // vers une falaise doit garantir qu'elle reste visible, quitte à sortir
  // d'un thème qui l'aurait masquée (voir estFalaiseVideDansMode).
  function definirModeFigure(nouveauMode) {
    modeFigureActuel = nouveauMode;
    if (selectFigure) selectFigure.value = nouveauMode;
    // Les bornes de cotation n'ont de sens que dans leur mode : les afficher
    // en permanence laisserait croire qu'elles filtrent alors qu'elles ne
    // pilotent rien (même principe que le filtre de trajet, masqué tant
    // qu'aucun temps n'est calculable).
    if (blocCotation) blocCotation.hidden = nouveauMode !== 'cotation';
    if (nouveauMode === 'cotation') majFourchette();
    // Couche native : remplace les features (un mode en exclut certaines,
    // voir construireSourceFalaises) et la couleur du thème. setData
    // remplace l'ancien dessinerFalaise + trierCerclesParTaille : le tri par
    // taille est fait dans construireSourceFalaises (valeur décroissante).
    const source = map.getSource('falaises');
    if (source) source.setData(construireSourceFalaises(entries, modeFigureActuel, maxima));
    if (map.getLayer('falaises')) {
      map.setPaintProperty('falaises', 'circle-color', ['step', ['zoom'], COULEUR_ELOIGNE, ZOOM_SIMPLIFICATION, couleurFalaisePourMode(modeFigureActuel)]);
    }
    rafraichirLegendeFalaises();
    // Un changement de mode peut vider un thème entier (ex. "Grande voie" sur
    // un secteur 100% couenne) : le libellé de secteur n'a plus de figuré
    // ponctuel sous lui, voir appliquerAntiCollisionSecteurs. Les parkings
    // eux-mêmes sont retraités par appliquerFiltresEtSecteurs() (appelé par
    // le sélecteur après definirModeFigure).
    appliquerAntiCollisionSecteurs();
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
    // "Cercles" actif la masquerait (aucune donnée pour ce thème — voir
    // estFalaiseVideDansMode), on repasse sur "Voies" plutôt que de laisser
    // une popup s'ouvrir sans aucun figuré en dessous. Même vérification
    // pour l'origine d'un lien croisé (cas plus rare, mais même risque).
    // Même logique pour le filtre "Depuis le gîte" : une falaise au-delà du
    // seuil actuel ne doit pas non plus rester masquée quand on navigue
    // explicitement vers elle.
    const tempsGiteEmpecheVisibilite = (entree) => entree.tempsGite != null && entree.tempsGite > filtres.tempsMaxGite;
    const cibleSeraitMasquee = cible.cat === 'falaise' && (estFalaiseVideDansMode(cible, modeFigureActuel) || tempsGiteEmpecheVisibilite(cible));
    const origineSeraitMasquee = origine && origine.cat === 'falaise' && (estFalaiseVideDansMode(origine, modeFigureActuel) || tempsGiteEmpecheVisibilite(origine));
    if (cibleSeraitMasquee || origineSeraitMasquee) {
      definirModeFigure('aucun');
      reinitialiserFiltreTemps();
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
  function chargerDonnees() {
    if (etatChargement) {
      etatChargement.textContent = 'Chargement de la carte…';
      etatChargement.classList.remove('erreur');
    }
    return fetch(dataUrl)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} sur ${dataUrl}`);
      return r.json();
    })
    .then(geojson => {
      // Cadrage initial AVANT de créer la carte : les bounds réelles des
      // marqueurs sont connues ici (data.geojson est préchargé via
      // <link rel="preload">, l'attente est quasi nulle — le parse de
      // maplibre-gl.mjs prend plus longtemps que ce fetch). Passées au
      // constructeur via bounds + fitBoundsOptions (padding/maxZoom inclus,
      // doc MapLibre v6) : la carte démarre directement dans la bonne vue,
      // sans fitBounds() animé après coup.
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
        fitBoundsOptions: { padding: margeToutVoir(), maxZoom: 15 },
        attributionControl: false,
      });
      // La vue initiale est déjà la bonne (pas d'animation au chargement) :
      // on peut poser immédiatement les limites de dérive, sans attendre un
      // moveend (ex- fitToMarkers).
      limiterZoneCarte(map);
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
        if (borneGlobale) map.fitBounds(borneGlobale, { padding: margeToutVoir(), maxZoom: 15 });
        // "Vue d'ensemble" signifie repartir à zéro : aucune sélection ni
        // recherche active — sinon la caméra revient mais les marqueurs
        // restent restreints, contradiction avec "tout voir".
        falaiseSelectionneeCle = null;
        reinitialiserRecherche();
        reinitialiserFiltreTemps();
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

      const parkingInfos = indexerParkingInfos(geojson);
      maxima = calculerMaxima(geojson);
      const tempsDepuisGite = calculerTempsDepuisGite(geojson);
      const sourcesIndex = indexerSources(geojson);
      geojson.features.forEach(f => {
        const entree = addMarker(map, f, parkingInfos, maxima, enSurbrillance, definirFalaiseSelectionnee, suivrePopup, () => ficheReduite, (id) => baseRoutes + id + '.json');
        entries.push(entree);
        index.set(entree.cle, entree);
        if (entree.cat === 'falaise') {
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
        }
      });
      // MapLibre exige le STYLE chargé avant addSource/addLayer : on attend
      // 'load' s'il ne l'est pas — cas normal, le style est plus lent que le
      // geojson préchargé. La source est ajoutée vide puis remplie, le filtre
      // re-posé dans le même tick : aucun flash de points non filtrés.
      const chargerFalaises = () => {
        construireCoucheFalaises();
        map.getSource('falaises').setData(construireSourceFalaises(entries, 'aucun', maxima));
      };
      if (map.isStyleLoaded()) {
        chargerFalaises();
      } else {
        map.once('load', () => {
          chargerFalaises();
          appliquerFiltresEtSecteurs();
        });
      }

      // Lien profond (?falaise=<cle>, voir .btn-partager plus bas) : ouvre
      // directement la fiche d'une falaise précise au chargement — réutilise
      // allerVers (même mécanique que "Voir" après une recherche, ligne
      // ~1008), pas de nouveau code de navigation. cle absente/inconnue :
      // comportement normal, inchangé.
      const cleLienProfond = new URLSearchParams(location.search).get('falaise');
      if (cleLienProfond && index.has(cleLienProfond)) {
        allerVers(cleLienProfond);
      }

      // Clic sur un label de site : cadre sur l'étendue de toutes ses
      // falaises — pas de popup (ce n'est pas une entité unique), juste la
      // caméra. La recherche se réinitialise (même logique qu'allerVers :
      // une recherche active pourrait sinon masquer des falaises du site
      // qu'on vient justement de rejoindre) ; la sélection courante n'a pas
      // besoin d'être touchée, elle ne cache rien ici.
      labelsSites = ajouterLabelsSites(map, geojson, (site) => {
        const falaisesDuSite = geojson.features.filter(f =>
          f.properties.categorie === 'falaise' && f.properties.site === site
        );
        if (!falaisesDuSite.length) return;
        reinitialiserRecherche();
        appliquerFiltresEtSecteurs();
        const bounds = new maplibregl.LngLatBounds();
        falaisesDuSite.forEach(f => bounds.extend(f.geometry.coordinates));
        reinitialiserPadding(map);
        map.fitBounds(bounds, { padding: margeToutVoir(), maxZoom: 16 });
      });
      // Règle de hiérarchie des libellés : les noms de site ne s'affichent
      // que sous le seuil d'apparition des noms de secteur (zoom <
      // ZOOM_LABELS_SECTEUR), voir appliquerVisibiliteSites. À trancher dès
      // maintenant (le cadrage initial peut déjà être au seuil) puis à
      // chaque zoom.
      map.on('zoom', appliquerVisibiliteSites);
      appliquerVisibiliteSites();
      map.on('moveend', appliquerAntiCollisionSites);
      map.on('zoomend', appliquerAntiCollisionSites);
      appliquerSimplificationZoom();

      // Noms de secteur : masqués par défaut, affichés seulement à fort zoom
      // (voir ZOOM_LABELS_SECTEUR) une fois que les cercles proportionnels
      // sont assez espacés à l'écran pour rester lisibles. appliquerVisibiliteSecteurs/
      // appliquerAntiCollisionSecteurs (déclarées plus haut, avant le fetch : elles
      // doivent aussi être appelables depuis definirModeFigure/appliquerFiltresEtSecteurs)
      // masquent en plus un libellé sans figuré ponctuel visible en dessous, ou en
      // collision à l'écran avec un autre déjà affiché.
      labelsSecteurs = ajouterLabelsSecteurs(map, geojson);
      map.on('zoom', appliquerVisibiliteSecteurs);
      map.on('moveend', appliquerAntiCollisionSecteurs);
      map.on('zoomend', appliquerAntiCollisionSecteurs);
      appliquerVisibiliteSecteurs();

      // borneGlobale a déjà été calculé au début du .then (bounds passées au
      // constructeur) ; limiterZoneCarte a été posée juste après la création.
      remplirAutocompletion(geojson);
      // La légende initiale est déjà construite par appliquerSimplificationZoom()
      // ci-dessus (state changed depuis null au premier appel).

      // Les modes "Couenne"/"Grande voie" n'ont de sens que si au moins une
      // falaise a des voies typées couenne/grande voie — sinon ces options
      // restent masquées. Relit les "entries" déjà construites
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

      // Filtre "Depuis le gîte" : masqué par défaut (voir HTML, attribut
      // hidden) tant qu'on n'a pas confirmé qu'au moins une falaise a un
      // temps calculable — un slider sans borne réelle n'aurait rien à
      // montrer. Bornes arrondies au multiple de 5 le plus proche (ex. 5→120
      // sur ce jeu de données) pour un pas de slider net plutôt que des
      // valeurs à la minute près, qui n'apportent rien de plus utile ici.
      const tempsValeurs = Array.from(tempsDepuisGite.values());
      if (tempsValeurs.length && filtreTemps && filtreTempsValeur && legendeTemps) {
        const plancher = Math.floor(Math.min(...tempsValeurs) / 5) * 5;
        const plafond = Math.ceil(Math.max(...tempsValeurs) / 5) * 5;
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
          appliquerFiltresEtSecteurs();
        });
      }

      appliquerFiltresEtSecteurs();
      if (etatChargement) etatChargement.remove();

      // « Préparer le hors-ligne » : monté ici, une fois qu'on connaît les
      // points réels de la sortie (falaises + parkings + gîte) — ce sont eux
      // qui déterminent les tuiles à télécharger. Placé dans la légende,
      // avec le reste des réglages de la carte. Idempotent : ne fait rien si
      // le bloc existe déjà (rechargement après un "Réessayer").
      // Les listes de cotations se peuplent depuis les entries : ne peut se
      // faire qu'une fois data.geojson lu.
      preparerFourchette();

      const hote = document.getElementById('preparation-hors-ligne');
      if (hote && !hote.querySelector('.btn-preparer')) {
        monterPreparationHorsLigne({
          map,
          points: geojson.features.map(f => f.geometry.coordinates),
          conteneur: hote,
        });
      }
    })
    .catch(err => {
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
    });
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
    map.fitBounds(bounds, { padding: margeToutVoir(), maxZoom: 16 });
  }

  if (btnCentrer) {
    btnCentrer.disabled = true; // rien à centrer tant que le champ est vide
    btnCentrer.addEventListener('click', centrerSurRecherche);
  }

  // --- Repli/déploiement du panneau légende (fermé par défaut, cf. HTML) ---
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
      legendeToggle.setAttribute('aria-label', vaOuvrir ? 'Réduire la légende' : 'Déplier la légende');
      // Le libellé VISIBLE suit l'état (un chevron seul était illisible) :
      // "Masquer" quand la légende est affichée, "Afficher" quand repliée.
      const texteToggle = legendeToggle.querySelector('.legende-toggle-texte');
      if (texteToggle) texteToggle.textContent = vaOuvrir ? 'Masquer' : 'Afficher';
    });
  }

  // --- Sélecteur de figuré (cercles proportionnels) ---
  const selectFigure = document.getElementById('mode-figure');
  if (selectFigure) {
    selectFigure.addEventListener('change', () => {
      definirModeFigure(selectFigure.value);
      // Une falaise sans donnée pour ce thème disparaît (source reconstruite
      // par construireSourceFalaises) — son parking ne doit pas rester
      // affiché seul, sans rien à proposer.
      appliquerFiltresEtSecteurs();
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

  // Recalcule nbDansFourchette pour chaque falaise, puis les maxima du mode.
  // Fait ICI, une seule fois par changement de bornes, plutôt qu'à la volée
  // dans estFalaiseVideDansMode/valeurPourMode : ces deux fonctions sont
  // appelées pour chaque falaise à chaque rendu de la couche.
  function majFourchette() {
    if (!selectCotationMin || !selectCotationMax) return;
    const min = Number(selectCotationMin.value);
    const max = Number(selectCotationMax.value);
    entries.forEach((entree) => {
      if (entree.cat !== 'falaise') return;
      entree.nbDansFourchette = compterDansFourchette(entree.cotations, min, max);
    });
    // Pas de compte affiché ici : les modes « couennes » et « grandes voies »
    // masquent eux aussi les falaises à zéro sans jamais annoncer de total.
    // N'en afficher un que pour la fourchette serait une incohérence née de
    // la nouveauté de ce mode. Si ce retour chiffré s'avère utile, il devra
    // être ajouté à TOUS les modes d'un coup.
    Object.assign(maxima, maximaFourchette(entries));
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
      const bloc = document.getElementById('legende-cotation');
      if (bloc) bloc.remove();
      const option = selectFigure?.querySelector('option[value="cotation"]');
      if (option) option.remove();
      return;
    }
    const options = crans.map(([valeur, libelle]) =>
      `<option value="${valeur}">${escapeHtml(libelle)}</option>`).join('');
    selectCotationMin.innerHTML = options;
    selectCotationMax.innerHTML = options;
    selectCotationMin.value = String(crans[0][0]);
    selectCotationMax.value = String(crans[crans.length - 1][0]);

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
      majFourchette();
      definirModeFigure('cotation');
      appliquerFiltresEtSecteurs();
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
  if (map.getLayer('falaises')) map.setFilter('falaises', conditions.length ? ['all', ...conditions] : null);

  falaisesVisibles = new Set();
  entries.forEach((entree) => {
    if (entree.cat !== 'falaise') return;
    const visible =
      (!filtres.recherche || entree.recherche.includes(filtres.recherche)) &&
      !estFalaiseVideDansMode(entree, mode) &&
      (entree.tempsGite == null || entree.tempsGite <= filtres.tempsMaxGite);
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
