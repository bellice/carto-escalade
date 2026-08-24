// symboles.js — cercles proportionnels des falaises (taille, remplissage,
// légende) : la traduction visuelle des grandeurs quantitatives du mode
// "Cercles" en figurés ponctuels sur la carte.

import { escapeHtml } from './utils.js';
import { estFalaiseVideDansMode } from './donnees.js';

// Rayon min/max des cercles proportionnels (falaises) — taille VISUELLE
// réelle, cf. CIBLE_TACTILE_MIN ci-dessous pour la zone cliquable (les deux
// sont découplés : réduire RAYON_MIN n'affecte pas la cible tactile).
// Diamètre 14px → 52px (ratio ~3.7, ~14x en surface) : nettement plus
// contrasté que l'ancien 24px → 52px (ratio ~2, ~4.7x), hérité d'une époque
// où RAYON_MIN devait lui-même garantir une cible tactile correcte — ce
// n'est plus le cas depuis poserTailleMarqueur().
const RAYON_MIN = 7;
const RAYON_MAX = 26;

// Cible tactile minimale (repère Apple/Google), indépendante de la taille
// visuelle du marqueur (cercle proportionnel, losange gîte, rond parking) —
// un petit cercle proportionnel doit rester facile à taper du doigt.
const CIBLE_TACTILE_MIN = 44;

// Pose la taille d'un marqueur : la zone tactile (el, l'élément externe posé
// par MapLibre) fait au moins CIBLE_TACTILE_MIN, le disque/losange visuel
// (visuel, l'enfant centré dedans) garde sa vraie taille, potentiellement
// plus petite.
export function poserTailleMarqueur(el, visuel, diametre) {
  const cote = Math.max(CIBLE_TACTILE_MIN, diametre);
  el.style.width = cote + 'px';
  el.style.height = cote + 'px';
  visuel.style.width = diametre + 'px';
  visuel.style.height = diametre + 'px';
}

// Rayon proportionnel à la valeur (donc à la surface, pas au rayon, comme la
// racine carrée classique) — mais avec la correction de Flannery : James
// Flannery (1971) a montré empiriquement que les lecteurs de carte
// sous-estiment perceptuellement la taille des grands cercles par rapport
// aux petits sous un exposant 0.5 strict. Son exposant empirique (0.5716)
// accentue légèrement l'écart entre petites et grandes valeurs pour mieux
// correspondre à la perception réelle.
const EXPOSANT_FLANNERY = 0.5716;

function calculerRayon(valeur, max) {
  if (!max) return RAYON_MIN;
  return RAYON_MIN + (RAYON_MAX - RAYON_MIN) * Math.pow((valeur || 0) / max, EXPOSANT_FLANNERY);
}

// Remplissage représentatif d'un mode (couleur unie). Utilisée à la fois par
// dessinerFalaise() pour les vrais marqueurs ET par construireLegendeFalaises()
// pour les cercles de référence : une seule source de vérité, sinon la
// légende peut afficher une couleur différente de ce qui est réellement sur
// la carte.
//
// Pas de mode combiné "type de voie" (couenne+grande voie sur un même
// marqueur) : testé en camembert proportionnel (conic-gradient), retiré —
// couenne/grande voie est une variable catégorielle (nominale), qui se code
// par la teinte (Bertin), pas par un diagramme en secteurs (l'œil compare
// mal les angles/aires, Cleveland & McGill — encore plus vrai en petits
// multiples sur une carte). Vérifié sur les vraies données avant de trancher
// entre "retirer" et "remplacer par un code couleur à 3 classes" : près de
// la moitié des falaises (48/109) sont mixtes couenne+grande voie — un code
// couleur à 3 classes (couenne/grande voie/mixte) aurait perdu leur ratio
// réel sans gagner grand-chose en retour. Les deux modes "Couenne" et
// "Grande voie" (déjà ci-dessous, cercles pleins sans ambiguïté) couvrent
// déjà le besoin séparément.
function remplissagePourMode(mode) {
  if (mode === 'couenne') return 'var(--couenne)';
  if (mode === 'gv') return 'var(--gv)';
  if (mode === 'faciles') return 'var(--forest)'; // vert = facile, convention courante en sports outdoor
  return 'var(--clay)';
}

// Quelle grandeur (max + médiane) affiche la mini-légende selon le mode courant.
export function infosLegendePourMode(mode, maxima) {
  const remplissage = remplissagePourMode(mode);
  if (mode === 'couenne') return { max: maxima.couenne, median: maxima.couenneMedian, titre: 'Falaises (couenne)', remplissage };
  if (mode === 'gv') return { max: maxima.gv, median: maxima.gvMedian, titre: 'Falaises (grande voie)', remplissage };
  if (mode === 'faciles') return { max: maxima.faciles, median: maxima.facilesMedian, titre: 'Falaises (voies 5-6a+)', remplissage };
  return { max: maxima.total, median: maxima.totalMedian, titre: 'Falaises (voies)', remplissage };
}

// Redessine une falaise selon le mode choisi dans le sélecteur "Cercles".
// La taille encode toujours UNE seule grandeur quantitative à la fois (cf.
// sémiologie graphique) — laquelle dépend du mode : nombre de voies total,
// ou nombre en couenne/grande voie/faciles (≤6a+) seul quand on veut comparer
// spécifiquement une sous-catégorie entre falaises (comptage brut, pas une
// proportion — plus lisible et plus actionnable pour la logistique que "part
// de voies faciles", qui masquait la taille réelle du secteur). Le
// remplissage suit la même logique : uni / teinte dédiée par sous-catégorie
// / teinte répartie (grande voie-couenne, catégorielle donc couleur, pas
// taille).
// Grandeur affichée par la taille selon le mode "Cercles" courant — factorisé
// ici (plutôt qu'en dur dans dessinerFalaise) car carte.js en a aussi besoin
// pour trier les cercles par taille avant de les empiler (voir
// trierCerclesParTaille), sans dupliquer ce mapping mode -> propriété.
export function valeurPourMode(entree, mode) {
  return mode === 'couenne' ? entree.nbCouenne
    : mode === 'gv' ? entree.nbGrandeVoie
    : mode === 'faciles' ? entree.nbFaciles
    : entree.nbVoies;
}

export function dessinerFalaise(entree, mode, maxima) {
  const el = entree.marker.getElement();
  const visuel = el.querySelector('.marqueur-visuel');

  const valeur = valeurPourMode(entree, mode);

  const estVide = estFalaiseVideDansMode(entree, mode);
  el.classList.toggle('marqueur-invisible', estVide); // cache la cible tactile entière
  if (estVide) return;

  // Échelle commune à tous les modes (maxima.total, jamais le max du thème
  // affiché) : une même falaise garde une taille comparable d'un mode à
  // l'autre. Contrepartie assumée pour un thème peu présent au global (ex.
  // grande voie) : même sa meilleure falaise reste visuellement modeste —
  // c'est une lecture honnête ("peu présent ici"), pas un défaut.
  const rayon = calculerRayon(valeur, maxima.total);
  poserTailleMarqueur(el, visuel, rayon * 2);

  visuel.style.background = remplissagePourMode(mode);
}

// Mini-légende à cercles de référence (min / médiane / max de la grandeur
// affichée — 3 repères, pas 2, pour pouvoir interpoler une valeur intermédiaire
// à l'œil), convention standard pour une carte à symboles proportionnels.
// Le rayon de chaque repère passe par calculerRayon(), la même formule que
// pour les marqueurs réels : sinon le repère "1" ne correspondrait pas à la
// taille qu'aurait une vraie falaise à 1 voie sur la carte.
export function construireLegendeFalaises(max, median, titre, remplissage, simplifie, echelle) {
  // Pastille "Falaises" (à côté de Parkings/Gîte dans .legende-cats),
  // couleur du mode "Cercles" actif.
  const zoneFalaises = document.getElementById('cle-falaises-zone');
  if (zoneFalaises) {
    zoneFalaises.innerHTML = `<span class="cle"><span class="dot" style="background:${remplissage}"></span> Falaises</span>`;
  }

  const conteneur = document.getElementById('legende-falaises');
  if (!conteneur) return;
  if (!max) { conteneur.innerHTML = ''; return; }
  // Sous ZOOM_SIMPLIFICATION, les falaises sont de petits points uniformes
  // (voir .zoom-eloigne) : des cercles de référence proportionnels seraient
  // trompeurs puisque rien de tel n'est réellement affiché à cette échelle.
  if (simplifie) {
    conteneur.innerHTML = `
      <span class="legende-titre">Falaises</span>
      <span class="legende-note">Zoomez pour voir la taille proportionnelle</span>`;
    return;
  }
  // "max"/"median" restent propres au thème affiché (1/médiane/max réels de
  // ce thème, pour des repères parlants) — mais leur RAYON se calcule sur
  // "echelle" (toujours maxima.total) : même une falaise au max de son
  // thème peut donc rester visuellement modeste si ce thème est peu présent
  // au global (ex. grande voie) — cohérent avec dessinerFalaise().
  const repere = (valeur) => `
    <span class="repere-taille">
      <span class="cercle-repere" style="width:${calculerRayon(valeur, echelle) * 2}px; height:${calculerRayon(valeur, echelle) * 2}px;"></span>
      <span>${valeur}</span>
    </span>`;
  const valeurs = (median > 0 && median < max) ? [1, median, max] : [1, max];
  conteneur.innerHTML = `
    <span class="legende-titre">${escapeHtml(titre)}</span>
    <div class="reperes-taille">
      ${valeurs.map(repere).join('')}
    </div>`;
}
