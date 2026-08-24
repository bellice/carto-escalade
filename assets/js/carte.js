/* carte.js — point d'entrée : orchestration de la carte pour une page sortie.
   Chaque page sortie importe initCarte(dataUrl) et l'appelle avec le chemin
   vers son propre data.geojson. */

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs';
import { escapeHtml } from './utils.js';
import {
  indexerParkingInfos, calculerMaxima, calculerTempsDepuisGite,
  estFalaiseVideDansMode, libelleFalaise,
} from './donnees.js';
import { construireSourceFalaises, couleurFalaisePourMode, infosLegendePourMode, construireLegendeFalaises } from './symboles.js';
import { addMarker, ouvrirPopupFalaise, synchroniserPoignee } from './marqueurs.js';
import { ajouterLabelsSites, ajouterLabelsSecteurs, ZOOM_LABELS_SECTEUR } from './labels.js';
import { margeAvantPopup, margeToutVoir, creerControleToutVoir, reinitialiserPadding, limiterZoneCarte } from './carte-utils.js';

// Seuil de zoom en dessous duquel les falaises sont simplifiées en petit
// point uniforme (voir appliquerSimplificationZoom dans initCarte) — à
// ajuster après un premier test réel sur le terrain.
const ZOOM_SIMPLIFICATION = 13;

export function initCarte(dataUrl) {
  // La carte est créée APRÈS le chargement de data.geojson (voir la chaîne
  // .then plus bas) : on calcule alors les bounds réelles des marqueurs et on
  // les passe au CONSTRUCTEUR (bounds + fitBoundsOptions) plutôt qu'à un
  // fitBounds() animé après coup. La carte naît donc directement dans la
  // bonne vue :
  //  - aucune animation de zoom au chargement, aucun flash ;
  //  - aucune tuile téléchargée pour un centre/zoom provisoire en dur (gain
  //    réseau direct — c'est l'objectif premier ici) ;
  //  - le centre/zoom en dur [5.03, 44.74] / 12 disparaît.
  // "map" est déclarée ici (let) car toutes les fonctions plus bas
  // (appliquerSimplificationZoom, appliquerAntiCollision, allerVers...)
  // l'utilisent via la closure ; elle est assignée une seule fois dans le
  // .then, juste avant les contrôles/écouteurs qui en dépendent.
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

  const entries = []; // { marker, cat, nom, secteur, cle, recherche, parkingAssocie, nbVoies, nbFaciles, nbGrandeVoie, nbCouenne, tempsGite }
  const index = new Map(); // cle -> entree, pour naviguer vers un marqueur lié
  let labelsSecteurs = []; // [{el, marker, nom}], peuplé une fois le geojson chargé
  let labelsSites = []; // [{el, marker, site}], peuplé une fois le geojson chargé — voir appliquerAntiCollisionSites
  const entriesParSecteur = new Map(); // clé de regroupement secteur -> entrees falaise, pour appliquerAntiCollisionSecteurs
  const entriesParSite = new Map(); // site -> entrees falaise, pour appliquerAntiCollisionSites
  let secteursVisibles = null; // vrai quand les noms de secteur sont affichés (zoom >= ZOOM_LABELS_SECTEUR)
  let sitesVisibles = null; // vrai quand les noms de site sont affichés (zoom < ZOOM_LABELS_SECTEUR) — miroir de secteursVisibles, voir appliquerVisibiliteSites
  let falaisesVisibles = new Set(); // clés des falaises actuellement affichées (couche native) — voir appliquerFiltres
  const etatEstompeParCle = new Map(); // dernier état feature-state "estompe" posé par enSurbrillance, pour ne pas re-poser à l'identique
  // tempsMaxGite/tempsGitePlafond : Infinity tant que le slider n'est pas
  // configuré (pas de falaise sans filtre actif avant que les vraies bornes
  // ne soient connues, voir configurerFiltreTemps) — tempsGitePlafond sert
  // de référence "aucun filtre actif" (voir appliquerFiltres/reinitialiserFiltreTemps),
  // pas de sentinelle séparée à garder synchronisée ailleurs.
  const filtres = { recherche: '', tempsMaxGite: Infinity, tempsGitePlafond: Infinity };
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

  // Ne garde en pleine opacité que les marqueurs de "cles" (estompe les
  // autres) ; cles=null remet tout le monde à l'opacité normale (popup fermée).
  // IMPORTANT : passe par marker.setOpacity(), pas par
  // marker.getElement().style.opacity — MapLibre gère lui-même l'opacité de
  // l'élément (mécanisme prévu pour l'occlusion par le terrain/le globe,
  // this._updateOpacity côté source) et la réapplique à CHAQUE 'move'/'render'
  // à partir de sa propre valeur interne (this._opacity, par défaut '1'),
  // écrasant silencieusement toute écriture directe de style.opacity dès le
  // pan/zoom suivant. setOpacity() met à jour cette valeur interne, donc ses
  // propres mises à jour restent cohérentes avec la nôtre.
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

  // Décollision au pixel générique, partagée entre libellés de secteur et de
  // site (même algorithme, seule la source des libellés/du regroupement
  // change) : pour chaque libellé, dans l'ordre de priorité déjà décidé par
  // l'appelant (nbVoies décroissant, voir construireGeojsonSecteurs/Sites
  // dans labels.js), masque-le si plus aucune falaise de son groupe n'a de
  // figuré ponctuel visible en ce moment (mode "Cercles" vidé, recherche qui
  // l'exclut...), sinon compare son rectangle à l'écran à ceux déjà retenus
  // (visibility, pas display : garde le DOM mesurable sans fausser le calcul
  // suivant) — à conflit, le premier retenu (le plus fourni) gagne.
  // - labels : [{el, marker, ...}], déjà trié par priorité
  // - entriesParGroupe : clé de regroupement -> entrees falaise
  // - cleDe(label) -> clé à chercher dans entriesParGroupe
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popupOuverte) popupOuverte.remove();
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

    const lienSecteur = e.target.closest('.lien-secteur');
    if (lienSecteur) {
      const popupEl = lienSecteur.closest('.popup');
      const origineCle = popupEl ? popupEl.dataset.cle : undefined;
      if (popupOuverte) popupOuverte.remove();
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
    const { max, median, titre, remplissage } = infosLegendePourMode(modeFigureActuel, maxima);
    construireLegendeFalaises(max, median, titre, remplissage, modeSimplifieActuel, maxima.total);
  }

  // Couche native "falaises" (rendu GPU) : un seul canvas au lieu d'un
  // marqueur DOM par falaise — indispensable pour passer à l'échelle quand le
  // geojson atteindra des milliers de falaises (peinture GPU, tri des cercles
  // par taille fait dans la SOURCE via construireSourceFalaises, plus de
  // réordonnancement DOM). Le rendu est data-driven par expressions de zoom :
  //  - rayon : petit point uniforme (7px) sous ZOOM_SIMPLIFICATION, rayon
  //    proportionnel (formule de Flannery, précalculé dans "r") au-delà ;
  //  - couleur : COULEUR_ELOIGNE sous le seuil, couleur du mode "Cercles"
  //    courant au-delà (mise à jour via setPaintProperty, voir
  //    definirModeFigure) ;
  //  - opacité : estompée par feature-state quand une autre falaise a la
  //    popup ouverte (voir enSurbrillance).
  // promoteId: 'cle' -> le feature-state s'indexe sur la clé falaise (stable).
  // Ordre de lecture : la couche est peinte au-dessus du fond ; les marqueurs
  // DOM (parkings, gîte, libellés) passent au-dessus d'elle via le conteneur
  // .maplibregl-marker — les falaises restent donc SOUS les parkings, comme
  // avant.
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
    map.on('click', 'falaises', (e) => {
      const cle = e.features && e.features[0] && e.features[0].properties.cle;
      if (cle) ouvrirFalaise(cle);
    });
  }

  // Ouvre la fiche (popup) d'une falaise de la couche native, au clic ou via
  // la navigation. Ferme d'abord toute popup déjà ouverte (falaise OU
  // parking/gîte) — le comportement miroir de cible.marker.togglePopup() des
  // marqueurs DOM, qui est ici délégué à suivrePopup (tracking dans
  // popupOuverte).
  function ouvrirFalaise(cle) {
    const entree = index.get(cle);
    if (!entree) return;
    if (popupOuverte) popupOuverte.remove();
    definirFalaiseSelectionnee(cle);
    popupOuverte = ouvrirPopupFalaise(map, entree, ctxPopup);
  }

  // Change le mode "Cercles" et redessine tout ce qui en dépend — utilisé
  // par le sélecteur lui-même ET par allerVers (voir plus bas) : naviguer
  // vers une falaise doit garantir qu'elle reste visible, quitte à sortir
  // d'un thème qui l'aurait masquée (voir estFalaiseVideDansMode).
  function definirModeFigure(nouveauMode) {
    modeFigureActuel = nouveauMode;
    if (selectFigure) selectFigure.value = nouveauMode;
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

    // Cause réelle (vérifiée dans le code source de MapLibre) du cadrage qui
    // restait sans effet après une 2e navigation enchaînée (ex. recherche ->
    // falaise, puis tout de suite falaise -> parking) : le padding d'un
    // fitBounds/flyTo PERSISTE sur la carte, et le calcul du cadrage SUIVANT
    // l'ADDITIONNE à son propre padding plutôt que de le remplacer — sur
    // mobile, où margeAvantPopup() est déjà généreux, la somme dépassait la
    // hauteur réelle du conteneur et MapLibre abandonnait le cadrage
    // silencieusement (jamais sur desktop, où même doublé le padding restait
    // sous la hauteur de fenêtre). reinitialiserPadding() repart d'une base à
    // zéro à chaque fois ; map.stop() coupe aussi une éventuelle animation
    // encore en cours, par prudence.
    map.stop();
    reinitialiserPadding(map);

    // Position à l'écran d'une entrée : marqueur DOM (parking/gîte) ou
    // coordonnées directes (falaise en couche native — plus de marqueur).
    const pointDe = (e) => (e.marker ? e.marker.getLngLat() : [e.lon, e.lat]);

    // margeAvantPopup() (pas MARGE_UI) : la popup de la cible s'ouvre juste
    // après ce cadrage (falaise native ou marqueur DOM) — sur mobile, il faut
    // lui laisser sa place.
    if (origine) {
      const bounds = new maplibregl.LngLatBounds();
      bounds.extend(pointDe(origine));
      bounds.extend(pointDe(cible));
      map.fitBounds(bounds, { padding: margeAvantPopup(), maxZoom: 16 });
    } else {
      map.flyTo({ center: pointDe(cible), zoom: Math.max(map.getZoom(), 15), padding: margeAvantPopup() });
    }

    if (cible.cat === 'falaise') {
      ouvrirFalaise(cible.cle);
    } else {
      cible.marker.togglePopup();
    }
    enSurbrillance(origine ? [origine.cle, cible.cle] : [cible.cle]);
  }

  const etatChargement = document.getElementById('etat-chargement');

  fetch(dataUrl)
    .then(r => r.json())
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

      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      // Contrôle "Tout voir" ajouté via l'API de contrôles MapLibre (pas un
      // bouton positionné en absolu à la main) : la carte gère elle-même
      // l'empilement des contrôles partageant un coin, donc pas de collision
      // possible avec NavigationControl au-dessus, quelle que soit sa hauteur
      // réelle (icônes zoom+boussole, variable selon les options).
      map.addControl(creerControleToutVoir(() => {
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

      const parkingInfos = indexerParkingInfos(geojson);
      maxima = calculerMaxima(geojson);
      const tempsDepuisGite = calculerTempsDepuisGite(geojson);
      geojson.features.forEach(f => {
        const entree = addMarker(map, f, parkingInfos, maxima, enSurbrillance, definirFalaiseSelectionnee, suivrePopup, () => ficheReduite, (id) => baseRoutes + id + '.json');
        entries.push(entree);
        index.set(entree.cle, entree);
        if (entree.cat === 'falaise') {
          entree.tempsGite = tempsDepuisGite.get(entree.cle) ?? null;

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
      // Couche native "falaises" : construite une fois (source + couche), puis
      // alimentée par construireSourceFalaises — features triées par valeur
      // décroissante (ordre de peinture, le plus petit dessus), mode "aucun"
      // donc nbVoies total au départ. Voir construireCoucheFalaises.
      // MapLibre exige le STYLE chargé avant addSource/addLayer : on attend
      // 'load' quand il ne l'est pas encore (cas normal, le style met plus de
      // temps que le fetch du geojson préchargé). La source est ajoutée vide
      // puis remplie, le FILTRE est re-posé dans la foulée par
      // appliquerFiltresEtSecteurs() — même tick, aucun flash de points non
      // filtrés. Cas inverse (style déjà chargé : data.geojson lent), on
      // construit directement.
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
    })
    .catch(err => {
      console.error('Erreur de chargement des données', err);
      if (etatChargement) {
        etatChargement.textContent = 'Impossible de charger les données de la sortie.';
        etatChargement.classList.add('erreur');
      }
    });

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
    // Sur mobile, le champ de recherche a encore le focus (clavier affiché)
    // au moment de ce clic : le PROCHAIN tap ailleurs sur l'écran sert
    // souvent à fermer le clavier plutôt qu'à activer sa cible réelle (bug
    // constaté précisément dans ce cas : falaise trouvée par recherche, puis
    // tap sur "voir sur la carte" pour son parking sans effet — le même
    // enchaînement depuis un clic direct sur la falaise, sans recherche,
    // fonctionnait). Fermer le clavier ICI, dès qu'on quitte la recherche,
    // pour que le prochain tap arrive bien sur sa cible.
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
      // Le texte porte l'état (repli/déploiement) — pas d'icône/chevron,
      // cohérent avec le reste du site (contrôles en texte mono sobre).
      legendeToggle.textContent = vaOuvrir ? 'Masquer' : 'Légende';
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

  // NOTE portée : cette fonction est déplacée ICI, dans initCarte — depuis
  // la couche native elle utilise map et falaisesVisibles via la closure
  // (elle ne peut plus rester au niveau module, comme avant).
  function appliquerFiltres(entries, filtres, mode, falaiseSelectionneeCle) {
  // Le mode "Cercles" ET le filtre "Depuis le gîte" masquent des falaises
  // (estFalaiseVideDansMode / seuil de temps) mais n'autorisent PAS à eux
  // seuls l'affichage de leurs parkings — sinon déplacer le slider ou
  // changer de thème réafficherait potentiellement des dizaines de parkings
  // d'un coup (l'un comme l'autre peuvent laisser beaucoup de falaises
  // visibles à la fois, contrairement à une recherche, quasi toujours
  // ciblée sur une poignée de résultats). Deux déclencheurs positifs
  // autorisent des parkings :
  // - une recherche active (choix explicite ET ciblé) -> tous les parkings
  //   des falaises qui la passent ;
  // - la falaise sélectionnée (popup ouverte / cible d'une navigation), si
  //   elle reste effectivement visible sous le mode/la recherche/le temps
  //   courants.
  const parkingsAutorises = new Set();

  // Falaises (couche native) : pas de display DOM — on pose le FILTRE de la
  // couche (rendu GPU, expressions sur les properties de la source) et on
  // miroite le résultat dans falaisesVisibles pour entreeVisible (anti-
  // collision des libellés) sans relire le DOM. 'index-of' vaut -1 quand la
  // recherche est absente, donc >= 0 = présente. tempsGite null -> coalesce
  // 0 : une falaise sans trajet calculé n'est jamais exclue par le slider.
  // L'exclusion liée au MODE (estFalaiseVideDansMode) est, elle, faite dans
  // la SOURCE (construireSourceFalaises) et non ici.
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

  // Masqués par défaut : visibles seulement si une recherche est active ou
  // si une falaise est sélectionnée.
  const montrerParkings = Boolean(filtres.recherche) || Boolean(falaiseSelectionneeCle);

  entries.forEach((entree) => {
    if (entree.cat !== 'parking') return;
    entree.marker.getElement().style.display = (montrerParkings && parkingsAutorises.has(entree.nom)) ? '' : 'none';
  });
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
