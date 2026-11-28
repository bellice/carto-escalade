// navigation.js — passer d'un point à un autre : fiche falaise, caméra, clic sur
// la carte, libellés cliquables, touche Échap.

import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';
import {
  appliquerAntiCollisionSecteurs, appliquerAntiCollisionSites, appliquerFiltresEtSecteurs, appliquerVisibiliteSecteurs, appliquerVisibiliteSites, definirFalaiseSelectionnee, enSurbrillance,
} from './visibilite.js';
import { etat, filtreCotationActif } from './etat.js';
import {
  dureeAnimation, dureeReduite, estDesktop, margeAvantPopup, margeToutVoir, reinitialiserPadding,
} from './carte-utils.js';
import {
  fermerPanneauFalaise, masquerDetailVoies, ouvrirPanneauFalaise, ouvrirPopupFalaise,
} from './marqueurs.js';
import { definirVueMobile, reinitialiserRecherche } from './panneau-lateral.js';
import { compterDansFourchette, estDuStyle, estFalaiseVideDansMode } from './donnees.js';
import {
  definirModeFigure, reinitialiserFiltreCotation, reinitialiserFiltreEnsoleillement, reinitialiserFiltreStyle, reinitialiserFiltreTemps,
} from './filtres.js';
import { ZOOM_LABELS_SECTEUR, ajouterLabelsSecteurs, ajouterLabelsSites } from './labels.js';
import { cablerActionsFiche } from './actions-fiche.js';

const recherche = document.querySelector('.recherche input');

// Contexte partagé pour ouvrirPopupFalaise (couche native) : mêmes
// callbacks que les popups des marqueurs DOM parking/gîte.
const ctxPopup = {
  enSurbrillance,
  onSelectionFalaise: definirFalaiseSelectionnee,
  suivrePopup,
  estFicheReduite: () => etat.ficheReduite,
  urlRoute: (id) => etat.baseRoutes + id + '.json',
};

// Contexte pour ouvrirPanneauFalaise (panneau latéral desktop) : pas
// estFicheReduite (concept mobile uniquement, sans objet pour un panneau
// desktop). onFermeturePanneau vide la sélection à la fermeture — l'état
// falaiseSelectionneeCle (etat.js) reste modifié ici et dans visibilite.js seulement, voir le commentaire
// dans fermerPanneauFalaise (marqueurs.js) sur pourquoi ce comportement
// diverge délibérément de la fermeture d'une popup mobile.
export const ctxPanneau = {
  enSurbrillance,
  onSelectionFalaise: definirFalaiseSelectionnee,
  suivrePopup,
  urlRoute: (id) => etat.baseRoutes + id + '.json',
  onFermeturePanneau: () => { etat.falaiseSelectionneeCle = null; appliquerFiltresEtSecteurs(); },
};

// Le panneau falaise desktop est-il ouvert ? État réel porté par le DOM
// (classe .ouvert sur #panneau-falaise), PAS par popupOuverte : ouvrir une
// popup parking/gîte pendant que le panneau est ouvert écrase popupOuverte
// (qui n'est alors plus le panneau) sans fermer le panneau — toute logique
// de fermeture (clic hors falaise, Échap) doit donc lire le DOM, pas
// popupOuverte.estPanneauFalaise.
const panneauFalaiseOuvert = () => estDesktop() && document.getElementById('panneau-falaise')?.classList.contains('ouvert');

export function suivrePopup(popup, ouverte) {
  etat.popupOuverte = ouverte ? popup : (etat.popupOuverte === popup ? null : etat.popupOuverte);
  return etat.popupOuverte;
}

// Élément .popup actuellement affiché, qu'il vive dans une popup flottante
// MapLibre (mobile/parking/gîte) ou dans le panneau desktop (panneauFacade,
// sans .getElement() propre) — les deux cas donnent un point d'entrée DOM
// différent, factorisé ici pour ne pas le refaire à chaque appelant.
const popupElementCourant = () => {
  if (!etat.popupOuverte) return null;
  if (etat.popupOuverte.estPanneauFalaise) return document.getElementById('panneau-falaise')?.querySelector('.popup') || null;
  return etat.popupOuverte.getElement ? etat.popupOuverte.getElement().querySelector('.popup') : null;
};

// Popup flottante sur mobile, panneau latéral sur desktop. Ferme la fiche
// ouverte SAUF si le panneau desktop l'est déjà : on remplace alors son
// contenu, sans fermeture/réouverture visible.
// cameraDejaEncadree évite que ouvrirPanneauFalaise ne coupe l'animation
// d'allerVers avec son map.stop() — voir marqueurs.js.
function ouvrirFalaise(cle, cameraDejaEncadree = false) {
  const entree = etat.index.get(cle);
  if (!entree) return;
  if (etat.popupOuverte && !(estDesktop() && etat.popupOuverte.estPanneauFalaise)) {
    etat.popupOuverte.remove();
  }
  definirFalaiseSelectionnee(cle);
  etat.popupOuverte = estDesktop()
    ? ouvrirPanneauFalaise(etat.map, entree, ctxPanneau, cameraDejaEncadree)
    : ouvrirPopupFalaise(etat.map, entree, ctxPopup, cameraDejaEncadree);
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
  const cible = etat.index.get(cle);
  if (!cible) return;

  if (!conserverRecherche) reinitialiserRecherche();

  const origine = origineCle ? etat.index.get(origineCle) : null;

  // Naviguer vers une falaise garantit qu'elle reste visible : si le mode
  // "Type de voie" actif la masquerait (aucune donnée pour ce thème — voir
  // estFalaiseVideDansMode), on repasse sur "Toutes les voies" plutôt que
  // de laisser une popup s'ouvrir sans aucun figuré en dessous. Même
  // vérification pour l'origine d'un lien croisé (cas plus rare, mais même
  // risque). Même logique pour "Depuis le gîte" (falaise au-delà du seuil),
  // l'ensoleillement, et la fourchette de cotation (aucune voie dans les
  // bornes choisies) : chacun peut masquer la cible d'une navigation
  // explicite, chacun est levé si c'est le cas.
  const tempsGiteEmpecheVisibilite = (entree) => entree.tempsGite != null && entree.tempsGite > etat.filtres.tempsMaxGite;
  const ensoleillementEmpecheVisibilite = (entree) => etat.filtres.ensoleillement.length && !etat.filtres.ensoleillement.includes(entree.ensoleillement);
  const cotationEmpecheVisibilite = (entree) => filtreCotationActif()
    && !compterDansFourchette(entree.cotations, etat.filtres.cotationMin, etat.filtres.cotationMax);
  const seraitMasquee = (entree) => entree && entree.cat === 'falaise' && (
    estFalaiseVideDansMode(entree, etat.modeFigureActuel, etat.filtres.pratique)
    || !estDuStyle(entree, etat.filtres.pratique)
    || tempsGiteEmpecheVisibilite(entree)
    || ensoleillementEmpecheVisibilite(entree)
    || cotationEmpecheVisibilite(entree));
  const cibleSeraitMasquee = seraitMasquee(cible);
  const origineSeraitMasquee = seraitMasquee(origine);
  if (cibleSeraitMasquee || origineSeraitMasquee) {
    reinitialiserFiltreStyle();
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
  etat.falaiseSelectionneeCle = cible.cat === 'falaise' ? cible.cle
    : (origine && origine.cat === 'falaise') ? origine.cle
    : null;
  appliquerFiltresEtSecteurs();

  // PIÈGE MapLibre : le padding d'un fitBounds/flyTo PERSISTE, et le cadrage
  // suivant l'ADDITIONNE au sien au lieu de le remplacer. Sur mobile la
  // somme dépassait la hauteur du conteneur et MapLibre abandonnait le
  // cadrage en silence — d'où reinitialiserPadding() à chaque fois.
  etat.map.stop();
  reinitialiserPadding(etat.map);

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
    etat.map.fitBounds(bounds, { padding: margeAvantPopup(reserverPanneauDroit), maxZoom: 16, duration: dureeAnimation(800) });
  } else {
    etat.map.flyTo({ center: pointDe(cible), zoom: Math.max(etat.map.getZoom(), 15), padding: margeAvantPopup(reserverPanneauDroit), duration: dureeAnimation(800) });
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

// Lien profond (?falaise=<cle>, produit par le bouton « Partager » — voir
// actions-fiche.js) : ouvre directement la fiche d'une falaise précise au
// chargement, en réutilisant allerVers (même mécanique que "Voir" après une
// recherche, pas de code de navigation en double). Clé absente ou inconnue :
// comportement normal, inchangé.
export function ouvrirLienProfond() {
  const cle = new URLSearchParams(location.search).get('falaise');
  if (cle && etat.index.has(cle)) allerVers(cle);
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
  return etat.entries.filter((en) => en.cat === 'falaise' && en.p.site === site);
}

function zoomerSurSite(site) {
  const falaises = falaisesDuSite(site);
  if (!falaises.length) return;
  reinitialiserRecherche();
  appliquerFiltresEtSecteurs();
  const bounds = new maplibregl.LngLatBounds();
  falaises.forEach((en) => bounds.extend([en.lon, en.lat]));
  reinitialiserPadding(etat.map);
  // Pas de duration explicite : le défaut de MapLibre convient à ce cadrage
  // large. dureeReduite() n'en ajoute une que pour annuler l'animation
  // (prefers-reduced-motion).
  etat.map.fitBounds(bounds, { padding: margeToutVoir(), maxZoom: 16, ...dureeReduite() });
}

export function ajouterLabelsDeSite(geojson) {
  etat.labelsSites = ajouterLabelsSites(etat.map, geojson, (site) => zoomerSurSite(site));
  // Règle de hiérarchie des libellés : les noms de site ne s'affichent que
  // sous le seuil d'apparition des noms de secteur (zoom <
  // ZOOM_LABELS_SECTEUR), voir appliquerVisibiliteSites. À trancher dès
  // maintenant (le cadrage initial peut déjà être au seuil) puis à chaque
  // zoom.
  etat.map.on('zoom', appliquerVisibiliteSites);
  appliquerVisibiliteSites();
  etat.map.on('moveend', appliquerAntiCollisionSites);
  etat.map.on('zoomend', appliquerAntiCollisionSites);
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
export function ajouterLabelsDeSecteur(geojson) {
  etat.labelsSecteurs = ajouterLabelsSecteurs(etat.map, geojson, (cle) => ouvrirFalaise(cle));
  etat.map.on('zoom', appliquerVisibiliteSecteurs);
  etat.map.on('moveend', appliquerAntiCollisionSecteurs);
  etat.map.on('zoomend', appliquerAntiCollisionSecteurs);
  appliquerVisibiliteSecteurs();

  // Survol d'un cercle -> surbrillance de l'étiquette qu'un clic au même
  // point activerait (même bascule de zoom que le clic ci-dessus) : sans
  // ça, les deux figurés d'une même cible réagissaient différemment à la
  // souris. Map plutôt qu'un .find() à chaque mousemove (évènement
  // fréquent, un .find() y répéterait un parcours linéaire en continu).
  const labelSecteurParCle = new Map(etat.labelsSecteurs.map((l) => [l.cle, l.el]));
  const labelSiteParNom = new Map(etat.labelsSites.map((l) => [l.site, l.el]));
  let elementSurvole = null;
  const survoler = (el) => {
    if (el === elementSurvole) return;
    elementSurvole?.classList.remove('survole');
    elementSurvole = el || null;
    elementSurvole?.classList.add('survole');
  };
  etat.map.on('mousemove', 'falaises', (e) => {
    const cle = e.features[0]?.properties.cle;
    if (!cle) { survoler(null); return; }
    survoler(etat.map.getZoom() >= ZOOM_LABELS_SECTEUR
      ? labelSecteurParCle.get(cle)
      : labelSiteParNom.get(etat.index.get(cle)?.p.site));
  });
  etat.map.on('mouseleave', 'falaises', () => survoler(null));
}

// --- Centrer sur le(s) résultat(s) de recherche ---
// Action explicite (bouton ou Entrée), jamais automatique pendant la frappe :
// on ne veut pas faire sauter la carte à chaque caractère tapé.
export function centrerSurRecherche() {
  const q = etat.filtres.recherche;
  if (!q) return;
  // Choisir un résultat depuis le panneau "Filtres" mobile doit ramener
  // sur la carte pour le voir — sinon la caméra bouge derrière un panneau
  // qui reste affiché, et le résultat semble n'avoir rien fait.
  definirVueMobile('carte');
  // Le clavier mobile est encore ouvert : le prochain tap servirait à le
  // fermer plutôt qu'à atteindre sa cible. Bug constaté — après une
  // recherche, le lien « voir sur la carte » du parking restait sans effet.
  if (recherche) recherche.blur();
  const correspondances = etat.entries.filter((e) => e.cat === 'falaise' && e.recherche.includes(q));
  if (!correspondances.length) return;

  if (correspondances.length === 1) {
    allerVers(correspondances[0].cle, undefined, true);
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  correspondances.forEach((e) => bounds.extend(e.marker ? e.marker.getLngLat() : [e.lon, e.lat]));
  reinitialiserPadding(etat.map);
  // Pas de duration explicite, même raison que zoomerSurSite.
  etat.map.fitBounds(bounds, { padding: margeToutVoir(), maxZoom: 16, ...dureeReduite() });
}

// Clic sur la carte : ouvre/ferme les fiches. Un seul écouteur, voir le
// commentaire plus bas.
export function cablerClicCarte() {
  const MARGE_TACTILE_FALAISE = 18;
  function falaiseAuPoint(point) {
    const direct = etat.map.queryRenderedFeatures(point, { layers: ['falaises'] })[0];
    if (direct) return direct.properties.cle;
    if (!window.matchMedia('(pointer: coarse)').matches) return undefined;
    const zone = [
      [point.x - MARGE_TACTILE_FALAISE, point.y - MARGE_TACTILE_FALAISE],
      [point.x + MARGE_TACTILE_FALAISE, point.y + MARGE_TACTILE_FALAISE],
    ];
    const candidats = etat.map.queryRenderedFeatures(zone, { layers: ['falaises'] });
    if (!candidats.length) return undefined;
    const distance = (f) => {
      const p = etat.map.project(f.geometry.coordinates);
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
  etat.map.on('click', (e) => {
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
      if (etat.map.getZoom() >= ZOOM_LABELS_SECTEUR) {
        ouvrirFalaise(cle);
      } else {
        const entree = etat.index.get(cle);
        if (entree) {
          etat.map.stop();
          reinitialiserPadding(etat.map);
          etat.map.flyTo({
            center: [entree.lon, entree.lat],
            zoom: Math.max(etat.map.getZoom(), ZOOM_LABELS_SECTEUR),
            padding: margeToutVoir(),
            ...dureeReduite(),
          });
        }
      }
    } else if (etat.popupOuverte && !(estDesktop() && etat.popupOuverte.estPanneauFalaise)) {
      // Une popup FLOTTANTE (parking/gîte, ou fiche falaise mobile) est
      // ouverte : on ne ferme QUE celle-là. Les popups sont créées avec
      // closeOnClick:false (voir marqueurs.js) précisément pour reprendre
      // la main ici : sur desktop, une popup parking peut être affichée
      // PAR-DESSUS le panneau falaise resté ouvert — la fermer ne doit PAS
      // fermer le panneau (sur mobile, même résultat qu'avant — le
      // closeOnClick natif — mais centralisé).
      etat.popupOuverte.remove();
      // Le 'close' de la popup a remis toutes les falaises en pleine
      // opacité (enSurbrillance(null)). Si le panneau falaise est resté
      // ouvert (desktop), on restaure la surbrillance de la falaise
      // sélectionnée (+ ses parkings) : la relation parking -> falaises
      // qu'on vient de refermer reste ainsi visible à l'écran, la card
      // falaise restant ouverte.
      if (estDesktop() && panneauFalaiseOuvert() && etat.falaiseSelectionneeCle) {
        const entree = etat.index.get(etat.falaiseSelectionneeCle);
        if (entree) enSurbrillance([etat.falaiseSelectionneeCle, ...entree.parkingAssocie]);
      }
    } else if (panneauFalaiseOuvert()) {
      // Aucune popup flottante, mais le panneau desktop est ouvert : le
      // clic sur le vide le ferme (équivalent du closeOnClick natif d'une
      // vraie maplibregl.Popup, à recréer explicitement puisque le panneau
      // n'en est pas une). État du panneau lu dans le DOM
      // (panneauFalaiseOuvert), pas dans popupOuverte.estPanneauFalaise.
      fermerPanneauFalaise(etat.map, ctxPanneau);
    }
  });
}

export function cablerNavigation() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Échap ferme d'abord le NIVEAU LE PLUS PROFOND, comme "← Retour"/la
      // croix : le détail des voies s'il est ouvert (retour à la fiche,
      // popup/panneau gardé ouvert), sinon la fiche/popup elle-même — jamais
      // les deux d'un coup. Un 2e Échap juste après ferme alors le niveau
      // suivant normalement.
      const popupEl = popupElementCourant();
      if (popupEl && popupEl.classList.contains('mode-detail-voies')) {
        masquerDetailVoies(popupEl, etat.ficheReduite);
        return;
      }
      // Ferme d'abord une éventuelle popup flottante (parking/gîte), puis le
      // panneau falaise s'il reste ouvert. L'état du panneau est lu dans le
      // DOM (panneauFalaiseOuvert), pas dans popupOuverte : une popup
      // parking/gîte ouverte par-dessus le panneau écrase popupOuverte sans
      // fermer le panneau, qui resterait sinon fermable seulement par son
      // bouton ×.
      if (etat.popupOuverte && !(estDesktop() && etat.popupOuverte.estPanneauFalaise)) {
        etat.popupOuverte.remove();
      } else if (panneauFalaiseOuvert()) {
        fermerPanneauFalaise(etat.map, ctxPanneau);
      }
    }
  });

  // Actions du contenu des fiches (poignée, détail des voies, tri, GPS,
  // partage, navigation) : voir actions-fiche.js. Extrait d'ici parce que ce
  // répartiteur de 120 lignes ne touchait que trois variables de cette
  // closure — d'où les quatre rappels ci-dessous, et rien de plus.
  cablerActionsFiche({
    urlRoute: (id) => etat.baseRoutes + id + '.json',
    lireFicheReduite: () => etat.ficheReduite,
    ecrireFicheReduite: (v) => { etat.ficheReduite = v; },
    popupCourante: () => etat.popupOuverte,
    allerVers,
  });
}
