// rose-des-vents.js — rose des vents SVG de l'orientation d'une falaise, posée
// en haut à droite de l'en-tête de la fiche. Pur templating, aucun état.

import { escapeHtml } from './utils.js';

// Rose des vents miniature pour l'orientation d'une falaise. Un point (pastille)
// par direction cardinale/intercardinale sur un anneau, plutôt qu'un
// conic-gradient plein (1er jet, retiré : ça ressemblait à un camembert coloré
// et pas à une rose des vents — mauvaise lecture ET peu élégant). Reprend le
// vocabulaire visuel déjà utilisé pour la légende (petits ronds "dot"), plus
// cohérent avec le reste du site qu'un dégradé. Les directions actives
// ressortent (pastille plus grosse + lettre) ; les autres restent de
// discrètes pastilles muettes qui donnent le contexte de l'anneau complet
// (donc plus besoin de traiter N à part : sa position — en haut — suffit).
const POINTS_ROSE = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

function roseDesVents(orientation) {
  const actifs = new Set(orientation.map(s => s.trim()).filter(Boolean));
  const indexDir = Object.fromEntries(POINTS_ROSE.map((d, i) => [d, i]));
  const cx = 32, cy = 32;

  // Une vraie rose des vents à 8 pointes (losanges) : 4 cardinales longues et
  // larges, 4 intercardinales courtes — le vocabulaire classique d'une rose.
  // Vectorielle (SVG) donc nette quel que soit l'affichage. Pointe active en
  // encre pleine, inactives en remplissage doux.
  const polygone = (i, rayon, base, demiL) => {
    const a = (i * 45 * Math.PI) / 180;
    const sin = Math.sin(a), cos = Math.cos(a);
    const tipX = cx + rayon * sin, tipY = cy - rayon * cos;
    const inX = cx + base * sin, inY = cy - base * cos;
    const Rm = (rayon + base) / 2;
    const gX = cx + Rm * sin + demiL * cos, gY = cy - Rm * cos + demiL * sin;
    const dX = cx + Rm * sin - demiL * cos, dY = cy - Rm * cos - demiL * sin;
    return `${tipX},${tipY} ${gX},${gY} ${inX},${inY} ${dX},${dY}`;
  };

  const pointes = POINTS_ROSE.map((d, i) => {
    const cardinal = i % 2 === 0;
    const actif = actifs.has(d);
    // Pointes dimensionnées au juste milieu entre deux tests : à rayon 22,
    // les cardinales chevauchaient les libellés (rayon 25) ; à rayon 17,
    // la rose paraissait trop petite. 20/13 garde des pointes affirmées tout
    // en laissant un net dégagement devant les lettres, bien à l'intérieur
    // de l'anneau (r 24).
    const rayon = cardinal ? 20 : 13;
    const demiL = cardinal ? 4.8 : 3.2;
    const classe = actif ? 'rose-vents-pointe rose-vents-pointe-actif' : 'rose-vents-pointe';
    return `<polygon class="${classe}" points="${polygone(i, rayon, 6.5, demiL)}" />`;
  }).join('');

  // Libellés : direction(s) active(s) en évidence, repère N discret sinon.
  const labels = POINTS_ROSE
    .filter(d => actifs.has(d) || d === 'N')
    .map(d => {
      const i = indexDir[d];
      const a = (i * 45 * Math.PI) / 180;
      const x = cx + 25 * Math.sin(a);
      const y = cy - 25 * Math.cos(a);
      const actif = actifs.has(d);
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" class="rose-vents-label${actif ? ' rose-vents-label-actif' : ''}">${escapeHtml(d)}</text>`;
    }).join('');

  return `
    <svg class="rose-vents" viewBox="0 0 64 64" role="img" aria-label="Orientation : ${escapeHtml(Array.from(actifs).join(', '))}">
      <circle class="rose-vents-anneau" cx="32" cy="32" r="24" />
      ${pointes}
      <circle class="rose-vents-centre" cx="32" cy="32" r="2.5" />
      ${labels}
    </svg>`;
}

// Orientation en haut à droite de l'en-tête falaise (voir popup-entete) : ce
// champ sort de la fiche d'infos pour gagner de la place, donc doit rester
// lisible par un lecteur d'écran via l'aria-label posé dans roseDesVents. Le
// type de roche (lui, resté dans la fiche, voir popupFalaise) n'a pas ce
// problème de place : pas de widget dédié à construire, juste une valeur texte.
export function construireCoinInfos(orientation) {
  if (!orientation || !orientation.length) return '';
  return `<div class="popup-coin">${roseDesVents(orientation)}</div>`;
}
