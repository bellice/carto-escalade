// filtres.js — réglages de la légende : pratique, type de voie, cotation,
// ensoleillement, temps depuis le gîte, remise à zéro.

import { JETON_URL_STYLE, etat, filtreCotationActif } from './etat.js';
import {
  majCouleurCercles, rafraichirLegendeFalaises, redessinerSource,
} from './couche-falaises.js';
import { appliquerAntiCollisionSecteurs, appliquerFiltresEtSecteurs } from './visibilite.js';
import {
  STYLES, approximerCotation, compterCroiseDansFourchette, compterDansFourchette, cotationVersValeur, valeurCotationApprochee, valeurSelection,
} from './donnees.js';
import { escapeHtml } from './utils.js';
import { definirSelectionVoies } from './marqueurs.js';

const filtreTemps = document.getElementById('filtre-temps');
const filtreTempsValeur = document.getElementById('filtre-temps-valeur');
const legendeTemps = document.getElementById('legende-temps');
const legendeEnsoleillement = document.getElementById('legende-ensoleillement');
const legendeStyle = document.getElementById('legende-style');
const btnReinitialiserFiltres = document.getElementById('reinitialiser-filtres');
const btnVueFiltres = document.getElementById('btn-vue-filtres');
const casesTypeVoie = document.querySelectorAll('#legende-type-voie input[data-type-voie]');
const btnEpuree = document.querySelector('.btn-epuree');
const selectCotationMin = document.getElementById('cotation-min');
const selectCotationMax = document.getElementById('cotation-max');

// Remet le seuil "Depuis le gîte" à son plafond (= aucune falaise
// exclue) — utilisé par "Tout voir" et par allerVers() quand la cible
// d'une navigation serait autrement masquée par ce filtre.
export function reinitialiserFiltreTemps() {
  etat.filtres.tempsMaxGite = etat.filtres.tempsGitePlafond;
  if (filtreTemps) filtreTemps.value = String(etat.filtres.tempsGitePlafond);
  if (filtreTempsValeur && Number.isFinite(etat.filtres.tempsGitePlafond)) {
    filtreTempsValeur.textContent = `≤ ${etat.filtres.tempsGitePlafond} min`;
  }
  rafraichirBoutonReinitialiserFiltres();
}

// Remet le filtre "Ensoleillement" à "Peu importe" — même usage que
// reinitialiserFiltreTemps ("Tout voir" et allerVers quand la cible serait
// masquée par le filtre courant).
export function reinitialiserFiltreEnsoleillement() {
  etat.filtres.ensoleillement = [];
  if (!legendeEnsoleillement) return;
  legendeEnsoleillement.querySelectorAll('input[data-ensoleillement]').forEach((case_) => {
    case_.checked = false;
  });
  rafraichirBoutonReinitialiserFiltres();
}

// Remet "Pratique" sur "Tous" et retire ?pratique= de l'URL. Ne redessine
// pas les cercles : l'appelant enchaîne avec definirModeFigure (qui
// reconstruit la source, taille comprise) — à appeler AVANT lui.
export function reinitialiserFiltreStyle() {
  etat.filtres.pratique = 'tous';
  if (legendeStyle) {
    const tous = legendeStyle.querySelector('input[data-style="tous"]');
    if (tous) tous.checked = true;
  }
  synchroniserUrlStyle();
  rafraichirBoutonReinitialiserFiltres();
}

// Reflète la pratique choisie dans ?pratique= sans ajouter d'entrée
// d'historique et sans toucher aux autres paramètres (?falaise=). Échec
// silencieux : un contexte sans History API garde son filtre, seulement sans
// lien partageable.
function synchroniserUrlStyle() {
  try {
    const url = new URL(location.href);
    if (etat.filtres.pratique !== 'tous') {
      url.searchParams.set('pratique', JETON_URL_STYLE[etat.filtres.pratique]);
    } else {
      url.searchParams.delete('pratique');
    }
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch { /* pas de History API : filtre gardé, lien non mis à jour */ }
}

// Remet la fourchette de cotation à l'amplitude complète (= aucune falaise
// exclue) — même usage que reinitialiserFiltreTemps : "Tout voir",
// "Réinitialiser", et allerVers quand la cible serait masquée par la
// fourchette courante. No-op si cette sortie n'a pas de cotation.
export function reinitialiserFiltreCotation() {
  if (!Number.isFinite(etat.filtres.cotationPlancher)) return;
  const selMin = document.getElementById('cotation-min');
  const selMax = document.getElementById('cotation-max');
  if (selMin && selMin.options.length) selMin.selectedIndex = 0;
  if (selMax && selMax.options.length) selMax.selectedIndex = selMax.options.length - 1;
  // majFourchette resynchronise filtres.cotationMin/Max sur les <select>
  // qu'on vient de remettre à leurs extrêmes et recalcule nbDansFourchette.
  majFourchette();
  redessinerSource();
  rafraichirLegendeFalaises();
  rafraichirBoutonReinitialiserFiltres();
}

// Grise "Réinitialiser" (jamais re-caché après le chargement : voir
// chargerDonnees) tant qu'aucun des filtres qu'il traite n'est actif — rien
// à réinitialiser. "Type de voie" et "Cotation des voies" comptent : eux
// aussi masquent des falaises derrière (estFalaiseVideDansMode et
// compterDansFourchette, donnees.js), pas seulement une histoire de taille
// de cercle. Ils sont indépendants l'un de l'autre (combinables),
// donc valent chacun 1 : un "Couenne" + une fourchette resserrée comptent 2.
// Recherche exclue : "Tout voir" la traite déjà séparément, et elle ne
// "reste" jamais active de la même façon (elle se vide au moindre clic
// ailleurs). Appelé après chaque changement d'un de ces filtres —
// reinitialiserFiltreTemps/reinitialiserFiltreEnsoleillement/
// reinitialiserFiltreCotation/definirModeFigure/appliquerFiltreCotation
// (elles-mêmes appelées aussi par "Tout voir" et allerVers) — pour que le
// bouton se regrise avec eux. Même décompte affiché sur le bouton "Filtres"
// — bascule mobile ET repli desktop (voir son texte, .legende-toggle-texte).
function rafraichirBoutonReinitialiserFiltres() {
  const nActifs = (etat.filtres.ensoleillement.length > 0 ? 1 : 0)
    + (etat.filtres.pratique !== 'tous' ? 1 : 0)
    + (etat.filtres.tempsMaxGite < etat.filtres.tempsGitePlafond ? 1 : 0)
    + (etat.modeFigureActuel !== 'aucun' ? 1 : 0)
    + (filtreCotationActif() ? 1 : 0);
  if (btnReinitialiserFiltres) btnReinitialiserFiltres.disabled = nActifs === 0;
  const libelle = nActifs > 0 ? `Filtres · ${nActifs}` : 'Filtres';
  if (btnVueFiltres) btnVueFiltres.textContent = libelle;
  const texteToggleDesktop = document.querySelector('.legende-toggle-texte');
  if (texteToggleDesktop) texteToggleDesktop.textContent = libelle;
}

// Un seul bouton pour tout ce qui masque une falaise (Ensoleillement,
// Depuis le gîte, Type de voie ET Cotation des voies — choisir "Couenne" ou
// resserrer une fourchette filtre tout autant que cocher "Matin", voir
// estFalaiseVideDansMode et compterDansFourchette dans donnees.js) : plus
// rapide que défaire chaque réglage un par un. Recherche exclue : "Tout
// voir" la traite séparément.
export function configurerReinitialisationFiltres() {
  if (!btnReinitialiserFiltres) return;
  btnReinitialiserFiltres.addEventListener('click', () => {
    reinitialiserFiltreTemps();
    reinitialiserFiltreEnsoleillement();
    reinitialiserFiltreStyle();
    reinitialiserFiltreCotation();
    definirModeFigure('aucun');
    appliquerFiltresEtSecteurs();
  });
}

// Change le mode "Type de voie" (aucun/couenne/gv — la grandeur encodée par
// la taille des cercles) et redessine tout ce qui en dépend — utilisé par
// les boutons eux-mêmes et par allerVers (voir plus bas) : naviguer vers
// une falaise doit garantir qu'elle reste visible, quitte à sortir d'un
// thème qui l'aurait masquée (voir estFalaiseVideDansMode). "Cotation des
// voies" ne passe pas par ici : c'est un filtre indépendant qui se combine
// avec ce mode (voir appliquerFiltreCotation).
// synchroniserCases : faux quand l'appel vient des pastilles elles-mêmes
// (leur état est la source) ; vrai pour les appels de code (Réinitialiser,
// allerVers), qui les remettent d'accord.
export function definirModeFigure(nouveauMode, synchroniserCases = true) {
  etat.modeFigureActuel = nouveauMode;
  if (synchroniserCases) {
    casesTypeVoie.forEach((c) => { c.checked = c.dataset.typeVoie === nouveauMode; });
  }
  // Couche native : remplace les features (un mode en exclut certaines, voir
  // construireSourceFalaises, qui trie aussi les cercles par taille) et la
  // couleur du thème. La vue épurée en cours reste active.
  redessinerSource();
  majCouleurCercles();
  rafraichirLegendeFalaises();
  // Un changement de mode peut vider un thème entier (ex. "Grande voie" sur
  // un secteur 100% couenne) : le libellé de secteur n'a plus de figuré
  // ponctuel sous lui, voir appliquerAntiCollisionSecteurs. Les parkings
  // eux-mêmes sont retraités par appliquerFiltresEtSecteurs() (appelé par
  // le sélecteur après definirModeFigure).
  appliquerAntiCollisionSecteurs();
  rafraichirBoutonReinitialiserFiltres();
}

// Retire de la légende ce que CETTE sortie ne contient pas : un réglage qui
// ne peut rien changer vaut moins que pas de réglage du tout.
export function ajusterLegendeAuxDonnees(geojson) {
  // Les modes "Couenne"/"Grande voie" n'ont de sens que si au moins une
  // falaise a des voies typées. Relit les "entries" déjà construites
  // (nbGrandeVoie/nbCouenne précalculés à la génération, voir
  // export_geojson.py) plutôt que de rescanner le geojson brut une 2e fois.
  const auMoinsUneAvecType = etat.entries.some(e =>
    e.cat === 'falaise' && (valeurSelection(e, 'couenne') > 0 || valeurSelection(e, 'gv') > 0)
  );
  if (!auMoinsUneAvecType) {
    const typeVoie = document.getElementById('legende-type-voie');
    if (typeVoie) typeVoie.remove();
  }

  // La clé "Gîte" de la légende n'a de sens que si la sortie en a un.
  const aGite = geojson.features.some(f => f.properties.categorie === 'hebergement');
  if (!aGite) {
    const legendeGite = document.getElementById('legende-gite');
    if (legendeGite) legendeGite.remove();
  }
}

// Filtre "Depuis le gîte" : masqué par défaut (voir HTML, attribut hidden)
// tant qu'on n'a pas confirmé qu'au moins une falaise a un temps calculable
// — un slider sans borne réelle n'aurait rien à montrer. Bornes au multiple
// de 5, pour un pas net plutôt que des valeurs à la minute près.
export function configurerFiltreTemps(tempsDepuisGite) {
  const tempsValeurs = Array.from(tempsDepuisGite.values());
  if (!tempsValeurs.length || !filtreTemps || !filtreTempsValeur || !legendeTemps) return;

  // Les deux bornes arrondissent au-dessus : un plancher arrondi vers le bas
  // (8 min donne 5) créerait un cran où aucune falaise ne passe. Ainsi la
  // position la plus basse garde au moins la falaise la plus proche.
  const plancher = Math.ceil(Math.min(...tempsValeurs) / 5) * 5;
  const plafond = Math.ceil(Math.max(...tempsValeurs) / 5) * 5;
  // Tous les trajets dans le même cran de 5 min : le curseur n'offrirait aucun
  // choix (Pen-Hir, parkings à 4 et 5 min du gîte). Un réglage qui ne peut
  // rien changer est retiré, comme les modes couenne/grande voie sans voie typée.
  if (plancher >= plafond) return;
  etat.filtres.tempsGitePlafond = plafond;
  etat.filtres.tempsMaxGite = plafond;
  filtreTemps.min = String(plancher);
  filtreTemps.max = String(plafond);
  filtreTemps.step = '5';
  filtreTemps.value = String(plafond);
  filtreTempsValeur.textContent = `≤ ${plafond} min`;
  legendeTemps.hidden = false;
  filtreTemps.addEventListener('input', () => {
    etat.filtres.tempsMaxGite = Number(filtreTemps.value);
    filtreTempsValeur.textContent = `≤ ${filtreTemps.value} min`;
    rafraichirBoutonReinitialiserFiltres();
    appliquerFiltresEtSecteurs();
  });
}

// Filtre "Pratique" (sportive / trad / artif) : masqué par défaut (voir HTML,
// attribut hidden) et montré seulement si au moins DEUX pratiques existent
// dans cette sortie : avec une seule (ou aucune, Cassis et La Ciotat) les
// choix donneraient le même résultat ou rien, même règle que
// configurerFiltreEnsoleillement. CHOIX UNIQUE (boutons radio en pastilles,
// "Tous" par défaut) : on vient pour une pratique, et une seule grandeur
// peut donner sa taille aux cercles (voir valeurSelection). ?pratique=trad
// à l'arrivée présélectionne le choix, sauf avec ?falaise= : la fiche
// ouverte ne doit pas se retrouver masquée par un filtre que le même lien a
// posé.
export function configurerFiltreStyle() {
  if (!legendeStyle) return;
  const choix = Array.from(legendeStyle.querySelectorAll('input[data-style]'));
  if (!choix.length) return;
  const presents = STYLES.filter((style) => etat.entries.some((e) => e.cat === 'falaise' && e.types.includes(style)));
  if (presents.length < 2) return;
  // Un choix pour une pratique absente de cette sortie ne retiendrait aucun
  // secteur : retiré plutôt que laissé inerte.
  choix.forEach((c) => {
    if (c.dataset.style !== 'tous' && !presents.includes(c.dataset.style)) c.closest('label').remove();
  });
  legendeStyle.hidden = false;

  const params = new URLSearchParams(location.search);
  const demande = params.get('pratique');
  const styleDemande = STYLES.find((s) => JETON_URL_STYLE[s] === demande);
  if (!params.has('falaise') && styleDemande && presents.includes(styleDemande)) {
    etat.filtres.pratique = styleDemande;
    choix.forEach((c) => { c.checked = c.dataset.style === styleDemande; });
    // La source des cercles dépend de la pratique (taille et secteurs
    // retenus) : à redessiner, pas seulement à filtrer.
    definirModeFigure(etat.modeFigureActuel, false);
  }

  choix.forEach((c) => {
    c.addEventListener('change', () => {
      if (!c.checked) return;
      etat.filtres.pratique = c.dataset.style;
      synchroniserUrlStyle();
      definirModeFigure(etat.modeFigureActuel, false);
      appliquerFiltresEtSecteurs();
    });
  });
}

// Filtre "Ensoleillement" : masqué par défaut (voir HTML, attribut hidden)
// tant qu'aucune falaise de la sortie n'a d'orientation exploitable — un
// filtre qui ne pourrait jamais retenir personne vaut moins que pas de
// filtre, même règle que configurerFiltreTemps.
export function configurerFiltreEnsoleillement() {
  if (!legendeEnsoleillement) return;
  const cases = legendeEnsoleillement.querySelectorAll('input[data-ensoleillement]');
  if (!cases.length) return;
  const exploitable = etat.entries.some((e) => e.cat === 'falaise' && e.ensoleillement !== 'aucune');
  if (!exploitable) return;
  legendeEnsoleillement.hidden = false;
  etat.falaisesSansOrientationConnue = etat.entries.some((e) => e.cat === 'falaise' && e.ensoleillement === 'aucune');
  // Cochables ensemble EN OU (voir le commentaire de filtres.ensoleillement),
  // mais deux groupes, pas un seul : "Matin/Journée/Après-midi" cherchent
  // tous du soleil (se combinent librement entre elles), "Non" cherche son
  // ABSENCE — une intention opposée, pas une nuance de la même recherche.
  // Cocher l'une décoche donc l'autre groupe en entier (Matin + Non
  // cochées ensemble ne voudrait rien dire).
  cases.forEach((case_) => {
    case_.addEventListener('change', () => {
      if (case_.checked) {
        const memeGroupe = (c) => (c.dataset.ensoleillement === 'nord') === (case_.dataset.ensoleillement === 'nord');
        cases.forEach((c) => {
          if (c !== case_ && !memeGroupe(c)) c.checked = false;
        });
      }
      etat.filtres.ensoleillement = Array.from(cases)
        .filter((c) => c.checked)
        .map((c) => c.dataset.ensoleillement);
      rafraichirBoutonReinitialiserFiltres();
      appliquerFiltresEtSecteurs();
    });
  });
}

// --- Fourchette de cotation ---
// Deux <select> plutôt qu'un curseur à deux poignées : aucun élément natif
// ne fait ça, et une version maison serait à la fois du code à maintenir et
// un piège d'accessibilité (cible tactile minuscule, inutilisable au
// clavier). Deux listes déroulantes sont natives, accessibles et lisibles
// au doigt — cohérent avec le parti « texte plutôt qu'icône » du site.

// Synchronise filtres.cotationMin/Max sur les <select> et recalcule
// nbDansFourchette (nombre de voies de la falaise dans la fourchette
// choisie) pour chaque falaise. Fait une seule fois par changement de
// bornes, plutôt qu'à la volée dans appliquerFiltres/construireSourceFalaises
// qui s'exécutent pour chaque falaise à chaque rendu de la couche.
function majFourchette() {
  if (!selectCotationMin || !selectCotationMax || !selectCotationMin.options.length) return;
  const min = Number(selectCotationMin.value);
  const max = Number(selectCotationMax.value);
  etat.filtres.cotationMin = min;
  etat.filtres.cotationMax = max;
  const actif = filtreCotationActif();
  etat.entries.forEach((entree) => {
    if (entree.cat !== 'falaise') return;
    if (!entree.cotationsParType) {
      entree.nbDansFourchette = compterDansFourchette(entree.cotations, min, max);
      return;
    }
    // Croisement exact : une voie compte si elle a la pratique, le type ET la
    // cotation choisis (voir valeurSelection).
    const dansBornes = compterCroiseDansFourchette(entree.cotationsParType, min, max);
    entree.nbParTypeFourchette = actif ? dansBornes : null;
    entree.nbDansFourchette = Object.values(dansBornes)
      .reduce((total, parType) => total + Object.values(parType).reduce((a, b) => a + b, 0), 0);
  });
}

// Applique la fourchette de cotation courante : filtre indépendant (pas un
// mode via definirModeFigure) qui se combine avec Pratique et "Type de
// voie". Reconstruit la source pour que les valeurs et nbDansFourchette, à
// jour, atteignent la couche (voir construireSourceFalaises /
// appliquerFiltres), puis relance la légende, la cascade de visibilité et le
// décompte du bouton "Réinitialiser".
function appliquerFiltreCotation() {
  majFourchette();
  redessinerSource();
  rafraichirLegendeFalaises();
  appliquerFiltresEtSecteurs();
  rafraichirBoutonReinitialiserFiltres();
}

// Peuple les deux listes avec les cotations RÉELLEMENT présentes dans la
// sortie, triées par difficulté. Proposer l'échelle complète 3a→9c+
// afficherait une quarantaine de crans dont la plupart ne correspondent à
// aucune voie ici — autant de choix qui ne feraient rien.
export function preparerFourchette() {
  if (!selectCotationMin || !selectCotationMax) return;
  const parValeur = new Map();
  etat.entries.forEach((entree) => {
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
    // Aucune cotation exploitable dans cette sortie : la section « Cotation
    // des voies » est retirée en bloc.
    const bloc = document.getElementById('legende-cotation');
    if (bloc) bloc.remove();
    return;
  }
  const options = crans.map(([valeur, libelle]) =>
    `<option value="${valeur}">${escapeHtml(libelle)}</option>`).join('');
  selectCotationMin.innerHTML = options;
  selectCotationMax.innerHTML = options;
  selectCotationMin.value = String(crans[0][0]);
  selectCotationMax.value = String(crans[crans.length - 1][0]);

  // Amplitude réelle des cotations de cette sortie : sert de repère
  // « inactif » à filtreCotationActif (au repos les deux bornes sont ici)
  // et de cible à reinitialiserFiltreCotation.
  etat.filtres.cotationPlancher = crans[0][0];
  etat.filtres.cotationPlafond = crans[crans.length - 1][0];
  etat.filtres.cotationMin = etat.filtres.cotationPlancher;
  etat.filtres.cotationMax = etat.filtres.cotationPlafond;

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
    // Filtre indépendant : on n'appelle pas definirModeFigure — resserrer
    // la fourchette ne doit pas désélectionner "Type de voie".
    appliquerFiltreCotation();
  };
  selectCotationMin.addEventListener('change', () => corriger('min'));
  selectCotationMax.addEventListener('change', () => corriger('max'));
  majFourchette();
}

export function cablerFiltres() {
  // Voies que le détail d'une fiche liste : celles que compte la taille des
  // cercles (valeurSelection), donc Pratique, Type de voie et fourchette de
  // cotation à la fois. Une voie dont la cotation ne se place pas sur l'échelle
  // française (artif pur "A1") n'est ni dans ni hors de la fourchette : elle
  // reste listée, signalée à part dans le titre, et ne compte pas dans les
  // cercles.
  definirSelectionVoies((voie, groupe) => {
    if (etat.filtres.pratique !== 'tous' && groupe !== etat.filtres.pratique) return false;
    if (etat.modeFigureActuel !== 'aucun' && (voie.type_voie === 'couenne' ? 'couenne' : 'gv') !== etat.modeFigureActuel) return false;
    if (!filtreCotationActif()) return true;
    const valeur = valeurCotationApprochee(voie.cotation ?? voie.cotation_artif);
    if (valeur == null) return 'sans-cote';
    return valeur >= etat.filtres.cotationMin && valeur <= etat.filtres.cotationMax;
  });

  // --- "Type de voie" (grandeur encodée par la taille des cercles) : choix
  // unique, comme "Pratique" — "Tous" (mode 'aucun'), "Couenne" ou "Grande
  // voie" (boutons radio en pastilles). Une falaise n'affiche qu'une grandeur
  // à la fois (voir symboles.js) : un seul type porte la taille et la couleur.
  // "Cotation des voies" juste en dessous est un filtre indépendant qui se
  // combine avec ce mode (fourchette 5a-6b + "Grande voie" = falaises avec
  // des grandes voies, dont au moins une voie cotée 5a-6b). ---
  casesTypeVoie.forEach((case_) => {
    case_.addEventListener('change', () => {
      if (!case_.checked) return;
      definirModeFigure(case_.dataset.typeVoie, false);
      // Une falaise sans donnée pour ce thème disparaît (source reconstruite
      // par construireSourceFalaises) — son parking ne doit pas rester
      // affiché seul, sans rien à proposer.
      appliquerFiltresEtSecteurs();
    });
  });

  // --- Bouton "Épurer" (taille uniforme, indépendant du mode ci-dessus) ---
  if (btnEpuree) {
    btnEpuree.addEventListener('click', () => {
      etat.epureeActuelle = !etat.epureeActuelle;
      // aria-pressed porte à la fois l'état accessible ET le style visuel
      // (voir .btn-epuree[aria-pressed="true"]) — une seule source de vérité
      // pour l'état, pas une classe CSS à garder synchronisée avec lui.
      btnEpuree.setAttribute('aria-pressed', String(etat.epureeActuelle));
      // Libellé = action à venir, comme Masquer/Afficher. "Proportionner" :
      // terme du module qui dessine ces cercles (voir l'en-tête de symboles.js).
      btnEpuree.textContent = etat.epureeActuelle ? 'Proportionner' : 'Épurer';
      btnEpuree.setAttribute('aria-label', etat.epureeActuelle
        ? 'Réafficher la taille des cercles'
        : "Simplifier l'affichage des cercles");
      redessinerSource();
      majCouleurCercles();
      rafraichirLegendeFalaises();
    });
  }
}
