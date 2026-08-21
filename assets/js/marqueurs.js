// marqueurs.js — création des marqueurs MapLibre (falaise/parking/gîte) :
// DOM, accessibilité, popup attachée, gestion d'ouverture/fermeture.

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs';
import { cleFalaise, libelleFalaise, secteurDistinct } from './donnees.js';
import { poserTailleMarqueur, dessinerFalaise } from './symboles.js';
import { popupFalaise, popupParking, popupGite } from './popups.js';

export function addMarker(map, feature, parkingInfos, maxima, enSurbrillance, onSelectionFalaise, suivrePopup, bornesCotationParSite, estFicheReduite) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const cat = p.categorie;
  const cle = cat === 'falaise' ? cleFalaise(p) : p.nom;
  const parkingAssocie = cat === 'falaise'
    ? (p.parking_associe || '').split('|').map(s => s.trim()).filter(Boolean)
    : [];

  // "el" est la zone tactile (taille garantie par poserTailleMarqueur, voir
  // plus bas) — MapLibre réécrit intégralement son style.transform à chaque
  // repositionnement, donc AUCUN style visuel dépendant d'un transform (la
  // rotation du losange gîte) ne doit vivre ici, seulement sur "visuel".
  const el = document.createElement('div');
  el.className = 'marqueur marqueur-' + cat;

  // Accessibilité : un <div> seul n'est ni focusable ni annoncé par un
  // lecteur d'écran — sans ça les marqueurs ne sont atteignables qu'à la
  // souris/au doigt.
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  const etiquette = cat === 'falaise' ? `Falaise : ${libelleFalaise(p)}`
    : cat === 'parking' ? `Parking : ${p.nom}`
    : `Gîte : ${p.nom}`;
  el.setAttribute('aria-label', etiquette);

  const visuel = document.createElement('div');
  visuel.className = 'marqueur-visuel';
  el.appendChild(visuel);

  if (cat === 'hébergement') {
    poserTailleMarqueur(el, visuel, 16);
    visuel.style.background = 'var(--ink)';
    visuel.style.transform = 'rotate(45deg)'; // losange : se distingue des ronds falaise/parking
  } else if (cat === 'parking') {
    poserTailleMarqueur(el, visuel, 22);
    visuel.style.borderRadius = '50%';
    visuel.style.background = 'var(--teal)';
  } else {
    visuel.style.borderRadius = '50%'; // taille + couleur posées par dessinerFalaise() ci-dessous
  }

  const popupHtml =
    cat === 'falaise' ? popupFalaise(p, lat, lon, cle, bornesCotationParSite.get(p.site)) :
    cat === 'parking' ? popupParking(p, lat, lon, parkingInfos, cle) :
    popupGite(p, lat, lon, cle);

  // closeOnClick (par défaut, true) : ferme la popup ouverte au clic
  // ailleurs sur la carte, y compris sur un autre marqueur — comportement
  // volontairement gardé (voir suivrePopup plus bas pour Échap) : la
  // fermeture ne touche plus falaiseSelectionneeCle, donc plus de risque de
  // masquer par erreur le parking qu'on vient de rejoindre.
  const popup = new maplibregl.Popup({ offset: 14 }).setHTML(popupHtml);

  const marker = new maplibregl.Marker({ element: el })
    .setLngLat([lon, lat])
    .setPopup(popup)
    .addTo(map);

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      marker.togglePopup();
    }
  });

  popup.on('open', () => {
    if (suivrePopup) suivrePopup(popup, true);
    document.body.classList.add('fiche-ouverte');
    // Synchronise CETTE popup sur l'état replié/déplié partagé (voir
    // ficheReduite dans carte.js) : une fiche réduite pour voir plus de carte
    // doit le rester en passant à une autre falaise/parking, jusqu'à ce que
    // l'utilisateur la rouvre lui-même. classList.toggle(classe, force) plutôt
    // qu'un simple add/remove conditionnel : le conteneur DOM de CE marqueur
    // (réutilisé à chaque réouverture) peut porter un état périmé d'une fois
    // précédente où il avait lui-même été réduit.
    const elPopupOuverture = popup.getElement();
    const contenuOuverture = elPopupOuverture && elPopupOuverture.querySelector('.maplibregl-popup-content');
    const poigneeOuverture = elPopupOuverture && elPopupOuverture.querySelector('.poignee-fiche');
    if (contenuOuverture) {
      const reduire = Boolean(estFicheReduite && estFicheReduite());
      contenuOuverture.classList.toggle('fiche-reduite', reduire);
      if (poigneeOuverture) {
        poigneeOuverture.setAttribute('aria-expanded', String(!reduire));
        const texteOuverture = reduire ? 'Agrandir' : 'Réduire';
        poigneeOuverture.setAttribute('aria-label', texteOuverture + ' la fiche');
        const spanTexteOuverture = poigneeOuverture.querySelector('.poignee-texte');
        if (spanTexteOuverture) spanTexteOuverture.textContent = texteOuverture;
      }
    }
    // Actions du contenu (poignée, copier, lien secteur) : gérées par un
    // écouteur délégué unique posé dans initCarte (voir document.addEventListener
    // 'click' plus bas) — pas de ré-attachement ici, insensible à un éventuel
    // nœud DOM périmé après un déplacement de la carte.
    // La mise en surbrillance suit la relation falaise<->parking dans les
    // deux sens : sélectionner l'un éclaire l'autre, cohérent et symétrique.
    if (cat === 'falaise') {
      if (onSelectionFalaise) onSelectionFalaise(cle);
      enSurbrillance([cle, ...parkingAssocie]);
    } else if (cat === 'parking') {
      const info = parkingInfos.get(p.nom);
      enSurbrillance([cle, ...(info ? info.falaises.map(f => f.cle) : [])]);
    } else {
      enSurbrillance([cle]);
    }
  });
  popup.on('close', () => {
    // Fermeture potentiellement "périmée" : si une AUTRE popup s'est déjà
    // ouverte entre-temps (closeOnClick ferme celle-ci après coup), ne pas
    // écraser l'opacité/la surbrillance qu'elle vient de poser (bug observé :
    // clic falaise puis clic parking, tous les marqueurs repassaient à 100%).
    const popupActive = suivrePopup ? suivrePopup(popup, false) : null;
    if (!popupActive) {
      document.body.classList.remove('fiche-ouverte');
      enSurbrillance(null);
    }
    // La sélection (falaiseSelectionneeCle) n'est PAS effacée ici : fermer
    // une fiche (× ou clic sur un autre marqueur) garde le parking associé
    // à la dernière falaise choisie visible, plutôt que de tout re-masquer
    // aussitôt. Seuls "Tout voir" ou le choix d'une NOUVELLE falaise (voir
    // onSelectionFalaise à l'ouverture) réinitialisent la sélection.
    // L'état replié/déplié n'est PLUS réinitialisé ici (voir estFicheReduite
    // à l'ouverture, plus haut) : il est désormais partagé entre toutes les
    // popups et doit au contraire survivre à cette fermeture.
  });

  const cot5 = p.nb_voies_cot5 ?? 0;
  const cot6a = p.nb_voies_cot6a ?? 0;
  const secteur = cat === 'falaise' ? secteurDistinct(p) : null;
  const rechercheTexte = cat === 'falaise' ? libelleFalaise(p).toLowerCase() : p.nom.toLowerCase();

  const entree = {
    marker, cat, nom: p.nom, secteur, cle, recherche: rechercheTexte,
    parkingAssocie,
    nbVoies: p.nb_voies ?? 0,
    nbFaciles: cot5 + cot6a,
    nbGrandeVoie: p.nb_gv ?? 0,
    nbCouenne: p.nb_couenne ?? 0,
  };

  if (cat === 'falaise') dessinerFalaise(entree, 'aucun', maxima);

  return entree;
}
