// liens-acces.js — itinéraire (geo:, Plans, Google Maps selon l'appareil),
// bouton GPS copiable et rangée de liens secondaires. Pur templating : seuls
// matchMedia et navigator sont lus pour choisir le bon lien.

// geo: n'ouvre une appli Maps/Plans que sur un appareil qui en a une — sur
// desktop, en général aucun gestionnaire n'est enregistré et le lien ne fait
// rien. (pointer: coarse) cible le type d'entrée (tactile vs souris/trackpad)
// plutôt qu'une largeur de fenêtre : un desktop avec une fenêtre étroite n'a
// pas plus d'appli Maps pour autant, alors qu'une tablette tactile en a une
// même en plein écran.
function afficherLienMaps() {
  return window.matchMedia('(pointer: coarse)').matches;
}

// Mobile : un lien geo: laisse le téléphone proposer TOUTES les applis de
// navigation installées, pas seulement Google Maps. q=lat,lon(nom) pose un
// repère nommé — sans lui, Google Maps centre la carte sans repère, donc sans
// rien à quoi rattacher un itinéraire. Répéter les coordonnées avant le « ? »
// garde la compatibilité RFC 5870 pour les applis qui ignorent q=.
// Desktop : geo: n'ouvre en général rien, d'où le lien Google Maps direct.
// iPhone / iPad : iOS ne connaît pas le schéma geo: (le lien ne fait rien, sans
// message) ; le lien https://maps.apple.com ouvre Plans directement, appli
// présente sur tous les appareils Apple, en itinéraire vers le point.
function estAppareilApple() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    // iPadOS se présente comme un Mac : seul le tactile le distingue.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function lienItineraire(lat, lon, nom) {
  const coords = `${lat},${lon}`;
  if (estAppareilApple()) {
    const libelle = nom ? `&q=${encodeURIComponent(nom)}` : '';
    return `https://maps.apple.com/?daddr=${coords}&dirflg=d${libelle}`;
  }
  if (afficherLienMaps()) {
    const libelle = nom ? `(${encodeURIComponent(nom)})` : '';
    return `geo:${coords}?q=${coords}${libelle}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${coords}`;
}

// Assemble la rangée de liens secondaires (texte souligné, séparés par "·")
// à partir d'une liste où certaines entrées peuvent être vides (Oblyk
// absent...) — filtre les vides et joint seulement ce qui reste, pour ne
// jamais laisser un séparateur orphelin en tête/fin, et n'affiche rien du
// tout si la liste entière est vide.
export function construireActionsSecondaires(liens) {
  const presents = liens.filter(Boolean);
  if (!presents.length) return '';
  return `<div class="actions-secondaires">${presents.join('<span class="separateur" aria-hidden="true">·</span>')}</div>`;
}

// Coordonnées GPS : affichées en clair (pas cachées derrière un intitulé
// générique "Copier coordonnées") et copiables d'un tap. Utile même sans
// rien coller ensuite : noter à la main, les rentrer dans un GPS de
// randonnée dédié (souvent sans presse-papiers partagé avec le téléphone),
// les dicter à quelqu'un. 5 décimales (~1 m de précision) : plus que
// suffisant pour une approche, largement assez lisible. Le mot "Copier" est
// affiché EN CLAIR (pas juste un aria-label) — même leçon que la poignée de
// la fiche mobile : une affordance purement visuelle (case grisée) ne suffit
// pas, il faut le dire. Il bascule seul en "Copié !" au clic, sans jamais
// remplacer la valeur elle-même — contrairement à un 1er essai qui la
// cachait pendant la confirmation, ce qui privait justement de la lire au
// moment où on en a le plus besoin (double-vérifier ce qu'on vient de copier).
export function boutonGps(lat, lon) {
  const valeur = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  // <bouton-gps> (bouton-gps.js) ajoute la copie à ce <button> natif, qui reste
  // focusable et activable au clavier tant que le composant n'est pas défini.
  return `<bouton-gps lat="${lat}" lon="${lon}"><button type="button" class="gps-copie" aria-label="Copier les coordonnées GPS">
    <span class="gps-info">
      <span class="gps-label">GPS</span>
      <span class="gps-valeur">${valeur}</span>
    </span>
    <span class="gps-action">Copier</span>
  </button></bouton-gps>`;
}
