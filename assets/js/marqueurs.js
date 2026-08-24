// marqueurs.js — création des marqueurs MapLibre (falaise/parking/gîte) :
// DOM, accessibilité, popup attachée, gestion d'ouverture/fermeture.

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs';
import { cleFalaise, libelleFalaise, secteurDistinct } from './donnees.js';
import { poserTailleMarqueur } from './symboles.js';
import { popupFalaise, popupParking, popupGite, construireHistogramme } from './popups.js';

// Détail des voies (routes/<id>.json, généré par DuckDB) chargé à la demande
// à l'ouverture de la popup : mis en cache en mémoire pour les réouvertures,
// et pris en charge par le service worker pour l'offline après une 1ère vue.
const cacheVoiesParFalaise = new Map();

// Met à jour l'état visuel/accessible de la poignée (aria-expanded,
// aria-label, texte Réduire/Agrandir) à partir d'un booléen "réduit" —
// factorisé ici pour éviter la duplication entre la synchronisation à
// l'ouverture d'une popup (plus bas, popup.on('open', ...)) et le clic
// utilisateur sur la poignée elle-même (écouteur délégué de carte.js) :
// même logique, deux déclencheurs différents.
export function synchroniserPoignee(poignee, reduire) {
  poignee.setAttribute('aria-expanded', String(!reduire));
  const texte = reduire ? 'Agrandir' : 'Réduire';
  poignee.setAttribute('aria-label', texte + ' la fiche');
  const spanTexte = poignee.querySelector('.poignee-texte');
  if (spanTexte) spanTexte.textContent = texte;
}

export function addMarker(map, feature, parkingInfos, maxima, enSurbrillance, onSelectionFalaise, suivrePopup, estFicheReduite, urlRoute) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const cat = p.categorie;
  const cle = cat === 'falaise' ? cleFalaise(p) : p.nom;
  const parkingAssocie = cat === 'falaise' ? (p.parking_associe || []) : [];

  if (cat === 'falaise') {
    // Falaises : rendu en COUCHE NATIVE (source "falaises", voir carte.js) —
    // pas de marqueur DOM ni de popup attachée. La popup est ouverte à la
    // demande (clic sur la couche, navigation), voir ouvrirPopupFalaise. On
    // garde compteurs/libellés pour la recherche, les filtres, l'anti-
    // collision des libellés et le lazy-load des voies.
    return {
      cat, cle, nom: p.nom, secteur: secteurDistinct(p), lon, lat,
      parkingAssocie, p,
      recherche: libelleFalaise(p).toLowerCase(),
      nbVoies: p.nb_voie_total ?? 0,
      nbFaciles: p.nb_faciles ?? 0,
      nbGrandeVoie: p.nb_gv ?? 0,
      nbCouenne: p.nb_couenne ?? 0,
    };
  }

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

  if (cat === 'hebergement') {
    poserTailleMarqueur(el, visuel, 16);
    visuel.style.background = 'var(--ink)';
    visuel.style.transform = 'rotate(45deg)'; // losange : se distingue des ronds falaise/parking
  } else if (cat === 'parking') {
    // Carré (pas un rond) : la catégorie falaise/parking/gîte est une
    // variable nominale, codée par la FORME (Bertin) — la couleur seule
    // (teal) ne suffisait pas, d'autant qu'elle change déjà de sens sur les
    // falaises selon le mode "Cercles" actif, donc pas un repère stable.
    // "P" à l'intérieur (pas un simple carré uni) : un carré tout court
    // aurait pu se confondre, dans le modèle mental de l'utilisateur, avec
    // les carrés de l'histogramme de voies (popup falaise, "1 carré = 1
    // voie") — une signification totalement différente sous la même forme.
    // Le "P" lève l'ambiguïté ET reste cohérent avec "texte plutôt
    // qu'icône" (aucun pictogramme nulle part sur ce site) : une lettre est
    // un texte, pas une icône.
    poserTailleMarqueur(el, visuel, 22);
    visuel.style.borderRadius = 'var(--radius)';
    visuel.style.background = 'var(--teal)';
    visuel.textContent = 'P';
  }
  // NOTE : pas de branche "falaise" ici — les falaises sont rendues en couche
  // native MapLibre (voir le retour anticipé de addMarker, plus haut) ; à ce
  // stade cat n'est plus que "parking" ou "hebergement".

  const popupHtml =
    cat === 'falaise' ? popupFalaise(p, lat, lon, cle) :
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
      // Coupe la transition (max-height, prévue pour l'animation d'un VRAI
      // clic sur la poignée) le temps d'appliquer l'état de départ : sans
      // ça, une popup qui s'ouvre déjà réduite passait quand même par
      // l'animation, ce qui donnait l'impression qu'elle s'ouvrait dépliée
      // puis se repliait toute seule. Le forçage de reflow (lecture
      // d'offsetHeight) entre les deux garantit que le navigateur applique
      // bien "transition: none" AVANT le changement de classe, pas après.
      contenuOuverture.style.transition = 'none';
      contenuOuverture.classList.toggle('fiche-reduite', reduire);
      contenuOuverture.offsetHeight;
      contenuOuverture.style.transition = '';
      if (poigneeOuverture) synchroniserPoignee(poigneeOuverture, reduire);
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

    // Détail des voies chargé à la demande (routes/<id>.json, généré par
    // DuckDB) : le fichier web principal ne contient plus voies_sportives —
    // on ne télécharge le détail d'une falaise que si on ouvre sa fiche, une
    // seule fois (relu ensuite dans cacheVoiesParFalaise).
    const placeholder = elPopupOuverture && elPopupOuverture.querySelector('[data-route]');
    if (placeholder && urlRoute) {
      const id = placeholder.dataset.route;
      if (cacheVoiesParFalaise.has(id)) {
        placeholder.innerHTML = cacheVoiesParFalaise.get(id);
      } else {
        fetch(urlRoute(id))
          .then(r => r.json())
          .then(data => {
            const html = construireHistogramme(data.voies_sportives || []);
            cacheVoiesParFalaise.set(id, html);
            // La popup peut avoir été refermée ou réutilisée entre-temps :
            // on n'écrit que si ce placeholder est toujours dans le DOM.
            if (placeholder.isConnected) placeholder.innerHTML = html;
          })
          .catch(() => {
            if (placeholder.isConnected) placeholder.remove();
          });
      }
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

  // Compteurs précalculés à la génération (voir export_geojson.py) — plus de
  // scan du détail des voies côté client (elles ne sont plus dans le fichier
  // principal, chargées à la demande dans la popup).
  // Ici, cat est forcément "parking" ou "hebergement" (les falaises sont
  // rendues en couche native — voir le retour anticipé plus haut).
  const entree = {
    marker, cat, nom: p.nom, secteur: null, cle, recherche: p.nom.toLowerCase(),
    parkingAssocie,
    nbVoies: p.nb_voie_total ?? 0,
    nbFaciles: 0, nbGrandeVoie: 0, nbCouenne: 0,
  };

  return entree;
}

// Ouvre la popup d'une falaise (couche native) au clic/navigation. Reprend
// exactement le comportement de l'ancienne popup attachée au marqueur DOM :
// sélection + surbrillance (falaise <-> parkings), synchronisation de la
// fiche repliée/dépliée, lazy-load du détail des voies (routes/<id>.json).
export function ouvrirPopupFalaise(map, entree, ctx) {
  const { enSurbrillance, onSelectionFalaise, suivrePopup, estFicheReduite, urlRoute } = ctx;
  const popup = new maplibregl.Popup({ offset: 14 })
    .setLngLat([entree.lon, entree.lat])
    .setHTML(popupFalaise(entree.p, entree.lat, entree.lon, entree.cle));

  // ATTENTION : les listeners 'open'/'close' doivent être posés AVANT
  // addTo(map) — MapLibre déclenche 'open' de façon synchrone à la fin
  // d'addTo ; les poser après ferait rater l'événement (pas de surbrillance,
  // pas de lazy-load des voies, pas de suivi de popup).
  popup.on('open', () => {
    if (suivrePopup) suivrePopup(popup, true);
    document.body.classList.add('fiche-ouverte');
    const elPopup = popup.getElement();
    const contenu = elPopup && elPopup.querySelector('.maplibregl-popup-content');
    const poignee = elPopup && elPopup.querySelector('.poignee-fiche');
    if (contenu) {
      const reduire = Boolean(estFicheReduite && estFicheReduite());
      contenu.style.transition = 'none';
      contenu.classList.toggle('fiche-reduite', reduire);
      contenu.offsetHeight;
      contenu.style.transition = '';
      if (poignee) synchroniserPoignee(poignee, reduire);
    }
    if (onSelectionFalaise) onSelectionFalaise(entree.cle);
    enSurbrillance([entree.cle, ...entree.parkingAssocie]);

    // Détail des voies chargé à la demande (voir la version marqueur DOM).
    const placeholder = elPopup && elPopup.querySelector('[data-route]');
    if (placeholder && urlRoute) {
      const id = placeholder.dataset.route;
      if (cacheVoiesParFalaise.has(id)) {
        placeholder.innerHTML = cacheVoiesParFalaise.get(id);
      } else {
        fetch(urlRoute(id))
          .then(r => r.json())
          .then(data => {
            const html = construireHistogramme(data.voies_sportives || []);
            cacheVoiesParFalaise.set(id, html);
            if (placeholder.isConnected) placeholder.innerHTML = html;
          })
          .catch(() => { if (placeholder.isConnected) placeholder.remove(); });
      }
    }
  });
  popup.on('close', () => {
    const popupActive = suivrePopup ? suivrePopup(popup, false) : null;
    if (!popupActive) {
      document.body.classList.remove('fiche-ouverte');
      enSurbrillance(null);
    }
  });

  popup.addTo(map);
  return popup;
}
