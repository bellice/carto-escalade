// couche-falaises.js — couche native des falaises (cercles proportionnels) :
// construction, couleur, source, légende et simplification au zoom.

import { ZOOM_SIMPLIFICATION, etat } from './etat.js';
import {
  construireLegendeFalaises, construireSourceFalaises, couleurFalaisePourMode, infosLegendePourMode,
} from './symboles.js';

// Simplifie TOUS les marqueurs en petit point uniforme sous
// ZOOM_SIMPLIFICATION (vue d'ensemble) : à cette échelle, les cercles
// proportionnels se chevauchent trop entre eux pour rester lisibles
// (certains sommets ont leurs secteurs à quelques dizaines de mètres les
// uns des autres). Les parkings/gîte suivent la même règle — un parking à
// 22px à côté de falaises réduites à 7px jurerait visuellement, même si
// eux n'ont pas de recouvrement à résoudre en soi. Restaurés dès qu'on
// zoome sur un site — cf. .zoom-eloigne dans le CSS.
export function appliquerSimplificationZoom() {
  const simplifie = etat.map.getZoom() < ZOOM_SIMPLIFICATION;
  if (simplifie === etat.modeSimplifieActuel) return;
  etat.modeSimplifieActuel = simplifie;
  // Falaises : la réduction à un petit point uniforme est portée par des
  // expressions de zoom dans la couche native (voir construireCoucheFalaises)
  // — on ne touche ici qu'aux marqueurs DOM restants (parkings, gîte).
  etat.entries.forEach((entree) => {
    if (entree.cat === 'falaise' || !entree.marker) return;
    entree.marker.getElement().classList.toggle('zoom-eloigne', simplifie);
  });
  rafraichirLegendeFalaises();
}

// Reconstruit la mini-légende falaises selon le mode "Cercles" courant, le
// bouton "Épurer" ET l'état de simplification par zoom — sinon la légende
// continuerait de montrer des cercles de référence à une échelle où seuls
// des points uniformes sont réellement affichés (trompeur).
// Deux raisons distinctes de n'avoir aucune taille à légender, jamais
// confondues : "épurée" prime sur le zoom (un choix explicite, avec un
// message qui ne dit pas "zoomez" — dézoomer n'y changerait rien).
export function rafraichirLegendeFalaises() {
  const { max, median, remplissage } = infosLegendePourMode(etat.modeFigureActuel, etat.entries, etat.filtres.pratique);
  const raisonSansTaille = etat.epureeActuelle ? 'epuree' : etat.modeSimplifieActuel ? 'zoom' : null;
  construireLegendeFalaises(max, median, remplissage, raisonSansTaille, etat.maxima.total);
}

// Couche native (rendu GPU) plutôt qu'un marqueur DOM par falaise : passe à
// l'échelle quand le geojson atteindra des milliers d'entrées, et le tri des
// cercles par taille se fait dans la SOURCE, sans réordonnancement DOM.
// promoteId: 'cle' — le feature-state s'indexe sur la clé falaise, stable.
// Les marqueurs DOM (parkings, gîte, libellés) passent au-dessus de cette
// couche : les falaises restent SOUS les parkings.
export function construireCoucheFalaises() {
  etat.map.addSource('falaises', {
    type: 'geojson',
    promoteId: 'cle',
    data: { type: 'FeatureCollection', features: [] },
  });
  etat.map.addLayer({
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
  etat.map.on('mouseenter', 'falaises', () => { etat.map.getCanvas().style.cursor = 'pointer'; });
  etat.map.on('mouseleave', 'falaises', () => { etat.map.getCanvas().style.cursor = ''; });
}

// Couleur de la couche "falaises" : COULEUR_ELOIGNE (vue lointaine) OU
// teinte du mode — sauf "Épurer" enclenché, qui impose COULEUR_ELOIGNE
// aussi zoomé. Factorisé : deux déclencheurs distincts (mode, épuré).
function expressionCouleurCercles() {
  const couleur = etat.epureeActuelle ? etat.couleurEloigne : couleurFalaisePourMode(etat.modeFigureActuel);
  return ['step', ['zoom'], etat.couleurEloigne, ZOOM_SIMPLIFICATION, couleur];
}

// Reconstruit la source des cercles depuis l'état courant (mode, pratique,
// fourchette de cotation, vue épurée).
export function redessinerSource() {
  const source = etat.map.getSource('falaises');
  if (!source) return;
  source.setData(construireSourceFalaises(etat.entries, etat.modeFigureActuel, etat.maxima, etat.epureeActuelle, etat.filtres.pratique));
}

export function majCouleurCercles() {
  if (!etat.map.getLayer('falaises')) return;
  etat.map.setPaintProperty('falaises', 'circle-color', expressionCouleurCercles());
}
