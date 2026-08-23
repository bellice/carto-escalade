// carte-utils.js — utilitaires de cadrage caméra et de contrôle carte,
// indépendants des marqueurs/popups.

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs';

// Réserve la place occupée par le header + la recherche (haut) et la légende
// (bas), pour qu'un marqueur centré ou un cadrage ajusté ne finisse pas
// caché dessous. Padding asymétrique passé à flyTo/fitBounds.
export const MARGE_UI = { top: 120, bottom: 170, left: 70, right: 70 };

// Variante de MARGE_UI pour un cadrage immédiatement suivi d'une ouverture de
// popup (voir allerVers dans carte.js) : sur mobile, cette popup prend la
// forme d'une feuille du bas jusqu'à ~45vh (cf. @media max-width:640px dans
// le CSS) — bien plus haute que les 170px prévus pour la légende. Sans ce
// correctif, un marqueur pouvait finir cadré pile là où la feuille allait le
// recouvrir. Recalculée à chaque appel (pas une constante) : dépend de la
// hauteur d'écran réelle, qui peut changer (rotation, redimensionnement).
//
// top réduit à 24 (pas les 120 de MARGE_UI) : ce top-là existe pour la barre
// de recherche, qui SE MASQUE ELLE-MÊME tant qu'une fiche est ouverte sur
// mobile (body.fiche-ouverte, voir le CSS) — puisqu'une popup va justement
// s'ouvrir juste après cet appel, lui laisser 120px de trop en plus des ~300+
// déjà réservés en bas resserrait l'espace utile bien plus que nécessaire
// (repéré après test : cadrage peu visible, voire absent, sur petit écran).
export function margeAvantPopup() {
  if (!window.matchMedia('(max-width: 640px)').matches) return MARGE_UI;
  const bas = Math.min(window.innerHeight * 0.45, 380) + 16;
  return { ...MARGE_UI, top: 24, bottom: bas };
}

// Variante de MARGE_UI pour un cadrage "vue d'ensemble" (chargement initial,
// bouton "Tout voir", clic sur un nom de site, recherche à résultats
// multiples) : mesure la VRAIE hauteur occupée à l'écran par le panneau
// légende plutôt que de deviner un chiffre fixe. MARGE_UI.bottom (170) avait
// été réglé pour une légende plus courte qu'aujourd'hui, et redeviendrait
// obsolète à chaque futur ajout dans ce panneau sans cette mesure — d'autant
// que la légende est DÉPLIÉE par défaut (pas repliée), donc son encombrement
// réel dépasse largement la seule hauteur du bouton "Masquer". Recalculée à
// chaque appel : la légende peut être repliée/dépliée entre deux appels, la
// hauteur d'écran peut changer (rotation).
export function margeToutVoir() {
  const legende = document.querySelector('.legende');
  const bas = legende ? Math.round(window.innerHeight - legende.getBoundingClientRect().top) + 10 : MARGE_UI.bottom;
  return { ...MARGE_UI, bottom: Math.max(bas, 40) };
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

export function fitToMarkers(map, geojson) {
  if (!geojson.features.length) return null;
  const bounds = new maplibregl.LngLatBounds();
  geojson.features.forEach(f => bounds.extend(f.geometry.coordinates));
  reinitialiserPadding(map);
  map.fitBounds(bounds, { padding: margeToutVoir(), maxZoom: 15 });
  limiterZoneCarte(map, bounds);
  return bounds;
}

// Empêche de dériver la carte loin de la sortie (Allemagne, Asie...) en
// glissant/zoomant : verrouille le pan/zoom à une marge autour des marqueurs.
function limiterZoneCarte(map, bounds) {
  // Doit rester nettement plus large que ce que fitBounds+margeToutVoir()
  // affiche réellement à l'écran (le padding en pixels "mange" une plus
  // grande part d'un viewport mobile étroit, donc la zone visible dépasse
  // vite une marge trop serrée) — sinon setMaxBounds force un zoom arrière...
  // ou avant, au-delà de ce que le cadrage avait calculé.
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const margeLng = (ne.lng - sw.lng) * 1.5 || 0.8;
  const margeLat = (ne.lat - sw.lat) * 1.5 || 0.8;
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
