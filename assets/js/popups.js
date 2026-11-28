// popups.js — assemble le HTML des 3 popups (falaise, parking, gîte) à partir
// des briques de rose-des-vents.js, liens-acces.js et champs-fiche.js. Pur
// templating : pas d'état, chaque fonction ne dépend que de ses paramètres.
// Seuls popupFalaise, popupParking et popupGite servent hors de ce fichier
// (marqueurs.js). L'histogramme et le détail des voies, chargés à la demande,
// vivent dans histogramme.js et detail-voies.js.

import { escapeHtml, urlSure } from './utils.js';
import { secteurDistinct } from './donnees.js';
import { construireCoinInfos } from './rose-des-vents.js';
import { lienItineraire, boutonGps, construireActionsSecondaires } from './liens-acces.js';
import { col, champBloc, colonneHauteur, champParkingAssocie, champLiensFalaises, libelleRoche, styleGrimpe } from './champs-fiche.js';

// Poignée de la fiche mobile, commune aux trois popups. <poignee-fiche>
// (poignee-fiche.js) lui ajoute le repli ; sans lui, c'est un <button> natif.
// Sans attribut `reduite` : fiche dépliée, ce que dit le HTML ci-dessous.
const POIGNEE_FICHE = '<poignee-fiche><button type="button" class="poignee-fiche" aria-expanded="true" aria-label="Réduire la fiche"><span class="poignee-texte">Réduire</span></button></poignee-fiche>';

// Groupe "Topo papier" (voir escalade/db/schema/01_falaise.sql, 00_source.sql) :
// but de retrouver ce secteur dans le topo qu'on a sous la main en
// préparant une sortie — ET de faire savoir qu'un topo payant existe
// (l'achat finance l'entretien des falaises/équipement, pas juste une
// commodité perso). Réutilise .fiche-groupe-suivant/.fiche-groupe-titre
// (même voix que "Accès" plus haut) plutôt qu'un style bis, maintenant
// qu'il y a 2 lignes à porter (référence + lien d'achat) et pas juste un
// repère compact. Titre + auteur + année TOUJOURS en clair (jamais caché
// dans un title=, invisible au tactile) ; le lien d'achat est SÉPARÉ du
// texte (pas le titre entier cliquable) pour rester explicite sur ce
// qu'il fait.
function groupeTopo(p) {
  if (!(p.topo_page || p.topoNom)) return '';
  // ';' : un secteur peut s'étaler sur plusieurs pages du topo (saisi tel
  // quel dans falaise.csv, ex. "284;286") — affiché en liste lisible.
  // topo_page peut manquer alors que le topo (topo_id) est déjà identifié
  // (saisie en cours, vu en pratique sur plusieurs secteurs) : la page
  // s'omet alors gracieusement, jamais "p. undefined" ni tout le groupe
  // caché pour autant — le nom du topo et le lien d'achat restent utiles
  // sans elle.
  const editeurAnnee = [p.topoEditeur, p.topoAnnee].filter(Boolean).join(', ');
  const parentheses = editeurAnnee ? ` (${escapeHtml(editeurAnnee)})` : '';
  // Un badge PAR page (pas "p. 86, 88, 90" en un seul bloc) : reste petit
  // et lisible quel que soit le nombre de pages, plutôt qu'un pavé qui
  // s'allongerait au même rythme — même vocabulaire visuel que
  // .badge-parking/.cat-tag déjà utilisés ailleurs sur le site, pas un
  // nouveau motif. flex-wrap (CSS) : les badges passent à la ligne
  // d'eux-mêmes si jamais trop nombreux pour la largeur du popup.
  const badgesPage = p.topo_page
    ? String(p.topo_page).split(';').map(pg => `<span class="topo-page-badge">p. ${escapeHtml(pg.trim())}</span>`).join('')
    : '';
  const identite = p.topoNom ? `<p class="topo-reference">${escapeHtml(p.topoNom)}${parentheses}</p>` : '';
  const lignePage = badgesPage ? `<div class="topo-page">${badgesPage}</div>` : '';
  // Le texte du lien dépend du type de source (jamais "Acheter" sur une
  // brochure gratuite, ce serait faux) — voir source.type,
  // escalade/data/raw/NOTICE.md.
  let libelleLien = 'Voir ce topo';
  if (p.topoType === 'topo payant') libelleLien = 'Acheter ce topo';
  else if (p.topoType === 'brochure_gratuite') libelleLien = 'Télécharger cette brochure';
  // urlSure : les URL viennent des données (source.csv). escapeHtml seul ne
  // protégerait pas d'un `javascript:` — voir utils.js. Chaîne vide = pas
  // de lien affiché du tout plutôt qu'un lien inerte trompeur.
  const urlTopo = urlSure(p.topoUrl);
  const lienAchat = urlTopo
    ? `<a class="topo-achat" href="${escapeHtml(urlTopo)}" target="_blank" rel="noopener">${libelleLien}</a>`
    : '';
  // Page(s) et lien d'achat sur la MÊME ligne (badges à gauche, lien à
  // droite, voir .topo-page-ligne) — même motif que .gps-copie (valeur à
  // gauche, "Copier" à droite) : économise une ligne de hauteur. Repasse
  // seule sur sa ligne si l'un des deux est absent (topo pas encore
  // numéroté, ou source sans URL) — pas de wrapper vide dans ce cas.
  const lignePageEtAchat = (lignePage || lienAchat)
    ? `<div class="topo-page-ligne">${lignePage}${lienAchat}</div>`
    : '';
  return `<div class="fiche-groupe-suivant"><div class="fiche-groupe-titre">Topo papier</div>${identite}${lignePageEtAchat}</div>`;
}

export function popupFalaise(p, lat, lon, cle) {
  // Deux groupes distincts, séparés par un espacement plus grand qu'entre
  // deux lignes du même groupe (voir .fiche-groupe-suivant) — pas de trait ni
  // de fond, juste plus de blanc : le regroupement par proximité (Gestalt)
  // suffit à signaler "nouveau sujet" sans ajouter le moindre élément visuel.
  const rowsLogistique = []; // comment y aller

  // Métadonnées clés en COLONNES ÉTROITES (Voies / Grimpe / Roche) : mini-
  // colonnes sans bordure, label en petite majuscule au-dessus de la valeur.
  // Ordre : VOIES d'abord (le chiffre clé pour choisir un site), puis GRIMPE
  // (les styles présents : "sportive, trad"), puis Roche (qualificatif géologique).
  const cols = [];
  if (p.nb_voie_total) cols.push(col('Voies', p.nb_voie_total));
  const grimpe = styleGrimpe(p);
  if (grimpe) cols.push(col('Grimpe', grimpe));
  const haut = colonneHauteur(p);
  if (haut) cols.push(col(haut.label, haut.valeur));
  if (p.type_roche) cols.push(col('Roche', libelleRoche(p.type_roche)));
  let contenuCaractere = cols.length ? `<div class="fiche-infos-cols">${cols.join('')}</div>` : '';

  if (p.nb_voie_total && p.routes) {
    // Histogramme des cotations, chargé à la demande (voir chargerDetailVoies) :
    // il ne couvre que les SPORTIVES — le titre ("Cotation" ou "Cotation
    // (hors trad et artificielle)", voir construireHistogramme) et la colonne
    // Grimpe (plusieurs styles, le cas échéant) signalent l'écart avec le total de la
    // colonne Voies. data-autres-disciplines : calculé ici (p est déjà
    // disponible), relu par chargerDetailVoies au moment du rendu différé.
    const autresDisciplines = (p.nb_voie_trad || p.nb_voie_artificielle || p.nb_voie_moulinette) ? '1' : '0';
    contenuCaractere += `<div class="voies-histo-placeholder" data-route="${escapeHtml(String(p.routes))}" data-route-falaise="${escapeHtml(String(p.routes_falaise))}" data-autres-disciplines="${autresDisciplines}"></div>`;
  }
  if (p.parking_associe && p.parking_associe.length) {
    const noms = p.parking_associe;
    const approches = p.approche_min || [];
    // Le temps d'approche voyage AVEC le(s) parking(s) (voir
    // champParkingAssocie) : plus de ligne "Approche" séparée, qui détachait
    // l'info du parking auquel elle se rapporte. La distance en mètres est
    // retirée de l'affichage (chacun se fait son itinéraire), le temps à
    // pied reste.
    rowsLogistique.push(champParkingAssocie(noms, approches));
  }
  // Itinéraire + GPS rejoignent "Accès" (avant : isolés tout en bas dans
  // .actions) — les deux répondent à la même question "comment j'y vais",
  // pas de raison de les séparer par tout le reste de la fiche. Poids visuel
  // inchangé (toujours .btn-primary, le bouton le plus utilisé sur le
  // terrain selon le commentaire d'origine, voir assets/css/) — seul
  // l'EMPLACEMENT change. Groupe désormais TOUJOURS rendu (plus conditionné
  // à rowsLogistique.length) : Itinéraire/GPS existent pour toute falaise,
  // avec ou sans parking associé.
  rowsLogistique.push(`<a class="btn-primary" href="${lienItineraire(lat, lon, p.nom)}" target="_blank" rel="noopener">Itinéraire</a>`);
  rowsLogistique.push(boutonGps(lat, lon));

  const rows = [
    contenuCaractere,
    `<div class="fiche-groupe-suivant"><div class="fiche-groupe-titre">Accès</div>${rowsLogistique.join('')}</div>`,
  ];

  const secteur = secteurDistinct(p);
  const urlOblyk = urlSure(p.lien_oblyk);
  const urlC2C = urlSure(p.lien_camptocamp);
  const lienOblyk = urlOblyk ? `<a href="${escapeHtml(urlOblyk)}" target="_blank" rel="noopener">Voir sur Oblyk</a>` : '';
  const lienC2C = urlC2C ? `<a href="${escapeHtml(urlC2C)}" target="_blank" rel="noopener">Voir sur C2C</a>` : '';
  const rangeeSecondaires = construireActionsSecondaires([lienOblyk, lienC2C]);
  const groupePlusLoin = rangeeSecondaires
    ? `<div class="fiche-groupe-suivant"><div class="fiche-groupe-titre">Pour aller plus loin</div>${rangeeSecondaires}</div>`
    : '';

  return `
    <div class="popup" data-cle="${escapeHtml(cle)}">
      ${POIGNEE_FICHE}
      <div class="popup-entete">
        <div class="popup-titre-bloc">
          <span class="cat-tag falaise">Secteur</span>
          <h3>${escapeHtml(p.nom)}</h3>
          ${secteur ? `<p class="sous-titre">${escapeHtml(secteur)}</p>` : ''}
        </div>
        ${construireCoinInfos(p.orientation)}
      </div>
      <div class="fiche-infos">${rows.join('')}</div>
      <div class="actions">
        ${groupeTopo(p)}
        ${groupePlusLoin}
        <button type="button" class="btn-partager" data-cle="${escapeHtml(cle)}" data-nom="${escapeHtml(p.nom)}">Partager cette fiche</button>
      </div>
    </div>`;
}

export function popupParking(p, lat, lon, parkingInfos, cle) {
  const rows = [];
  if (p.trajet_gite_min) rows.push(champBloc('Trajet depuis le gîte', `${p.trajet_gite_min} min en voiture`));

  const info = parkingInfos.get(p.nom);
  if (info && info.falaises.length) {
    rows.push(champLiensFalaises(info.falaises));
  }
  const site = info && info.sites.size ? Array.from(info.sites).join(' / ') : '';

  return `
    <div class="popup" data-cle="${escapeHtml(cle)}">
      ${POIGNEE_FICHE}
      <span class="cat-tag parking">Parking</span>
      ${site ? `<span class="badge-site">${escapeHtml(site)}</span>` : ''}
      <h3>${escapeHtml(p.nom)}</h3>
      <div class="fiche-infos">${rows.join('')}</div>
      <div class="actions">
        <a class="btn-primary" href="${lienItineraire(lat, lon, p.nom)}" target="_blank" rel="noopener">Itinéraire</a>
        ${boutonGps(lat, lon)}
      </div>
    </div>`;
}

export function popupGite(p, lat, lon, cle) {
  return `
    <div class="popup" data-cle="${escapeHtml(cle)}">
      ${POIGNEE_FICHE}
      <span class="cat-tag gite">Gîte</span>
      <h3>${escapeHtml(p.nom)}</h3>
      <div class="actions">
        <a class="btn-primary" href="${lienItineraire(lat, lon, p.nom)}" target="_blank" rel="noopener">Itinéraire</a>
        ${boutonGps(lat, lon)}
      </div>
    </div>`;
}
