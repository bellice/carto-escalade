/* carte.js — point d'entrée : orchestration de la carte pour une page sortie.
   Chaque page sortie importe initCarte(dataUrl) et l'appelle avec le chemin
   vers son propre data.geojson. */

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs';
import {
  calculerMaxima, calculerTempsDepuisGite, indexerParkingInfos, indexerSources,
} from './donnees.js';
import { ZOOM_SIMPLIFICATION, ZOOM_VUE_ENSEMBLE_MAX, etat } from './etat.js';
import { addMarker, cablerFermetureManuellePanneau } from './marqueurs.js';
import {
  appliquerFiltresEtSecteurs, appliquerVisibiliteParkings, definirFalaiseSelectionnee, enSurbrillance,
} from './visibilite.js';
import {
  ajouterLabelsDeSecteur, ajouterLabelsDeSite, cablerClicCarte, cablerNavigation, centrerSurRecherche, ctxPanneau, ouvrirLienProfond, suivrePopup,
} from './navigation.js';
import {
  creerControleToutVoir, limiterZoneCarte, margeToutVoir, reinitialiserPadding,
} from './carte-utils.js';
import {
  cablerBasculeMobile, cablerRecherche, cablerRepliFiltres, reinitialiserRecherche, remplirAutocompletion,
} from './panneau-lateral.js';
import {
  appliquerSimplificationZoom, construireCoucheFalaises, redessinerSource,
} from './couche-falaises.js';
import { monterPreparationHorsLigne } from './hors-ligne.js';
import {
  ajusterLegendeAuxDonnees, cablerFiltres, configurerFiltreEnsoleillement, configurerFiltreStyle, configurerFiltreTemps, configurerReinitialisationFiltres, preparerFourchette,
} from './filtres.js';

const btnReinitialiserFiltres = document.getElementById('reinitialiser-filtres');
const etatChargement = document.getElementById('etat-chargement');

function construireEntrees(geojson) {
  const parkingInfos = indexerParkingInfos(geojson);
  etat.maxima = calculerMaxima(geojson);
  const tempsDepuisGite = calculerTempsDepuisGite(geojson);
  const sourcesIndex = indexerSources(geojson);
  geojson.features.forEach(f => {
    const entree = addMarker(etat.map, f, parkingInfos, etat.maxima, enSurbrillance, definirFalaiseSelectionnee, suivrePopup, () => etat.ficheReduite, (id) => etat.baseRoutes + id + '.json');
    etat.entries.push(entree);
    etat.index.set(entree.cle, entree);
    if (entree.cat !== 'falaise') return;

    entree.tempsGite = tempsDepuisGite.get(entree.cle) ?? null;
    // Résolu une fois ici (topo_id -> {nom, url}) plutôt que dans
    // popups.js : ce module ne connaît que p (voir son en-tête, "chaque
    // fonction ne dépend que de ses paramètres") — pas d'accès à
    // geojson.sources depuis là-bas.
    const topo = entree.p.topo_id ? sourcesIndex.get(entree.p.topo_id) : null;
    // trim() : au moins un nom de source.csv porte un espace de fin (saisie
    // manuelle).
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
    if (!etat.entriesParSecteur.has(cleSecteur)) etat.entriesParSecteur.set(cleSecteur, []);
    etat.entriesParSecteur.get(cleSecteur).push(entree);

    const site = f.properties.site;
    if (site) {
      if (!etat.entriesParSite.has(site)) etat.entriesParSite.set(site, []);
      etat.entriesParSite.get(site).push(entree);
    }
  });
  return tempsDepuisGite;
}

// La carte est créée AVEC ses bounds réelles (calculées juste avant) plutôt
// qu'avec un fitBounds animé après coup : elle naît dans la bonne vue, sans
// animation ni tuiles téléchargées pour un centre provisoire. C'est
// possible parce que data.geojson est préchargé (<link rel="preload">) et
// que son fetch est plus court que le parse de maplibre-gl.mjs.
function creerCarte(geojson) {
  etat.borneGlobale = new maplibregl.LngLatBounds();
  geojson.features.forEach(f => etat.borneGlobale.extend(f.geometry.coordinates));
  etat.map = new maplibregl.Map({
    container: 'map',
    // "positron" (fond neutre, peu de POI/labels) plutôt que "liberty"
    // (style généraliste chargé) : le fond doit rester discret pour que
    // les marqueurs falaise/parking/gîte restent la figure dominante
    // (principe figure-fond) — et un style plus simple charge/peint
    // aussi plus vite.
    style: 'https://tiles.openfreemap.org/styles/positron',
    bounds: etat.borneGlobale,
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
  limiterZoneCarte(etat.map, ZOOM_SIMPLIFICATION - 1);
  // Câble le bouton fermer (×) du panneau falaise desktop — sans effet
  // sur mobile, le panneau reste display:none hors media query.
  cablerFermetureManuellePanneau(etat.map, ctxPanneau);

  etat.map.addControl(new maplibregl.NavigationControl(), 'top-right');
  etat.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  // Contrôle "Tout voir" ajouté via l'API de contrôles MapLibre (pas un
  // bouton positionné en absolu à la main) : la carte gère elle-même
  // l'empilement des contrôles partageant un coin, donc pas de collision
  // possible avec NavigationControl au-dessus, quelle que soit sa hauteur
  // réelle (icônes zoom+boussole, variable selon les options).
  etat.map.addControl(creerControleToutVoir(() => {
    // « Tout voir » vide la sélection juste en dessous : la fiche doit
    // suivre, sinon le panneau resterait affiché avec un contenu périmé,
    // en contradiction avec « panneau ouvert <=> falaise sélectionnée ».
    if (etat.popupOuverte) etat.popupOuverte.remove();
    reinitialiserPadding(etat.map);
    // Même plafond que le cadrage initial (voir ce commentaire) : "Tout
    // voir" doit revenir à la même vue qu'à l'arrivée, pas à une vue plus
    // zoomée qui réintroduirait le chevauchement des cercles.
    if (etat.borneGlobale) etat.map.fitBounds(etat.borneGlobale, { padding: margeToutVoir(), maxZoom: ZOOM_VUE_ENSEMBLE_MAX });
    // « Tout voir » est un contrôle de caméra : il efface ce qui relève de la
    // navigation (sélection, recherche) mais laisse les filtres (Type de voie,
    // Cotation, Ensoleillement, Trajet depuis le gîte), qui sont des choix
    // explicites. Avec un filtre actif, la vue d'ensemble peut ne montrer que
    // quelques secteurs : c'est l'effet du filtre, « Réinitialiser » l'efface.
    etat.falaiseSelectionneeCle = null;
    reinitialiserRecherche();
    appliquerFiltresEtSecteurs();
  }), 'top-right');

  // Le contrôle d'attribution démarre parfois "déplié" (classe posée
  // avant que notre config compact ne s'applique pleinement) — on force
  // l'état replié une fois la carte chargée, sans empêcher l'utilisateur
  // de le rouvrir ensuite.
  etat.map.on('load', () => {
    const attrib = document.querySelector('.maplibregl-ctrl-attrib');
    if (attrib) attrib.classList.remove('maplibregl-compact-show');
  });
  etat.map.on('zoom', appliquerSimplificationZoom);
  // L'affichage des parkings dépend aussi du zoom (voir
  // appliquerVisibiliteParkings) — rafraîchi à chaque zoom, sans repasser
  // par appliquerFiltres.
  etat.map.on('zoom', appliquerVisibiliteParkings);
}

// MapLibre exige le style chargé avant addSource/addLayer : on attend 'load'
// s'il ne l'est pas. La source est ajoutée vide puis remplie, le filtre re-posé
// dans le même tick : aucun flash de points non filtrés.
function afficherCoucheFalaises() {
  const poser = () => {
    construireCoucheFalaises();
    cablerClicCarte();
    redessinerSource();
  };
  if (etat.map.isStyleLoaded()) {
    poser();
  } else {
    etat.map.once('load', () => {
      poser();
      appliquerFiltresEtSecteurs();
    });
  }
}

// « Préparer » : monté seulement ici, une fois connus les points réels de
// la sortie (falaises + parkings + gîte) — ce sont eux qui déterminent les
// tuiles à télécharger. Idempotent : ne fait rien si le bloc existe déjà
// (rechargement après un "Réessayer").
function monterHorsLigne(geojson) {
  const hote = document.getElementById('preparation-hors-ligne');
  if (!hote || hote.querySelector('.btn-preparer')) return;
  monterPreparationHorsLigne({
    map: etat.map,
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
  return fetch(etat.dataUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} sur ${etat.dataUrl}`);
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
      configurerFiltreStyle();
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

function cablerBandeauReseau() {
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
  // règle (voir assets/css/) : l'élément s'y positionne contre le
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
}

export function initCarte(dataUrl) {
  etat.dataUrl = dataUrl;
  // Détail des voies : routes/<id>.json, à côté du data.geojson du lieu.
  etat.baseRoutes = dataUrl.slice(0, dataUrl.lastIndexOf('/') + 1) + 'routes/';
  // Lue une fois : MapLibre n'accepte pas var() dans toutes ses expressions.
  etat.couleurEloigne = getComputedStyle(document.documentElement).getPropertyValue('--clay').trim() || '#a8452f';

  cablerNavigation();
  cablerFiltres();
  cablerRecherche(centrerSurRecherche);
  cablerRepliFiltres();
  cablerBasculeMobile();
  cablerBandeauReseau();
  chargerDonnees();
}
