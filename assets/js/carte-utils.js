// carte-utils.js — utilitaires de cadrage caméra et de contrôle carte,
// indépendants des marqueurs/popups.

// Marges mobile : recherche/légende flottantes (haut/bas), colonnes latérales
// réservées pour tout autre usage UI. Padding asymétrique passé à
// flyTo/fitBounds. Utilisées UNIQUEMENT sur mobile depuis la fusion de la
// recherche/légende/fiche falaise en une colonne latérale desktop (voir
// margeDesktop ci-dessous) — ex-MARGE_UI, valeurs inchangées.
const MARGE_MOBILE = { top: 120, bottom: 170, left: 70, right: 70 };

// Seuil desktop/mobile — même valeur que le CSS (@media max-width:640px,
// style-carte.css). Centralisé ici : avant, chaque appelant refaisait son
// propre window.matchMedia(...).
export function estDesktop() {
  return !window.matchMedia('(max-width: 640px)').matches;
}

// Largeur réelle des deux panneaux desktop, lue depuis leurs tokens CSS
// (--largeur-panneau-gauche/-droit, style.css) plutôt que dupliquée en dur
// ici — une seule source de vérité entre CSS et JS, comme
// couleurCss/COULEUR_ELOIGNE dans carte.js pour --clay.
function largeurToken(nom, repli) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nom);
  return parseInt(v, 10) || repli;
}
function largeurPanneauGauche() {
  return largeurToken('--largeur-panneau-gauche', 300);
}
function largeurPanneauDroit() {
  return largeurToken('--largeur-panneau-droit', 380);
}

// Marge de confort desktop générique (haut/bas/droite hors fiche ouverte) —
// reprend la même valeur que l'ex-MARGE_UI.left/right (70) : rien ne
// justifie qu'elle change maintenant que plus rien ne flotte en haut/bas de
// la carte sur desktop (recherche et légende vivent dans le panneau gauche
// compact, pas en overlay top/bottom comme sur mobile).
const CONFORT_DESKTOP = 70;

// Marge desktop de base : le panneau GAUCHE (recherche+légende) est
// PERMANENT — sa largeur est donc réservée pour TOUT cadrage desktop, y
// compris vers un parking/gîte (pas seulement une falaise) : sans ça, un
// marqueur pourrait finir caché dessous. Le panneau DROIT (fiche falaise),
// lui, reste CONTEXTUEL — sa largeur n'est réservée qu'à l'ouverture d'une
// fiche (voir margeAvantPopup(pourFalaiseDesktop) ci-dessous), pas en
// permanence.
function margeDesktop() {
  return { top: CONFORT_DESKTOP, bottom: CONFORT_DESKTOP, right: CONFORT_DESKTOP, left: largeurPanneauGauche() + CONFORT_DESKTOP };
}

// Variante de marge pour un cadrage immédiatement suivi d'une ouverture de
// fiche (voir allerVers/ouvrirFalaise dans carte.js) :
// - Mobile : la popup prend la forme d'une feuille du bas jusqu'à ~45vh (cf.
//   @media max-width:640px dans le CSS) — bien plus haute que les 170px
//   prévus pour la légende. Sans ce correctif, un marqueur pouvait finir
//   cadré pile là où la feuille allait le recouvrir. Recalculée à chaque
//   appel (pas une constante) : dépend de la hauteur d'écran réelle, qui peut
//   changer (rotation, redimensionnement).
//   top réduit à 24 (pas les 120 de MARGE_MOBILE) : ce top-là existe pour la
//   barre de recherche, qui SE MASQUE ELLE-MÊME tant qu'une fiche est ouverte
//   sur mobile (body.fiche-ouverte, voir le CSS) — puisqu'une popup va
//   justement s'ouvrir juste après cet appel, lui laisser 120px de trop en
//   plus des ~300+ déjà réservés en bas resserrait l'espace utile bien plus
//   que nécessaire (repéré après test : cadrage peu visible, voire absent,
//   sur petit écran).
// - Desktop : margeDesktop() (panneau gauche réservé), PLUS la largeur du
//   panneau droit ajoutée au right si pourFalaiseDesktop=true — c'est-à-dire
//   quand cette fiche va être une FALAISE (elle seule ouvre le panneau
//   droit ; parking/gîte restent en popup flottante classique, aucune
//   réservation supplémentaire nécessaire pour eux).
export function margeAvantPopup(pourFalaiseDesktop = false) {
  if (estDesktop()) {
    const base = margeDesktop();
    return pourFalaiseDesktop ? { ...base, right: largeurPanneauDroit() + CONFORT_DESKTOP } : base;
  }
  const bas = Math.min(window.innerHeight * 0.45, 380) + 16;
  return { ...MARGE_MOBILE, top: 24, bottom: bas };
}

// Un point (lon/lat) est-il dans la zone non couverte par le padding courant
// (marge de confort en plus, par défaut 24px) ? Utilisée pour décider si le
// panneau falaise desktop doit repositionner la caméra à l'ouverture, ou si
// la falaise cliquée est déjà visible dans l'espace restant (évite un
// easeTo de recentrage superflu quand allerVers a déjà cadré la cible avant
// d'ouvrir la fiche).
export function estPointVisible(map, lon, lat, padding, marge = 24) {
  const rect = map.getContainer().getBoundingClientRect();
  const point = map.project([lon, lat]);
  return point.x >= padding.left + marge && point.x <= rect.width - padding.right - marge &&
    point.y >= padding.top + marge && point.y <= rect.height - padding.bottom - marge;
}

// Marge pour un cadrage "vue d'ensemble" (chargement initial, bouton "Tout
// voir", clic sur un nom de site, recherche à résultats multiples) :
// - Desktop : margeDesktop() — seul le panneau gauche (permanent) est
//   réservé ; une "vue d'ensemble" n'ouvre jamais le panneau droit
//   (contextuel, réservé uniquement par margeAvantPopup(true)).
// - Mobile : mesure la VRAIE hauteur occupée à l'écran par le panneau
//   légende (flottant en bas, inchangé sur mobile) plutôt que de deviner un
//   chiffre fixe — MARGE_MOBILE.bottom (170) avait été réglé pour une légende
//   plus courte qu'aujourd'hui, et redeviendrait obsolète à chaque futur
//   ajout dans ce panneau sans cette mesure. Recalculée à chaque appel : la
//   légende peut être repliée/dépliée entre deux appels, la hauteur d'écran
//   peut changer (rotation).
//   Repli sur MARGE_MOBILE.bottom si la légende est présente dans le DOM
//   mais MASQUÉE (offsetParent === null) : body.fiche-ouverte lui applique
//   display:none tant qu'une fiche reste ouverte (voir le CSS) — un élément
//   display:none renvoie un getBoundingClientRect() à zéro, donc top=0, ce
//   qui aurait donné bas≈innerHeight (quasi tout l'écran). Bug réel constaté :
//   cliquer un libellé de site (qui recadre via margeToutVoir) pendant que la
//   fiche falaise est ouverte sur mobile ne faisait plus rien — le padding
//   obtenu dépassait la hauteur du conteneur, MapLibre abandonnait
//   silencieusement le fitBounds (même défaillance déjà documentée plus bas,
//   voir reinitialiserPadding).
export function margeToutVoir() {
  if (estDesktop()) return margeDesktop();
  const legende = document.querySelector('.legende');
  const legendeVisible = legende && legende.offsetParent !== null;
  const bas = legendeVisible ? Math.round(window.innerHeight - legende.getBoundingClientRect().top) + 10 : MARGE_MOBILE.bottom;
  return { ...MARGE_MOBILE, bottom: Math.max(bas, 40) };
}

// MapLibre garde le padding d'un fitBounds/flyTo/easeTo de façon PERSISTANTE
// sur la transform (tr.padding), et le calcul d'un futur cadrage l'ADDITIONNE
// au nouveau padding demandé plutôt que de le remplacer (vérifié dans le code
// source réel de MapLibre v6 — cameraForBoxAndBearing somme edgePadding,
// hérité de tr.padding, et le padding de l'appel en cours). Deux cadrages
// avec padding enchaînés (ex. recherche -> falaise puis, juste après,
// falaise -> parking) voyaient donc leur padding s'additionner, jusqu'à
// dépasser la hauteur réelle du conteneur sur un petit écran mobile —
// cameraForBoxAndBearing renvoie alors undefined et fitBounds ne fait plus
// RIEN (bug observé : une 2e navigation enchaînée restait sans effet sur
// mobile, jamais sur desktop où le padding, même doublé, restait sous la
// hauteur de fenêtre). À appeler juste avant CHAQUE fitBounds/flyTo qui
// passe son propre padding, pour repartir d'une base à zéro à chaque fois.
export function reinitialiserPadding(map) {
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
}

// Empêche de dériver la carte loin de la sortie (Allemagne, Asie...) en
// glissant/zoomant : verrouille le pan/zoom à une marge autour de la vue
// initiale. Calculée à partir de map.getBounds() (la vue RÉELLEMENT visible,
// padding+zoom déjà appliqués) plutôt que de l'étendue brute des marqueurs
// avec un facteur fixe — un facteur fixe doit deviner à l'avance de combien
// le cadrage va zoomer en arrière pour compenser le padding demandé (voir
// margeToutVoir), et peut devenir trop serré si ce padding grandit (ex.
// légende qui s'allonge) sans que quiconque pense à le remonter ; en partant
// de la vue déjà obtenue, la marge reste toujours cohérente avec ce qui est
// effectivement affiché, quel que soit le padding utilisé.
// Appelée juste après la création de la carte : le cadrage initial est passé
// au constructeur (bounds + fitBoundsOptions, voir carte.js), il n'y a donc
// plus de moveend à attendre pour poser ces limites.
export function limiterZoneCarte(map) {
  const vue = map.getBounds();
  const sw = vue.getSouthWest();
  const ne = vue.getNorthEast();
  const margeLng = (ne.lng - sw.lng) * 0.5 || 0.8;
  const margeLat = (ne.lat - sw.lat) * 0.5 || 0.8;
  map.setMaxBounds([
    [sw.lng - margeLng, sw.lat - margeLat],
    [ne.lng + margeLng, ne.lat + margeLat],
  ]);
}

// Contrôle MapLibre custom (interface IControl : onAdd/onRemove) pour le
// bouton "Tout voir" — s'empile proprement avec NavigationControl dans le
// même coin via l'API native, sans positionnement en dur à ajuster à l'œil.
export function creerControleToutVoir(onClick) {
  return {
    onAdd() {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'btn-tout-voir';
      bouton.setAttribute('aria-label', "Revenir à la vue d'ensemble");
      bouton.textContent = 'Tout voir';
      bouton.addEventListener('click', onClick);
      this._conteneur = document.createElement('div');
      this._conteneur.className = 'maplibregl-ctrl';
      this._conteneur.appendChild(bouton);
      return this._conteneur;
    },
    onRemove() {
      this._conteneur.remove();
    },
  };
}

// Durée d'animation caméra, ramenée à 0 si l'utilisateur a demandé moins de
// mouvement (prefers-reduced-motion). Les vols de caméra de MapLibre sont
// exactement le type d'animation visé par ce réglage : déplacement large,
// rapide et non sollicité, désagréable voire nauséeux pour qui y est
// sensible. On ne supprime pas le déplacement — la carte doit toujours
// arriver au bon endroit — on le rend instantané.
//
// Évalué à CHAQUE appel plutôt que mémorisé au chargement : le réglage
// système peut changer en cours de session, et matchMedia est peu coûteux.
export function dureeAnimation(millisecondes) {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : millisecondes;
}
