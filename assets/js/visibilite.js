// visibilite.js — ce qui est affiché : filtres appliqués à la couche et aux
// marqueurs, surbrillance, parkings, libellés de site et de secteur.

import { ZOOM_PARKINGS, etat, filtreCotationActif } from './etat.js';
import { rafraichirDetailVoies } from './marqueurs.js';
import { ZOOM_LABELS_SECTEUR } from './labels.js';
import { estDuStyle, estFalaiseVideDansMode } from './donnees.js';

const legendeEnsoleillement = document.getElementById('legende-ensoleillement');
const resumeResultats = document.getElementById('legende-resultat');

// cles=null remet tout le monde à l'opacité normale.
// PIÈGE : passer par marker.setOpacity() et jamais par style.opacity —
// MapLibre réapplique sa propre valeur interne à chaque 'move'/'render' et
// écraserait silencieusement toute écriture directe dès le pan suivant.
export function enSurbrillance(cles) {
  const actifs = cles ? new Set(cles) : null;
  etat.entries.forEach((e) => {
    if (e.cat === 'falaise') {
      // Couche native : estompe via feature-state (voir circle-opacity dans
      // construireCoucheFalaises). On ne pose l'état que s'il change : le
      // feature-state relance la source à chaque appel, à éviter pour des
      // milliers de falaises.
      const estompe = Boolean(actifs && !actifs.has(e.cle));
      if (etat.etatEstompeParCle.get(e.cle) !== estompe) {
        etat.etatEstompeParCle.set(e.cle, estompe);
        if (etat.map.getLayer('falaises')) etat.map.setFeatureState({ source: 'falaises', id: e.cle }, { estompe });
      }
    } else if (e.marker) {
      e.marker.setOpacity((!actifs || actifs.has(e.cle)) ? '1' : '0.25');
    }
  });
}

// Une entrée a-t-elle un figuré ponctuel visible en ce moment ? Pour les
// falaises (couche native) on consulte le Set maintenu par appliquerFiltres.
function entreeVisible(entree) {
  if (entree.cat === 'falaise') return etat.falaisesVisibles.has(entree.cle);
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
export function appliquerFiltresEtSecteurs() {
  appliquerFiltres();
  appliquerAntiCollisionSecteurs();
  appliquerAntiCollisionSites();
  rafraichirResumeResultats();
  rafraichirDetailVoies();
}

// Résumé vivant en tête du panneau "Filtres" mobile (voir style-carte.css,
// #legende-resultat) : falaisesVisibles est déjà tenue à jour par
// appliquerFiltres juste au-dessus, aucun nouveau calcul nécessaire.
function rafraichirResumeResultats() {
  if (!resumeResultats) return;
  const n = etat.falaisesVisibles.size;
  resumeResultats.textContent = `${n} secteur${n === 1 ? '' : 's'} affiché${n === 1 ? '' : 's'}`;
}

// Change la falaise "active" (popup ouverte) : ses parkings associés
// deviennent pertinents (voir appliquerFiltres, les parkings sont masqués
// par défaut — on cherche d'abord le secteur, le parking en découle).
export function definirFalaiseSelectionnee(cle) {
  etat.falaiseSelectionneeCle = cle;
  appliquerFiltresEtSecteurs();
}

// Bascule peu coûteuse (garde d'égalité, comme appliquerSimplificationZoom)
// pour rester réactive PENDANT un geste de zoom continu ; le calcul des
// recouvrements (plus coûteux : projection + mesure DOM de chaque libellé)
// attend que la caméra se stabilise (moveend/zoomend) — voir le câblage
// dans ajouterLabelsDeSecteur.
export function appliquerVisibiliteSecteurs() {
  const visible = etat.map.getZoom() >= ZOOM_LABELS_SECTEUR;
  if (visible === etat.secteursVisibles) return;
  etat.secteursVisibles = visible;
  if (!visible) {
    etat.labelsSecteurs.forEach(({ el }) => { el.style.visibility = 'hidden'; });
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
export function appliquerVisibiliteSites() {
  const visible = etat.map.getZoom() < ZOOM_LABELS_SECTEUR;
  if (visible === etat.sitesVisibles) return;
  etat.sitesVisibles = visible;
  if (!visible) {
    etat.labelsSites.forEach(({ el }) => { el.style.visibility = 'hidden'; });
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
    const point = etat.map.project(marker.getLngLat());
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

export function appliquerAntiCollisionSecteurs() {
  if (!etat.secteursVisibles) return;
  appliquerAntiCollision(etat.labelsSecteurs, etat.entriesParSecteur, (l) => l.nom);
}

export function appliquerAntiCollisionSites() {
  // Règle de zoom (voir appliquerVisibiliteSites) : pas de nom de site à
  // décollisionner au-delà du seuil des secteurs — ils sont tous masqués.
  if (etat.sitesVisibles === false) return;
  appliquerAntiCollision(etat.labelsSites, etat.entriesParSite, (l) => l.site);
}

// Parkings : visibles par défaut à fort zoom (>= ZOOM_PARKINGS), et
// toujours révélés par une recherche ou une falaise sélectionnée (à tout
// zoom) — le tout restreint aux parkings des falaises visibles
// (parkingsAutorises, construit par appliquerFiltres). Contrairement aux
// falaises (filtre de couche GPU), les parkings sont des marqueurs DOM :
// leur affichage se pilote ici, re-exécuté sur chaque zoom sans repasser
// par appliquerFiltres (qui re-poserait inutilement le filtre de la couche).
export function appliquerVisibiliteParkings() {
  // Déclencheurs d'affichage : recherche active, falaise sélectionnée, ou
  // fort zoom (>= ZOOM_PARKINGS) — à tout autre moment, tout est masqué.
  const zoomPousse = etat.map.getZoom() >= ZOOM_PARKINGS;
  const montrerParkings = Boolean(etat.filtres.recherche) || Boolean(etat.falaiseSelectionneeCle) || zoomPousse;

  // Parkings autorisés : ceux déjà portés par recherche/sélection
  // (parkingsAutorises, construit par appliquerFiltres) +, à fort zoom,
  // ceux de TOUTES les falaises visibles — le mode "vue détaillée" par
  // défaut. (À fort zoom sans filtre, falaisesVisibles contient toutes les
  // falaises, donc tous leurs parkings s'affichent.)
  const aMontrer = new Set(etat.parkingsAutorises);
  if (zoomPousse) {
    etat.entries.forEach((entree) => {
      if (entree.cat === 'falaise' && etat.falaisesVisibles.has(entree.cle)) {
        entree.parkingAssocie.forEach((nom) => aMontrer.add(nom));
      }
    });
  }

  etat.entries.forEach((entree) => {
    if (entree.cat !== 'parking') return;
    entree.marker.getElement().style.display = (montrerParkings && aMontrer.has(entree.nom)) ? '' : 'none';
  });
}

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
  const utile = Boolean(filtreActif) && etat.falaisesSansOrientationConnue;
  if (utile && !etat.noteEnsoleillementAucune) {
    etat.noteEnsoleillementAucune = document.createElement('p');
    etat.noteEnsoleillementAucune.className = 'legende-note';
    etat.noteEnsoleillementAucune.textContent = 'Falaises sans orientation connue non affichées.';
    legendeEnsoleillement.after(etat.noteEnsoleillementAucune);
  } else if (!utile && etat.noteEnsoleillementAucune) {
    etat.noteEnsoleillementAucune.remove();
    etat.noteEnsoleillementAucune = null;
  }
}

// Pose les filtres sur la couche des falaises et sur les marqueurs parking.
export function appliquerFiltres() {
  const mode = etat.modeFigureActuel;
  // Le mode "Cercles" et le filtre de trajet masquent des falaises mais
  // n'autorisent PAS leurs parkings : bouger le slider réafficherait des
  // dizaines de parkings d'un coup. Seuls trois déclencheurs les autorisent
  // (voir appliquerVisibiliteParkings) : une recherche active, la falaise
  // sélectionnée si elle reste visible, et le zoom >= ZOOM_PARKINGS — ce
  // dernier ne passe pas par ce set.
  etat.parkingsAutorises = new Set();

  // Couche native : on pose le FILTRE de la couche, pas un display DOM, et on
  // miroite le résultat dans falaisesVisibles pour l'anti-collision.
  // tempsGite null -> coalesce 0 : une falaise sans trajet calculé n'est
  // jamais exclue par le slider. L'exclusion par MODE se fait, elle, dans la
  // SOURCE et non ici.
  const conditions = [];
  if (etat.filtres.recherche) conditions.push(['>=', ['index-of', etat.filtres.recherche, ['get', 'recherche']], 0]);
  if (Number.isFinite(etat.filtres.tempsMaxGite)) conditions.push(['<=', ['coalesce', ['get', 'tempsGite'], 0], etat.filtres.tempsMaxGite]);
  // Union des catégories cochées, chacune une correspondance EXACTE (voir
  // le commentaire de filtres.ensoleillement) — pas de repli "on suppose
  // que ça passe" ici, contrairement au temps depuis le gîte où l'absence
  // de mesure ne doit jamais exclure : une falaise sans orientation
  // exploitable ne peut satisfaire aucune catégorie cochée.
  if (etat.filtres.ensoleillement.length) {
    conditions.push(['in', ['get', 'ensoleillement'], ['literal', etat.filtres.ensoleillement]]);
  }
  // Pratique choisie : le texte "styles" de la source (voir
  // construireSourceFalaises) contient le nom de chaque pratique du secteur.
  // Miroir de estDuStyle (donnees.js), utilisé plus bas pour falaisesVisibles :
  // les deux doivent rester d'accord. La combinaison avec le type de voie
  // (un secteur sans voie trad ET grande voie) est, elle, posée dans la SOURCE,
  // comme le mode "Type de voie" (voir estFalaiseVideDansMode).
  if (etat.filtres.pratique !== 'tous') {
    conditions.push(['>=', ['index-of', etat.filtres.pratique, ['get', 'styles']], 0]);
  }
  // Fourchette de cotation resserrée : ne garde que les falaises avec au
  // moins une voie dans les bornes (nbDansFourchette, propriété posée par
  // construireSourceFalaises et rafraîchie à chaque changement de bornes via
  // appliquerFiltreCotation qui reconstruit la source). Condition large (tous
  // styles et types) : la combinaison exacte avec Pratique et "Type de voie"
  // est posée dans la SOURCE (estFalaiseVideDansMode).
  if (filtreCotationActif()) {
    conditions.push(['>', ['coalesce', ['get', 'nbDansFourchette'], 0], 0]);
  }
  if (etat.map.getLayer('falaises')) etat.map.setFilter('falaises', conditions.length ? ['all', ...conditions] : null);
  rafraichirNoteEnsoleillement(etat.filtres.ensoleillement.length > 0);

  etat.falaisesVisibles = new Set();
  etat.entries.forEach((entree) => {
    if (entree.cat !== 'falaise') return;
    const visible =
      (!etat.filtres.recherche || entree.recherche.includes(etat.filtres.recherche)) &&
      !estFalaiseVideDansMode(entree, mode, etat.filtres.pratique) &&
      (entree.tempsGite == null || entree.tempsGite <= etat.filtres.tempsMaxGite) &&
      (!etat.filtres.ensoleillement.length || etat.filtres.ensoleillement.includes(entree.ensoleillement)) &&
      estDuStyle(entree, etat.filtres.pratique) &&
      (!filtreCotationActif() || entree.nbDansFourchette > 0);
    if (visible) {
      etat.falaisesVisibles.add(entree.cle);
      if (etat.filtres.recherche) entree.parkingAssocie.forEach((nom) => etat.parkingsAutorises.add(nom));
    }
  });

  // La falaise sélectionnée ne compte que si elle est toujours effectivement
  // visible (recherche/mode/temps compris, cf. falaisesVisibles posé juste
  // au-dessus) — sinon son parking ne doit pas rester affiché seul, sans
  // qu'aucune falaise visible ne le justifie.
  if (etat.falaiseSelectionneeCle) {
    const falaise = etat.entries.find((e) => e.cat === 'falaise' && e.cle === etat.falaiseSelectionneeCle);
    if (falaise && etat.falaisesVisibles.has(falaise.cle)) {
      falaise.parkingAssocie.forEach((nom) => etat.parkingsAutorises.add(nom));
    }
  }

  // Visibilité des marqueurs parking : dépend aussi du zoom (voir
  // appliquerVisibiliteParkings) — appelée ici après le calcul des parkings
  // autorisés, et sur chaque zoom via map.on('zoom').
  appliquerVisibiliteParkings();
}
