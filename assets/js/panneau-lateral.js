// panneau-lateral.js — recherche, repli des filtres (desktop), bascule
// Carte/Filtres (mobile), autocomplétion.

import { etat } from './etat.js';
import { appliquerFiltresEtSecteurs } from './visibilite.js';
import { estDesktop } from './carte-utils.js';
import { libelleFalaise } from './donnees.js';
import { escapeHtml } from './utils.js';

const recherche = document.querySelector('.recherche input');
const btnCentrer = document.querySelector('.btn-centrer');
const btnEffacer = document.querySelector('.btn-effacer');
const btnVueCarte = document.getElementById('btn-vue-carte');
const btnVueFiltres = document.getElementById('btn-vue-filtres');

// Remet la recherche à zéro (texte, filtre, boutons dépendants) — utilisé
// par allerVers() et par "Tout voir", qui doivent tous les deux repartir
// d'un état neutre.
export function reinitialiserRecherche() {
  etat.filtres.recherche = '';
  if (recherche) recherche.value = '';
  if (btnCentrer) btnCentrer.disabled = true;
  if (btnEffacer) btnEffacer.hidden = true;
}

export function cablerRecherche(centrer) {
  if (recherche) {
    recherche.addEventListener('input', () => {
      etat.filtres.recherche = recherche.value.trim().toLowerCase();
      appliquerFiltresEtSecteurs();
      if (btnCentrer) btnCentrer.disabled = !etat.filtres.recherche;
      if (btnEffacer) btnEffacer.hidden = !recherche.value;
    });
    recherche.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        centrer();
      }
    });
  }

  if (btnEffacer) {
    btnEffacer.addEventListener('click', () => {
      reinitialiserRecherche();
      appliquerFiltresEtSecteurs();
      if (recherche) recherche.focus();
    });
  }

  if (btnCentrer) {
    btnCentrer.disabled = true; // rien à centrer tant que le champ est vide
    btnCentrer.addEventListener('click', centrer);
  }
}

export function cablerRepliFiltres() {
  const legendeToggle = document.querySelector('.legende-toggle');
  const legendeContenu = document.getElementById('legende-contenu');
  if (legendeToggle && legendeContenu) {
    legendeToggle.addEventListener('click', () => {
      const vaOuvrir = legendeContenu.hidden;
      legendeContenu.hidden = !vaOuvrir;
      legendeToggle.setAttribute('aria-expanded', String(vaOuvrir));
      // L'état visuel est porté par l'icône (rotation CSS via aria-expanded,
      // voir .legende-toggle-icone) — le aria-label reste explicite pour le
      // lecteur d'écran (une icône seule ne l'est pas).
      legendeToggle.setAttribute('aria-label', vaOuvrir ? 'Réduire les filtres' : 'Déplier les filtres');
      // Le libellé VISIBLE ("Filtres" / "Filtres · N") ne dit plus l'état —
      // c'est le rôle du chevron (rotation CSS via aria-expanded, voir
      // .legende-toggle-icone) — mais LE nombre de filtres actifs, tenu à
      // jour par rafraichirBoutonReinitialiserFiltres. Le aria-label reste
      // le seul endroit qui dit l'état, explicitement, pour qui n'a pas
      // l'icône.
    });
  }
}

// --- Repli/déploiement des FILTRES desktop uniquement (fermé par défaut,
// cf. HTML) : .legende-cercles (pictos + cercles proportionnels) n'est
// plus concernée depuis que c'est un sibling séparé de .legende, affiché
// en permanence des deux côtés desktop et mobile — seuls les réglages
// (#legende-contenu) se replient. ---
// --- Bascule mobile "Carte" / "Filtres" (voir assets/css/, @media
// max-width:640px) : sous 641px, remplace la légende flottante par un
// aller-retour plein écran entre la carte et le panneau de filtres —
// #panneau-lateral, invisible hors media query. Sans effet ≥641px (garde
// en plus de celle du CSS, au cas où un futur appel oublierait le
// contexte) : #map reste alors la seule vue, comme aujourd'hui.
// inert sur la carte pendant "Filtres" : contrairement à la fiche mobile
// (qui ne recouvre qu'une partie de l'écran, zoom/"Tout voir" restent
// volontairement joignables), ce panneau remplace la carte en entier —
// sans inert, ces contrôles resteraient dans l'ordre de tabulation tout en
// étant invisibles. Même mécanisme déjà en place pour #panneau-falaise
// (voir ouvrirPanneauFalaise/fermerPanneauFalaise, marqueurs.js).
export function definirVueMobile(vue) {
  if (estDesktop()) return;
  const enFiltres = vue === 'filtres';
  document.body.classList.toggle('mode-filtres', enFiltres);
  if (btnVueCarte) btnVueCarte.setAttribute('aria-pressed', String(!enFiltres));
  if (btnVueFiltres) btnVueFiltres.setAttribute('aria-pressed', String(enFiltres));
  if (etat.map) etat.map.getContainer().toggleAttribute('inert', enFiltres);
}

export function cablerBasculeMobile() {
  if (btnVueCarte) btnVueCarte.addEventListener('click', () => definirVueMobile('carte'));
  if (btnVueFiltres) btnVueFiltres.addEventListener('click', () => definirVueMobile('filtres'));
}

export function remplirAutocompletion(geojson) {
  const datalist = document.getElementById('falaises-liste');
  if (!datalist) return;
  const libelles = geojson.features
    .filter(f => f.properties.categorie === 'falaise')
    .map(f => libelleFalaise(f.properties))
    .sort((a, b) => a.localeCompare(b, 'fr'));
  datalist.innerHTML = libelles.map(txt => `<option value="${escapeHtml(txt)}"></option>`).join('');
}
