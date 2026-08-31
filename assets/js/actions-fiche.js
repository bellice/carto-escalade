// actions-fiche.js — toutes les actions déclenchées DEPUIS le contenu d'une
// fiche (popup mobile ou panneau desktop) : poignée, détail des voies, tri,
// réessai, copie GPS, partage, navigation vers un secteur ou un parking.
//
// UN SEUL écouteur délégué, posé une fois, qui retrouve sa cible par closest()
// à chaque clic — plutôt que ré-attacher des écouteurs sur des nœuds précis à
// chaque ouverture. Robuste à toute réécriture du contenu par MapLibre (bug
// observé : la poignée ne répondait plus après un déplacement de la carte).
//
// Extrait de carte.js, où il pesait 120 lignes alors qu'il ne touchait que
// TROIS variables de sa closure — d'où l'interface réduite ci-dessous. C'est
// un répartiteur : il n'a aucun état propre et ne connaît pas la carte.

import { estDesktop } from './carte-utils.js';
import {
  synchroniserPoignee,
  afficherDetailVoies,
  masquerDetailVoies,
  basculerTriDetailVoies,
  remplirPlaceholderVoies,
} from './marqueurs.js';

const DUREE_CONFIRMATION = 1500;

// urlRoute        : (idSite) => URL du fichier de détail des voies
// lireFicheReduite / ecrireFicheReduite : l'état replié est PARTAGÉ avec le
//                   reste de la carte (voir carte.js), d'où l'accesseur plutôt
//                   qu'une copie locale qui divergerait.
// popupCourante   : () => la fiche suivie, ou null
// allerVers       : (nom, origineCle) => navigation
export function cablerActionsFiche({
  urlRoute, lireFicheReduite, ecrireFicheReduite, popupCourante, allerVers,
}) {
  document.addEventListener('click', (e) => {
    const poignee = e.target.closest('.poignee-fiche');
    if (poignee) {
      const contenu = poignee.closest('.maplibregl-popup-content');
      if (!contenu) return;
      const reduite = contenu.classList.toggle('fiche-reduite');
      ecrireFicheReduite(reduite);
      synchroniserPoignee(poignee, reduite);
      return;
    }

    // Détail des voies : swap de contenu dans la MÊME fiche, voir marqueurs.js.
    const btnDetail = e.target.closest('.btn-voir-detail-voies');
    if (btnDetail) {
      const popupEl = btnDetail.closest('.popup');
      const placeholder = btnDetail.closest('.voies-histo-placeholder');
      if (popupEl && placeholder) {
        afficherDetailVoies(popupEl, placeholder.dataset.routeFalaise);
      }
      return;
    }

    const btnRetour = e.target.closest('.btn-retour-fiche');
    if (btnRetour) {
      const popupEl = btnRetour.closest('.popup');
      // Restaure l'état replié tel qu'il était AVANT l'ouverture du détail :
      // afficherDetailVoies ne le modifie jamais (voir marqueurs.js).
      if (popupEl) masquerDetailVoies(popupEl, lireFicheReduite());
      return;
    }

    // On repart du placeholder lui-même, qui porte encore ses data-route.
    const btnReessayer = e.target.closest('.btn-reessayer-voies');
    if (btnReessayer) {
      const placeholder = btnReessayer.closest('.voies-histo-placeholder');
      if (placeholder) remplirPlaceholderVoies(placeholder, urlRoute);
      return;
    }

    const btnTri = e.target.closest('.btn-tri-voies');
    if (btnTri) {
      const popupEl = btnTri.closest('.popup');
      const placeholder = btnTri.closest('.voies-histo-placeholder');
      if (popupEl && placeholder) {
        basculerTriDetailVoies(popupEl, placeholder.dataset.routeFalaise, btnTri.dataset.tri);
      }
      return;
    }

    const gpsBtn = e.target.closest('.gps-copie');
    if (gpsBtn) {
      // Bascule le mot d'action, jamais la valeur : la laisser affichée pendant
      // la confirmation permet de relire ce qu'on vient de copier.
      const action = gpsBtn.querySelector('.gps-action');
      const coords = `${Number(gpsBtn.dataset.lat).toFixed(5)}, ${Number(gpsBtn.dataset.lon).toFixed(5)}`;
      navigator.clipboard.writeText(coords).then(() => {
        if (action) action.textContent = 'Copié !';
        gpsBtn.classList.add('copied');
        setTimeout(() => {
          if (action) action.textContent = 'Copier';
          gpsBtn.classList.remove('copied');
        }, DUREE_CONFIRMATION);
      });
      return;
    }

    // Construit le même lien profond que lit le handler ?falaise= de carte.js.
    // navigator.share quand il existe (feuille de partage native), repli
    // presse-papiers sinon.
    const btnPartager = e.target.closest('.btn-partager');
    if (btnPartager) {
      const url = `${location.origin}${location.pathname}?falaise=${encodeURIComponent(btnPartager.dataset.cle)}`;
      if (navigator.share) {
        navigator.share({ title: btnPartager.dataset.nom, url }).catch(() => {});
      } else {
        const texteOriginal = btnPartager.textContent;
        navigator.clipboard.writeText(url).then(() => {
          btnPartager.textContent = 'Lien copié !';
          setTimeout(() => { btnPartager.textContent = texteOriginal; }, DUREE_CONFIRMATION);
        });
      }
      return;
    }

    // Les lignes .parking-ligne empruntent le même chemin que les .lien-secteur.
    const lienSecteur = e.target.closest('.lien-secteur, .parking-ligne');
    if (lienSecteur) {
      const popupEl = lienSecteur.closest('.popup');
      const origineCle = popupEl ? popupEl.dataset.cle : undefined;
      // Sur desktop, si c'est le PANNEAU falaise qui est ouvert, on le laisse :
      // les panneaux gauche et droit sont indépendants, et garder la fiche
      // ouverte conserve le contexte pendant qu'on affiche le parking associé.
      const courante = popupCourante();
      if (courante && !(estDesktop() && courante.estPanneauFalaise)) {
        courante.remove();
      }
      allerVers(lienSecteur.dataset.nom, origineCle);
    }
  });
}
