// marqueurs.js — création des marqueurs MapLibre (falaise/parking/gîte) :
// DOM, accessibilité, popup attachée, gestion d'ouverture/fermeture.

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs';
import { cleFalaise, libelleFalaise, secteurDistinct } from './donnees.js';
import { poserTailleMarqueur } from './symboles.js';
import { popupFalaise, popupParking, popupGite, construireHistogramme, construireDetailVoies } from './popups.js';
import { reinitialiserPadding, margeAvantPopup, estPointVisible } from './carte-utils.js';

// Détail des voies (routes/<slug-site>.json, généré par DuckDB, un fichier
// par SITE — plusieurs falaises/secteurs dedans, indexées par id_falaise)
// chargé à la demande à l'ouverture de la popup : mis en cache en mémoire
// pour les réouvertures, et pris en charge par le service worker pour
// l'offline après une 1ère vue.
// id_falaise -> tableau BRUT voies_sportives (PAS du HTML pré-rendu) :
// l'histogramme (construireHistogramme) ET le détail des voies
// (construireDetailVoies) partagent la même donnée — cacher du HTML aurait
// figé le premier des deux rendus à avoir été demandé.
const cacheVoiesParFalaise = new Map();
const cacheSitesRoutes = new Map(); // slug-site -> Promise<JSON du site>

// Un seul fetch par SITE, dédupliqué via un cache de PROMESSES (pas juste de
// valeurs résolues) : ouvrir 2 falaises du même site coup sur coup, avant que
// le 1er fetch n'ait répondu, ne déclenche pas 2 requêtes.
function chargerJsonSite(siteId, urlRoute) {
  if (!cacheSitesRoutes.has(siteId)) {
    cacheSitesRoutes.set(siteId, fetch(urlRoute(siteId)).then(r => r.json()));
  }
  return cacheSitesRoutes.get(siteId);
}

// Charge (une seule fois par falaise, relu ensuite dans cacheVoiesParFalaise)
// le détail des voies dans le placeholder [data-route] trouvé sous racineEl,
// et l'injecte sous forme d'histogramme — factorisé ici : avant, cette même
// logique était dupliquée entre addMarker (popup parking/gîte — où elle
// n'avait plus aucun effet, [data-route] n'existe QUE dans popupFalaise) et
// ouvrirPopupFalaise. Un 3e appelant (ouvrirPanneauFalaise, panneau desktop)
// la réutilise telle quelle plutôt que d'en copier une 3e version.
function chargerDetailVoies(racineEl, urlRoute) {
  const placeholder = racineEl && racineEl.querySelector('[data-route]');
  if (!placeholder || !urlRoute) return;
  const siteId = placeholder.dataset.route;
  const falaiseId = placeholder.dataset.routeFalaise;
  const aAutresDisciplines = placeholder.dataset.autresDisciplines === '1';
  const rendre = (voies) => {
    // La fiche (popup ou panneau) peut avoir été refermée ou réutilisée
    // entre-temps : on n'écrit que si ce placeholder est toujours dans le DOM.
    if (placeholder.isConnected) placeholder.innerHTML = construireHistogramme(voies, aAutresDisciplines);
  };
  if (cacheVoiesParFalaise.has(falaiseId)) {
    rendre(cacheVoiesParFalaise.get(falaiseId));
    return;
  }
  chargerJsonSite(siteId, urlRoute)
    .then(donneesSite => {
      const voies = (donneesSite[falaiseId] && donneesSite[falaiseId].voies_sportives) || [];
      cacheVoiesParFalaise.set(falaiseId, voies);
      rendre(voies);
    })
    .catch(() => {
      if (placeholder.isConnected) placeholder.remove();
    });
}

// Bascule vers la liste détaillée des voies (drill-down depuis le bouton
// "Voir le détail des voies" de construireHistogramme) : swap de contenu
// DANS le même .popup, pas une 2e popup MapLibre — voir carte.js pour le
// raisonnement (suivrePopup/popupOuverte ne suivent qu'UNE fiche flottante
// à la fois, une 2e popup indépendante compliquerait ce suivi pour aucun
// bénéfice réel). Construit la liste au premier appel seulement (le tableau
// brut est déjà en cache, voir chargerDetailVoies/cacheVoiesParFalaise) —
// falaiseId ne peut être absent du cache ici : ce bouton n'existe que dans
// le HTML déjà renvoyé par construireHistogramme, donc après un chargement
// réussi.
export function afficherDetailVoies(popupEl, falaiseId) {
  const placeholder = popupEl.querySelector('.voies-histo-placeholder');
  if (!placeholder) return;
  if (!placeholder.querySelector('.fiche-voies-detail')) {
    const voies = cacheVoiesParFalaise.get(falaiseId);
    if (!voies) return;
    placeholder.insertAdjacentHTML('beforeend', construireDetailVoies(voies));
  }
  popupEl.classList.add('mode-detail-voies');
  // .maplibregl-popup-content n'existe QUE côté mobile (le panneau desktop
  // n'a pas cet ancêtre) — distinction fiable sans rappeler estDesktop().
  const contenuMobile = popupEl.closest('.maplibregl-popup-content');
  if (contenuMobile) {
    // Incompatible avec .fiche-reduite (220px de haut, illisible pour une
    // liste de voies) : dépliage LOCAL forcé, SANS toucher à la variable
    // ficheReduite de carte.js — rouvrir une autre falaise ensuite doit
    // respecter le dernier choix explicite de l'utilisateur sur la
    // poignée, pas cet ajustement automatique du détail.
    contenuMobile.classList.remove('fiche-reduite');
    contenuMobile.classList.add('detail-voies-ouvert');
  }
  const poignee = popupEl.querySelector('.poignee-fiche');
  if (poignee) synchroniserPoignee(poignee, false);
  const scrollable = contenuMobile || popupEl.closest('.panneau-falaise-contenu');
  if (scrollable) scrollable.scrollTop = 0;
}

// Retour à la fiche resumée depuis le détail des voies — ficheReduite (l'état
// PARTAGÉ, jamais modifié par afficherDetailVoies) est passé par l'appelant
// (carte.js, seul propriétaire de cette variable) pour restaurer le bon état
// replié/déplié, plutôt qu'un état neutre fixe qui écraserait la préférence
// de l'utilisateur.
export function masquerDetailVoies(popupEl, ficheReduite) {
  popupEl.classList.remove('mode-detail-voies');
  const contenuMobile = popupEl.closest('.maplibregl-popup-content');
  if (contenuMobile) {
    contenuMobile.classList.remove('detail-voies-ouvert');
    contenuMobile.classList.toggle('fiche-reduite', ficheReduite);
    const poignee = popupEl.querySelector('.poignee-fiche');
    if (poignee) synchroniserPoignee(poignee, ficheReduite);
  }
  const scrollable = contenuMobile || popupEl.closest('.panneau-falaise-contenu');
  if (scrollable) scrollable.scrollTop = 0;
}

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

  // closeOnClick:false — on ferme la popup NOUS-MÊME (handler clic carte de
  // carte.js, popupOuverte.remove()), pas via le closeOnClick natif de
  // MapLibre : sur desktop, une popup parking peut être affichée par-dessus
  // le panneau falaise resté ouvert, et le clic sur la carte doit alors
  // fermer SEULEMENT la popup, pas le panneau. En reprenant la main, la
  // fermeture ne touche pas non plus falaiseSelectionneeCle (voir
  // suivrePopup plus bas pour Échap).
  const popup = new maplibregl.Popup({ offset: 14, closeOnClick: false }).setHTML(popupHtml);

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
    // Une seule fiche flottante à la fois : le clic direct sur un marqueur
    // (parking/gîte) n'emprunte pas le chemin popupOuverte.remove() de
    // carte.js (ouvrirFalaise/allerVers) — on ferme ici toute popup
    // flottante précédente, en laissant le panneau falaise desktop en place.
    // suivrePopup(popup, false) retourne la popup actuellement suivie si elle
    // est différente de celle-ci (sinon null).
    const precedente = suivrePopup ? suivrePopup(popup, false) : null;
    if (precedente && precedente !== popup && !precedente.estPanneauFalaise && precedente.remove) {
      precedente.remove();
    }
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
    // DuckDB) : le fichier web principal ne contient plus voies_sportives.
    // Sans effet ici en pratique : [data-route] n'existe que dans
    // popupFalaise (voir chargerDetailVoies), or cat vaut forcément
    // "parking"/"hebergement" à ce point (retour anticipé falaise plus haut)
    // — gardé pour rester robuste si cette contrainte venait à changer.
    chargerDetailVoies(elPopupOuverture, urlRoute);
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
  // closeOnClick:false : même principe qu'addMarker — la fermeture au clic
  // carte est gérée par le handler générique de carte.js, pas par MapLibre.
  const popup = new maplibregl.Popup({ offset: 14, closeOnClick: false })
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

    chargerDetailVoies(elPopup, urlRoute);
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

// Panneau droit (fiche falaise, voir style-carte.css @media min-width:641px)
// : alternative à ouvrirPopupFalaise pour ouvrirFalaise (carte.js), qui
// choisit l'un ou l'autre selon estDesktop(). Un seul singleton DOM, créé une
// fois (assurerPanneauFalaise) puis réutilisé/rempli à chaque sélection —
// pas un élément recréé par falaise comme les popups MapLibre. Contrairement
// au panneau gauche (recherche/légende, toujours visible, jamais animé), ce
// panneau reste contextuel : sa largeur se révèle/se referme à la sélection
// (voir la classe .ouvert, sens CSS width dans style-carte.css).
let panneauFacade = null; // {estPanneauFalaise:true, remove} — façade compatible avec suivrePopup/popupOuverte (carte.js), qui n'attend qu'un objet avec .remove()

// Garantit la présence de #panneau-falaise dans le DOM : présent en HTML
// statique dans chaque sortie, comme SIBLING de #panneau-lateral (pas
// imbriqué dedans — voir sorties/*/index.html) : le panneau droit (fiche
// falaise) est indépendant du panneau gauche (recherche/légende), qui reste
// stable pendant que celui-ci s'ouvre/se ferme (retour terrain : les voir
// se déplacer ou se faire pousser par une fiche longue perturbait plus qu'il
// n'aidait). Ce filet de sécurité crée l'élément sinon plutôt que de casser
// silencieusement une sortie qui aurait oublié de le copier.
function assurerPanneauFalaise() {
  let panneau = document.getElementById('panneau-falaise');
  if (panneau) return panneau;
  panneau = document.createElement('aside');
  panneau.id = 'panneau-falaise';
  panneau.setAttribute('aria-label', 'Détails de la falaise');
  panneau.setAttribute('inert', '');
  panneau.innerHTML = `
    <div class="panneau-falaise-interieur">
      <button type="button" class="panneau-falaise-fermer" aria-label="Fermer le panneau">×</button>
      <div class="panneau-falaise-contenu"></div>
    </div>`;
  document.body.appendChild(panneau);
  return panneau;
}

// Ouvre (ou, si déjà ouvert, remplace le contenu de) le panneau falaise
// desktop. Contrairement à ouvrirPopupFalaise : pas de .poignee-fiche/
// estFicheReduite (concept mobile uniquement — la poignée générée par
// popupFalaise() reste présente dans le HTML mais display:none hors mobile,
// et le listener délégué de carte.js cherche .closest('.maplibregl-popup-content'),
// introuvable ici, no-op silencieux — rien à câbler côté panneau).
//
// cameraDejaEncadree : true quand l'appelant (allerVers, carte.js) a DÉJÀ
// lancé son propre fitBounds/flyTo (avec le bon padding, cf.
// margeAvantPopup(cible.cat==='falaise')) juste avant d'ouvrir cette falaise
// — dans ce cas, ne PAS toucher la caméra ici. Piège vérifié en test réel :
// appeler map.stop() ici coupait l'animation d'allerVers à mi-vol (les deux
// s'exécutent dans le même tick synchrone, avant que la moindre frame de
// cette animation n'ait pu s'écouler), la caméra restait figée près de son
// zoom de départ au lieu d'atteindre la falaise ciblée. Par défaut false
// (clic direct sur la couche native : aucun cadrage n'a eu lieu avant,
// c'est à cette fonction de s'en charger).
export function ouvrirPanneauFalaise(map, entree, ctx, cameraDejaEncadree = false) {
  const { enSurbrillance, onSelectionFalaise, suivrePopup, urlRoute } = ctx;
  const panneau = assurerPanneauFalaise();
  const dejaOuvert = panneau.classList.contains('ouvert');

  panneau.querySelector('.panneau-falaise-contenu').innerHTML =
    popupFalaise(entree.p, entree.lat, entree.lon, entree.cle);

  if (!panneauFacade) {
    panneauFacade = { estPanneauFalaise: true, remove: () => fermerPanneauFalaise(map, ctx) };
  }
  if (suivrePopup) suivrePopup(panneauFacade, true);
  if (onSelectionFalaise) onSelectionFalaise(entree.cle);
  enSurbrillance([entree.cle, ...entree.parkingAssocie]);
  chargerDetailVoies(panneau, urlRoute);

  // Le panneau droit a son propre scroll interne (.panneau-falaise-contenu,
  // overflow-y:auto — indépendant du panneau gauche). Changer de falaise
  // pendant qu'il reste ouvert doit ramener ce scroll en haut : sans ça, si
  // l'utilisateur avait descendu jusqu'au bas de l'histogramme d'une longue
  // fiche, la suivante s'ouvrirait déjà scrollée, titre hors champ.
  const contenu = panneau.querySelector('.panneau-falaise-contenu');
  if (contenu) contenu.scrollTop = 0;

  if (!dejaOuvert) {
    panneau.classList.add('ouvert');
    panneau.removeAttribute('inert');
    document.body.classList.add('panneau-falaise-ouvert');
    if (!cameraDejaEncadree) {
      // Première ouverture ET aucun cadrage déjà en cours (clic direct) :
      // réserve le padding caméra. reinitialiserPadding() d'abord (même
      // garde-fou que partout ailleurs, voir carte-utils.js) : repart d'une
      // base à zéro avant de poser le padding réservé au panneau.
      map.stop();
      reinitialiserPadding(map);
      const padding = margeAvantPopup(true);
      const visible = estPointVisible(map, entree.lon, entree.lat, map.getPadding());
      map.easeTo({ padding, ...(visible ? {} : { center: [entree.lon, entree.lat] }), duration: 200 });
    }
    // Sinon (cameraDejaEncadree) : allerVers a déjà posé le bon padding et
    // vole déjà vers le bon centre/zoom, rien à faire de plus ici.
  } else if (!cameraDejaEncadree && !estPointVisible(map, entree.lon, entree.lat, map.getPadding())) {
    // Changement de falaise pendant que la section reste ouverte : PAS de
    // collapse/reopen (dejaOuvert), juste un recentrage si la nouvelle
    // falaise tombe sous la colonne — et seulement si l'appelant n'a pas
    // déjà géré la caméra lui-même.
    map.easeTo({ center: [entree.lon, entree.lat], duration: 200 });
  }

  return panneauFacade;
}

// Exportée : carte.js la référence (import) pour fermer le panneau depuis
// les handlers clic-carte / Échap. Sans ce export, l'import échoue en
// SyntaxError et TOUT le graphe de modules (dont initCarte) ne se charge
// pas → carte complètement vide (ni données, ni fond).
export function fermerPanneauFalaise(map, ctx) {
  const panneau = document.getElementById('panneau-falaise');
  if (panneau) {
    panneau.classList.remove('ouvert');
    panneau.setAttribute('inert', '');
  }
  document.body.classList.remove('panneau-falaise-ouvert');
  map.stop();
  // PAS un padding à zéro : le panneau gauche (recherche/légende) reste
  // affiché en permanence même panneau droit fermé — revenir à
  // margeAvantPopup() SANS argument (= margeDesktop(), réservation gauche
  // seule) plutôt qu'à zéro, sinon cette réservation disparaîtrait alors que
  // le panneau gauche, lui, occupe toujours cet espace à l'écran. Le
  // panneau droit, lui, redevient contextuel : sa réservation (right) est
  // bien relâchée ici, contrairement au panneau gauche.
  map.easeTo({ padding: margeAvantPopup(), duration: 200 });
  const popupActive = ctx.suivrePopup ? ctx.suivrePopup(panneauFacade, false) : null;
  if (!popupActive) ctx.enSurbrillance(null);
  // Contrairement à la fermeture d'une popup mobile (qui NE vide PAS
  // falaiseSelectionneeCle, voir le commentaire dans ouvrirPopupFalaise ci-
  // dessus) : la visibilité de la section falaise EST le reflet de la
  // sélection sur desktop (contextuelle, contrairement à la colonne elle-
  // même qui reste affichée en permanence) — la fermer doit donc vider
  // la sélection, sans quoi la section resterait fermée pendant que le
  // parking associé à l'ancienne falaise resterait affiché sans raison
  // visible. carte.js est seul propriétaire de falaiseSelectionneeCle, d'où
  // cette callback injectée plutôt qu'un accès direct depuis marqueurs.js.
  if (ctx.onFermeturePanneau) ctx.onFermeturePanneau();
}

// Câble le bouton fermer du panneau (posé une fois, l'élément est un
// singleton — voir assurerPanneauFalaise). Appelée depuis initCarte
// (carte.js), avec le même ctx que celui passé à ouvrirPanneauFalaise.
export function cablerFermetureManuellePanneau(map, ctx) {
  const panneau = assurerPanneauFalaise();
  const bouton = panneau.querySelector('.panneau-falaise-fermer');
  if (bouton) bouton.addEventListener('click', () => fermerPanneauFalaise(map, ctx));
}
