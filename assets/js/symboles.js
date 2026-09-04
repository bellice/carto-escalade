// symboles.js — cercles proportionnels des falaises (taille, remplissage,
// légende) : la traduction visuelle des grandeurs quantitatives du mode
// "Cercles" en figurés ponctuels sur la carte.

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
// couleurFalaisePourMode() (couche native MapLibre — qui résout le var(--...)
// en hex, MapLibre n'acceptant pas var() dans les expressions de style) et
// par construireLegendeFalaises() pour les cercles de référence : une seule
// source de vérité, sinon la légende peut afficher une couleur différente de
// ce qui est réellement sur la carte.
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
  // Mode fourchette : même vert que l'ancien mode « voies faciles » qu'il
  // remplace — la grandeur reste « des voies à ma portée », seule la borne
  // change (réglable au lieu de figée à 6a+).
  if (mode === 'cotation') return 'var(--cotation)';
  return 'var(--clay)';
}

// Quelle grandeur (max + médiane) affiche la mini-légende selon le mode courant.
export function infosLegendePourMode(mode, maxima) {
  const remplissage = remplissagePourMode(mode);
  if (mode === 'couenne') return { max: maxima.couenne, median: maxima.couenneMedian, remplissage };
  if (mode === 'gv') return { max: maxima.gv, median: maxima.gvMedian, remplissage };
  if (mode === 'cotation') return { max: maxima.fourchette, median: maxima.fourchetteMedian, remplissage };
  return { max: maxima.total, median: maxima.totalMedian, remplissage };
}

// Redessine une falaise selon le mode choisi dans le sélecteur "Cercles".
// La taille encode toujours UNE seule grandeur quantitative à la fois (cf.
// sémiologie graphique) — laquelle dépend du mode : nombre de voies total,
// ou nombre en couenne / grande voie / dans la fourchette de cotation seul,
// quand on veut comparer spécifiquement une sous-catégorie entre falaises
// (comptage brut, pas une proportion — plus lisible et plus actionnable pour
// la logistique qu'une "part", qui masquait la taille réelle du secteur). Le
// remplissage suit la même logique : uni / teinte dédiée par sous-catégorie
// / teinte répartie (grande voie-couenne, catégorielle donc couleur, pas
// taille).
// Grandeur encodée par la taille selon le mode "Cercles" courant — factorisé
// ici car carte.js en a aussi besoin (construireSourceFalaises, tri par
// valeur décroissante dans la source), sans dupliquer ce mapping mode ->
// propriété.
function valeurPourMode(entree, mode) {
  return mode === 'couenne' ? entree.nbCouenne
    : mode === 'gv' ? entree.nbGrandeVoie
    : mode === 'cotation' ? entree.nbDansFourchette
    : entree.nbVoies;
}

// Couleur "plume" d'un mode pour la COUCHE NATIVE MapLibre. remplissagePourMode
// renvoie un var(--...) : parfait pour le DOM/la légende, mais MapLibre ne
// résout pas var() dans les expressions de style (circle-color). On lit donc
// la valeur calculée de la variable une fois (les couleurs sont fixes).
export function couleurFalaisePourMode(mode) {
  const nom = remplissagePourMode(mode);
  if (!nom.startsWith('var(')) return nom;
  const nomVar = nom.slice(4, -1).trim();
  return getComputedStyle(document.documentElement).getPropertyValue(nomVar).trim() || '#a8452f';
}

// Construit la FeatureCollection GeoJSON de la couche native "falaises"
// (rendu GPU, plus de marqueurs DOM — voir carte.js) : une feature par falaise
// VISIBLE pour le mode "Cercles" courant (celles vidées par le thème en sont
// exclues, comme l'ancienne classe marqueur-invisible). Chaque feature porte
// ce qu'il faut pour le rendu data-driven ET les filtres :
//  - cle : identifiant stable (promoteId) pour le feature-state (surbrillance)
//  - r : rayon en px (formule de Flannery, PRÉCALCULÉE — pas d'opérateur
//    puissance dans les expressions de style)
//  - valeur : pour l'ordre de dessin et la légende
//  - recherche : texte bas-de-casse pour le filtre de recherche
//  - tempsGite : null si inconnu (filtre "Depuis le gîte")
// Triées par valeur DÉCROISSANTE : le plus petit est peint en dernier (dessus),
// même règle que l'ancien réordonnancement DOM des cercles.
export function construireSourceFalaises(entries, mode, maxima) {
  const features = [];
  entries.forEach((entree) => {
    if (entree.cat !== 'falaise') return;
    if (estFalaiseVideDansMode(entree, mode)) return;
    const valeur = valeurPourMode(entree, mode);
    features.push({
      type: 'Feature',
      properties: {
        cle: entree.cle,
        valeur,
        r: calculerRayon(valeur, maxima.total),
        recherche: entree.recherche,
        tempsGite: entree.tempsGite ?? null,
      },
      geometry: { type: 'Point', coordinates: [entree.lon, entree.lat] },
    });
  });
  features.sort((a, b) => b.properties.valeur - a.properties.valeur);
  return { type: 'FeatureCollection', features };
}

// Mini-légende à cercles de référence (min / médiane / max de la grandeur
// affichée — 3 repères, pas 2, pour pouvoir interpoler une valeur intermédiaire
// à l'œil), convention standard pour une carte à symboles proportionnels.
// Le rayon de chaque repère passe par calculerRayon(), la même formule que
// pour les marqueurs réels : sinon le repère "1" ne correspondrait pas à la
// taille qu'aurait une vraie falaise à 1 voie sur la carte.
export function construireLegendeFalaises(max, median, remplissage, simplifie, echelle) {
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
      <span class="legende-note">Zoomez pour voir la taille proportionnelle</span>`;
    return;
  }
  // "max"/"median" restent propres au thème affiché (1/médiane/max réels de
  // ce thème, pour des repères parlants) — mais leur RAYON se calcule sur
  // "echelle" (toujours maxima.total) : même une falaise au max de son
  // thème peut donc rester visuellement modeste si ce thème est peu présent
  // au global (ex. grande voie) — cohérent avec construireSourceFalaises().
  const repere = (valeur) => `
    <span class="repere-taille">
      <span class="cercle-repere" style="width:${calculerRayon(valeur, echelle) * 2}px; height:${calculerRayon(valeur, echelle) * 2}px;"></span>
      <span>${valeur}</span>
    </span>`;
  const valeurs = (median > 0 && median < max) ? [1, median, max] : [1, max];
  conteneur.innerHTML = `
    <div class="reperes-taille">
      ${valeurs.map(repere).join('')}
    </div>`;
}
