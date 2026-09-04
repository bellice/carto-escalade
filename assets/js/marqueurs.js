// marqueurs.js — création des marqueurs MapLibre (falaise/parking/gîte) :
// DOM, accessibilité, popup attachée, gestion d'ouverture/fermeture.

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs';
import { cleFalaise, libelleFalaise, secteurDistinct } from './donnees.js';
import { poserTailleMarqueur } from './symboles.js';
import { popupFalaise, popupParking, popupGite, construireHistogramme, construireDetailVoies } from './popups.js';
import { reinitialiserPadding, margeAvantPopup, estPointVisible, dureeAnimation } from './carte-utils.js';

// id_falaise -> tableau BRUT de voies_sportives, jamais du HTML pré-rendu :
// l'histogramme et le détail des voies consomment la même donnée, cacher du
// HTML figerait celui des deux rendus demandé en premier.
const cacheVoiesParFalaise = new Map();
const cacheSitesRoutes = new Map(); // slug-site -> Promise<JSON du site>

// Cache de PROMESSES et non de valeurs : deux falaises du même site ouvertes
// coup sur coup ne déclenchent qu'une requête.
// Le retrait en cas d'échec est indispensable : une promesse rejetée laissée
// en cache condamnerait les histogrammes de tout le site jusqu'au rechargement
// de la page, réseau revenu ou non — « Réessayer » ne pourrait pas marcher.
// r.ok : un 404 renvoie du HTML, que .json() rejetterait avec une erreur de
// syntaxe illisible.
function chargerJsonSite(siteId, urlRoute) {
  if (!cacheSitesRoutes.has(siteId)) {
    const requete = fetch(urlRoute(siteId))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} sur ${urlRoute(siteId)}`);
        return r.json();
      })
      .catch((err) => {
        cacheSitesRoutes.delete(siteId);
        throw err;
      });
    cacheSitesRoutes.set(siteId, requete);
  }
  return cacheSitesRoutes.get(siteId);
}

function chargerDetailVoies(racineEl, urlRoute) {
  const placeholder = racineEl && racineEl.querySelector('[data-route]');
  remplirPlaceholderVoies(placeholder, urlRoute);
}

// Prend le placeholder lui-même, pas un ancêtre : le bouton « Réessayer » vit
// dedans et devrait sinon remonter au parent pour se retrouver.
export function remplirPlaceholderVoies(placeholder, urlRoute) {
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
      // Afficher l'échec plutôt que retirer le placeholder : une disparition
      // serait indistinguable d'une falaise sans détail de voies.
      if (!placeholder.isConnected) return;
      placeholder.innerHTML = `
        <p class="detail-indisponible">
          <span>Détail des voies indisponible (hors ligne ?).</span>
          <button type="button" class="btn-reessayer-voies">Réessayer</button>
        </p>`;
    });
}

// Remplace le contenu DANS la popup existante plutôt que d'en ouvrir une 2e :
// suivrePopup ne suit qu'une fiche flottante à la fois.
export function afficherDetailVoies(popupEl, falaiseId) {
  const placeholder = popupEl.querySelector('.voies-histo-placeholder');
  if (!placeholder) return;
  if (!placeholder.querySelector('.fiche-voies-detail')) {
    const voies = cacheVoiesParFalaise.get(falaiseId);
    if (!voies) return;
    placeholder.insertAdjacentHTML('beforeend', construireDetailVoies(voies));
  }
  popupEl.classList.add('mode-detail-voies');
  // .maplibregl-popup-content n'existe que côté mobile : distinction fiable
  // sans rappeler estDesktop().
  const contenuMobile = popupEl.closest('.maplibregl-popup-content');
  if (contenuMobile) {
    // Dépliage LOCAL, sans toucher à ficheReduite (carte.js) : le dernier
    // choix explicite de l'utilisateur sur la poignée doit survivre.
    contenuMobile.classList.remove('fiche-reduite');
    contenuMobile.classList.add('detail-voies-ouvert');
  }
  const poignee = popupEl.querySelector('.poignee-fiche');
  if (poignee) synchroniserPoignee(poignee, false);
  const scrollable = contenuMobile || popupEl.closest('.panneau-falaise-contenu');
  if (scrollable) scrollable.scrollTop = 0;
}

// Ré-injecte tout le bloc plutôt que de le patcher : en-tête, liste et bouton
// Retour dépendent tous du mode. Relit le cache, jamais un nouveau fetch.
export function basculerTriDetailVoies(popupEl, falaiseId, mode) {
  const ancien = popupEl.querySelector('.fiche-voies-detail');
  const voies = cacheVoiesParFalaise.get(falaiseId);
  if (!ancien || !voies) return;
  ancien.outerHTML = construireDetailVoies(voies, mode);
}

// ficheReduite vient de l'appelant (carte.js en est seul propriétaire) :
// restaurer un état neutre fixe écraserait la préférence de l'utilisateur.
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
    // Falaises : rendu en COUCHE NATIVE (voir carte.js), donc ni marqueur DOM
    // ni popup attachée — seulement les données servant recherche, filtres,
    // anti-collision des libellés et chargement différé des voies.
    return {
      cat, cle, nom: p.nom, secteur: secteurDistinct(p), lon, lat,
      parkingAssocie, p,
      // Le SITE est inclus en plus de « nom · secteur » : sans lui, taper
      // « Saoû » ne renvoyait rien alors que 40 des 111 secteurs en dépendent
      // — c'est pourtant le nom que tout le monde emploie. Idem « Crest »,
      // dont la falaise s'appelle « Les Roches ». Le site n'est pas affiché
      // dans le libellé, il sert uniquement à la correspondance.
      recherche: `${libelleFalaise(p)} ${p.site || ''}`.toLowerCase(),
      nbVoies: p.nb_voie_total ?? 0,
      // {cotation: nombre} : permet le filtre par fourchette sans télécharger
      // routes/*.json.
      cotations: p.cotations || null,
      nbDansFourchette: 0, // recalculé par majFourchette (carte.js)
      nbGrandeVoie: p.nb_gv ?? 0,
      nbCouenne: p.nb_couenne ?? 0,
    };
  }

  // PIÈGE : MapLibre réécrit style.transform de "el" à chaque repositionnement.
  // Tout style visuel qui dépend d'un transform (rotation du losange gîte) doit
  // donc vivre sur "visuel", jamais ici.
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
    // Carré et non rond : la catégorie est codée par la forme, la couleur
    // changeant déjà de sens sur les falaises selon le mode actif. Le « P »
    // le distingue des carrés de l'histogramme (« 1 carré = 1 voie »), tout
    // en restant du texte — le site n'a aucun pictogramme.
    poserTailleMarqueur(el, visuel, 22);
    visuel.style.borderRadius = 'var(--radius)';
    visuel.style.background = 'var(--teal)';
    visuel.textContent = 'P';
  }
  // Pas de branche "falaise" ici : retour anticipé plus haut, cat ne vaut plus
  // que "parking" ou "hebergement".

  const popupHtml =
    cat === 'falaise' ? popupFalaise(p, lat, lon, cle) :
    cat === 'parking' ? popupParking(p, lat, lon, parkingInfos, cle) :
    popupGite(p, lat, lon, cle);

  // closeOnClick:false — la fermeture au clic carte est reprise par carte.js :
  // sur desktop, une popup parking peut se superposer au panneau falaise, et
  // le clic doit alors fermer la popup seule, pas le panneau.
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
    // Une seule fiche flottante à la fois : le clic direct sur un marqueur ne
    // passe pas par carte.js, on ferme donc ici la popup précédente — en
    // laissant le panneau falaise desktop en place.
    const precedente = suivrePopup ? suivrePopup(popup, false) : null;
    if (precedente && precedente !== popup && !precedente.estPanneauFalaise && precedente.remove) {
      precedente.remove();
    }
    if (suivrePopup) suivrePopup(popup, true);
    document.body.classList.add('fiche-ouverte');
    // L'état replié/déplié est partagé (ficheReduite, carte.js) et doit
    // survivre au changement de fiche. toggle(classe, force) et non add/remove
    // conditionnel : ce conteneur est réutilisé et peut porter un état périmé.
    const elPopupOuverture = popup.getElement();
    const contenuOuverture = elPopupOuverture && elPopupOuverture.querySelector('.maplibregl-popup-content');
    const poigneeOuverture = elPopupOuverture && elPopupOuverture.querySelector('.poignee-fiche');
    if (contenuOuverture) {
      const reduire = Boolean(estFicheReduite && estFicheReduite());
      // Coupe la transition le temps de poser l'état de départ, sinon une
      // popup ouverte déjà réduite semble se replier toute seule. La lecture
      // d'offsetHeight force le reflow : sans elle, "transition: none"
      // s'appliquerait après le changement de classe, pas avant.
      contenuOuverture.style.transition = 'none';
      contenuOuverture.classList.toggle('fiche-reduite', reduire);
      contenuOuverture.offsetHeight;
      contenuOuverture.style.transition = '';
      if (poigneeOuverture) synchroniserPoignee(poigneeOuverture, reduire);
    }
    // Les actions du contenu passent par un écouteur délégué unique dans
    // initCarte : rien à ré-attacher ici, donc insensible à un nœud périmé.
    if (cat === 'falaise') {
      if (onSelectionFalaise) onSelectionFalaise(cle);
      enSurbrillance([cle, ...parkingAssocie]);
    } else if (cat === 'parking') {
      const info = parkingInfos.get(p.nom);
      enSurbrillance([cle, ...(info ? info.falaises.map(f => f.cle) : [])]);
    } else {
      enSurbrillance([cle]);
    }

    // Sans effet ici en pratique ([data-route] n'existe que dans popupFalaise,
    // et cat vaut forcément parking/hebergement) : gardé au cas où.
    chargerDetailVoies(elPopupOuverture, urlRoute);
  });
  popup.on('close', () => {
    // Fermeture potentiellement périmée : si une autre popup s'est ouverte
    // entre-temps, ne pas écraser la surbrillance qu'elle vient de poser.
    // Bug observé : clic falaise puis parking, tous les marqueurs à 100 %.
    const popupActive = suivrePopup ? suivrePopup(popup, false) : null;
    if (!popupActive) {
      document.body.classList.remove('fiche-ouverte');
      enSurbrillance(null);
    }
    // Ni la sélection ni l'état replié ne sont effacés ici, volontairement :
    // fermer une fiche garde visible le parking de la dernière falaise, et
    // l'état replié est partagé entre toutes les popups.
  });

  const entree = {
    marker, cat, nom: p.nom, secteur: null, cle, recherche: p.nom.toLowerCase(),
    parkingAssocie,
    nbVoies: p.nb_voie_total ?? 0,
    nbGrandeVoie: 0, nbCouenne: 0,
  };

  return entree;
}

// Popup d'une falaise (couche native) : ouverte à la demande, faute de
// marqueur DOM auquel l'attacher.
export function ouvrirPopupFalaise(map, entree, ctx) {
  const { enSurbrillance, onSelectionFalaise, suivrePopup, estFicheReduite, urlRoute } = ctx;
  // closeOnClick:false : même raison que dans addMarker.
  const popup = new maplibregl.Popup({ offset: 14, closeOnClick: false })
    .setLngLat([entree.lon, entree.lat])
    .setHTML(popupFalaise(entree.p, entree.lat, entree.lon, entree.cle));

  // PIÈGE : les listeners doivent être posés AVANT addTo(map), qui déclenche
  // 'open' de façon synchrone. Les poser après fait rater l'évènement.
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

// Panneau droit (desktop) : alternative à ouvrirPopupFalaise, choisie par
// carte.js selon estDesktop(). Singleton DOM réutilisé, pas un élément recréé
// à chaque falaise.
let panneauFacade = null; // façade à .remove(), pour être suivie comme une popup par carte.js
let declencheurFocus = null; // élément à qui rendre le focus à la fermeture

// Filet de sécurité : le panneau est en HTML statique dans chaque sortie, on
// le crée ici plutôt que de casser silencieusement une sortie qui l'oublierait.
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

// cameraDejaEncadree : l'appelant a déjà lancé son propre vol, ne pas toucher
// la caméra. PIÈGE vérifié en test : le map.stop() ci-dessous coupait
// l'animation d'allerVers à mi-vol — les deux tournent dans le même tick
// synchrone — et la caméra restait figée près de son zoom de départ.
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

  // Le panneau a son propre scroll : sans ce retour en haut, changer de
  // falaise ouvrirait la suivante déjà scrollée, titre hors champ.
  const contenu = panneau.querySelector('.panneau-falaise-contenu');
  if (contenu) contenu.scrollTop = 0;

  if (!dejaOuvert) {
    panneau.classList.add('ouvert');
    panneau.removeAttribute('inert');
    document.body.classList.add('panneau-falaise-ouvert');
    // Sans ça, il fallait tabuler à travers toute la page pour atteindre une
    // fiche qu'on vient d'ouvrir. On note d'où l'on vient pour y revenir.
    declencheurFocus = document.activeElement;
    const fermer = panneau.querySelector('.panneau-falaise-fermer');
    if (fermer) fermer.focus();
    if (!cameraDejaEncadree) {
      // reinitialiserPadding d'abord : repart d'une base à zéro avant de poser
      // le padding réservé au panneau.
      map.stop();
      reinitialiserPadding(map);
      const padding = margeAvantPopup(true);
      const visible = estPointVisible(map, entree.lon, entree.lat, map.getPadding());
      map.easeTo({ padding, ...(visible ? {} : { center: [entree.lon, entree.lat] }), duration: dureeAnimation(200) });
    }
  } else if (!cameraDejaEncadree && !estPointVisible(map, entree.lon, entree.lat, map.getPadding())) {
    // Panneau déjà ouvert : pas de fermeture/réouverture, juste un recentrage
    // si la nouvelle falaise tombe sous la colonne.
    map.easeTo({ center: [entree.lon, entree.lat], duration: dureeAnimation(200) });
  }

  return panneauFacade;
}

// Ne pas retirer l'export : carte.js l'importe, et un import qui échoue fait
// tomber tout le graphe de modules — carte entièrement vide, sans erreur utile.
export function fermerPanneauFalaise(map, ctx) {
  const panneau = document.getElementById('panneau-falaise');
  if (panneau) {
    // Poser inert AVANT de restituer le focus, sinon celui-ci resterait sur un
    // élément qu'on vient de retirer du parcours clavier.
    const focusInterne = panneau.contains(document.activeElement);
    panneau.classList.remove('ouvert');
    panneau.setAttribute('inert', '');
    // Seulement si le focus était DANS le panneau : le reprendre à un
    // utilisateur qui l'a déplacé ailleurs serait intrusif.
    if (focusInterne && declencheurFocus && declencheurFocus.isConnected) {
      declencheurFocus.focus();
    }
    declencheurFocus = null;
  }
  document.body.classList.remove('panneau-falaise-ouvert');
  map.stop();
  // margeAvantPopup() sans argument, et non un padding à zéro : le panneau
  // GAUCHE reste affiché en permanence et occupe toujours cet espace. Seule
  // la réservation de droite est relâchée.
  map.easeTo({ padding: margeAvantPopup(), duration: dureeAnimation(200) });
  const popupActive = ctx.suivrePopup ? ctx.suivrePopup(panneauFacade, false) : null;
  if (!popupActive) ctx.enSurbrillance(null);
  // Ici la sélection EST vidée, contrairement à la fermeture d'une popup
  // mobile : sur desktop le panneau reflète la sélection, la fermer sans
  // l'effacer laisserait le parking associé affiché sans raison visible.
  if (ctx.onFermeturePanneau) ctx.onFermeturePanneau();
}

export function cablerFermetureManuellePanneau(map, ctx) {
  const panneau = assurerPanneauFalaise();
  const bouton = panneau.querySelector('.panneau-falaise-fermer');
  if (bouton) bouton.addEventListener('click', () => fermerPanneauFalaise(map, ctx));
}
