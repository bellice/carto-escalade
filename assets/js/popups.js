// popups.js — construction du HTML des 3 popups (falaise/parking/gîte) et de
// leurs widgets internes (rose des vents, jauge de cotation, grille de voies,
// bouton GPS, actions). Uniquement du templating : pas d'accès DOM en dehors
// de escapeHtml, pas d'état — chaque fonction ne dépend que de ses paramètres.
// Seuls popupFalaise/popupParking/popupGite sont utilisés hors de ce fichier
// (par marqueurs.js) — tout le reste (champ*, jauge*, rose des vents...)
// reste privé au module.

import { escapeHtml } from './utils.js';
import { secteurDistinct, cotationVersValeur } from './donnees.js';

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
function construireCoinInfos(orientation) {
  if (!orientation || !orientation.length) return '';
  return `<div class="popup-coin">${roseDesVents(orientation)}</div>`;
}

// geo: n'ouvre une appli Maps/Plans que sur un appareil qui en a une — sur
// desktop, en général aucun gestionnaire n'est enregistré et le lien ne fait
// rien. (pointer: coarse) cible le type d'entrée (tactile vs souris/trackpad)
// plutôt qu'une largeur de fenêtre : un desktop avec une fenêtre étroite n'a
// pas plus d'appli Maps pour autant, alors qu'une tablette tactile en a une
// même en plein écran.
function afficherLienMaps() {
  return window.matchMedia('(pointer: coarse)').matches;
}

// Un seul bouton "Itinéraire", pas deux (l'ancien "Ouvrir dans Maps" séparé
// prenait une place en plus sur mobile pour un gain qui, une fois le lien
// geo: corrigé, n'existait plus vraiment). Deux façons d'y arriver selon
// l'appareil :
// - mobile (afficherLienMaps) : un lien geo:lat,lon?q=lat,lon(nom) — laisse
//   le téléphone proposer TOUTES les applis de nav installées (Organic Maps,
//   Google Maps, Waze...), pas seulement Google Maps. q=lat,lon(nom) est la
//   convention Android/Google pour poser un repère NOMMÉ dans Google Maps
//   (sans lui, Google Maps centre la carte SANS repère — rien à quoi
//   rattacher un itinéraire) ; répéter les coordonnées avant le "?" (plutôt
//   que le classique geo:0,0?q=...) garde la compatibilité RFC 5870 pour les
//   applis qui ignorent q= et ne lisent que la position brute.
// - desktop : geo: n'ouvrant en général rien, on garde le lien direct vers
//   Google Maps Itinéraire (seul choix qui marche vraiment là).
function lienItineraire(lat, lon, nom) {
  const coords = `${lat},${lon}`;
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
function construireActionsSecondaires(liens) {
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
function boutonGps(lat, lon) {
  const valeur = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return `<button type="button" class="gps-copie" data-lat="${lat}" data-lon="${lon}" aria-label="Copier les coordonnées GPS">
    <span class="gps-info">
      <span class="gps-label">GPS</span>
      <span class="gps-valeur">${valeur}</span>
    </span>
    <span class="gps-action">Copier</span>
  </button>`;
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
  // (le style : sportive/trad/mixte), puis Roche (qualificatif géologique).
  const cols = [];
  if (p.nb_voie_total) cols.push(col('Voies', p.nb_voie_total));
  const grimpe = styleGrimpe(p);
  if (grimpe) cols.push(col('Grimpe', grimpe));
  if (p.type_roche) cols.push(col('Roche', p.type_roche));
  let contenuCaractere = cols.length ? `<div class="fiche-infos-cols">${cols.join('')}</div>` : '';

  if (p.nb_voie_total && p.routes) {
    // Histogramme des cotations, chargé à la demande (voir chargerDetailVoies) :
    // il ne couvre que les SPORTIVES — le titre ("Cotation" ou "Cotation
    // (hors trad et artificielle)", voir construireHistogramme) et la colonne
    // Grimpe (mixte, le cas échéant) signalent l'écart avec le total de la
    // colonne Voies. data-autres-disciplines : calculé ici (p est déjà
    // disponible), relu par chargerDetailVoies au moment du rendu différé.
    const autresDisciplines = (p.nb_voie_trad || p.nb_voie_artificielle) ? '1' : '0';
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
  // terrain selon le commentaire d'origine, voir style-carte.css) — seul
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
  let groupeTopo = '';
  if (p.topo_page || p.topoNom) {
    // ';' : un secteur peut s'étaler sur plusieurs pages du topo (saisi tel
    // quel dans falaise.csv, ex. "284;286") — affiché en liste lisible.
    // topo_page peut manquer alors que le topo (topo_id) est déjà identifié
    // (saisie en cours, vu en pratique sur plusieurs secteurs) : la page
    // s'omet alors gracieusement, jamais "p. undefined" ni tout le groupe
    // caché pour autant — le nom du topo et le lien d'achat restent utiles
    // sans elle.
    const pages = p.topo_page ? String(p.topo_page).split(';').join(', ') : null;
    const editeurAnnee = [p.topoEditeur, p.topoAnnee].filter(Boolean).join(', ');
    const parentheses = editeurAnnee ? ` (${escapeHtml(editeurAnnee)})` : '';
    const suffixePage = pages ? `, p. ${escapeHtml(pages)}` : '';
    const reference = p.topoNom
      ? `${escapeHtml(p.topoNom)}${parentheses}${suffixePage}`
      : `p. ${escapeHtml(pages)}`;
    // Le texte du lien dépend du type de source (jamais "Acheter" sur une
    // brochure gratuite, ce serait faux) — voir source.type,
    // escalade/data/raw/NOTICE.md.
    let libelleLien = 'Voir ce topo';
    if (p.topoType === 'topo payant') libelleLien = 'Acheter ce topo';
    else if (p.topoType === 'brochure_gratuite') libelleLien = 'Télécharger cette brochure';
    const lienAchat = p.topoUrl
      ? `<p class="topo-achat"><a href="${escapeHtml(p.topoUrl)}" target="_blank" rel="noopener">${libelleLien}</a></p>`
      : '';
    groupeTopo = `<div class="fiche-groupe-suivant"><div class="fiche-groupe-titre">Topo papier</div><p class="topo-reference">${reference}</p>${lienAchat}</div>`;
  }
  const lienOblyk = p.lien_oblyk ? `<a href="${escapeHtml(p.lien_oblyk)}" target="_blank" rel="noopener">Voir sur Oblyk</a>` : '';
  const lienC2C = p.lien_camptocamp ? `<a href="${escapeHtml(p.lien_camptocamp)}" target="_blank" rel="noopener">Voir sur C2C</a>` : '';
  const rangeeSecondaires = construireActionsSecondaires([lienOblyk, lienC2C]);
  const groupePlusLoin = rangeeSecondaires
    ? `<div class="fiche-groupe-suivant"><div class="fiche-groupe-titre">Pour aller plus loin</div>${rangeeSecondaires}</div>`
    : '';

  return `
    <div class="popup" data-cle="${escapeHtml(cle)}">
      <button type="button" class="poignee-fiche" aria-expanded="true" aria-label="Réduire la fiche"><span class="poignee-texte">Réduire</span></button>
      <div class="popup-entete">
        <div class="popup-titre-bloc">
          <span class="cat-tag falaise">Falaise</span>
          <h3>${escapeHtml(p.nom)}</h3>
          ${secteur ? `<p class="sous-titre">${escapeHtml(secteur)}</p>` : ''}
        </div>
        ${construireCoinInfos(p.orientation)}
      </div>
      <div class="fiche-infos">${rows.join('')}</div>
      <div class="actions">
        ${groupeTopo}
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
      <button type="button" class="poignee-fiche" aria-expanded="true" aria-label="Réduire la fiche"><span class="poignee-texte">Réduire</span></button>
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
      <button type="button" class="poignee-fiche" aria-expanded="true" aria-label="Réduire la fiche"><span class="poignee-texte">Réduire</span></button>
      <span class="cat-tag gite">Gîte</span>
      <h3>${escapeHtml(p.nom)}</h3>
      <div class="actions">
        <a class="btn-primary" href="${lienItineraire(lat, lon, p.nom)}" target="_blank" rel="noopener">Itinéraire</a>
        ${boutonGps(lat, lon)}
      </div>
    </div>`;
}

function champ(label, valeur) {
  return `<div class="info-ligne"><span class="info-label">${label}</span><span class="info-valeur">${escapeHtml(String(valeur))}</span></div>`;
}

// Variante "bloc" (voir .info-bloc) : libellé sur sa propre ligne, valeur en
// pleine largeur en dessous — pour une valeur à donner en évidence (ex. le
// temps de trajet "71 min en voiture" dans la popup parking) plutôt que
// serrée à droite d'un libellé.
function champBloc(label, valeur) {
  return `<div class="info-bloc"><span class="info-label">${label}</span><span class="info-valeur">${escapeHtml(String(valeur))}</span></div>`;
}

// Mini-colonne d'info (Roche / Voies, fiche falaise) : label en petite
// majuscule au-dessus de la valeur (voir .fiche-infos-cols/.col).
function col(label, valeur) {
  return `<div class="col"><span class="col-label">${label}</span><span class="col-valeur">${escapeHtml(String(valeur))}</span></div>`;
}



// Parking(s) associé(s) à une falaise : le nom réel du parking (souvent une
// description type "petit parking D136") n'aide pas à décider de cliquer —
// seul le fait qu'il y en ait un compte. Cas courant (61 falaises/71, un
// seul parking) : un verbe d'action plutôt qu'un nom — et surtout pas le mot
// "parking" une 2e fois, déjà dit par le libellé juste à gauche (repéré après
// coup : "Parking" suivi de "Voir le parking" faisait doublon). Plusieurs
// parkings (toujours 3 ici dans les données, jamais 2) : impossible de rester
// générique, il faut bien distinguer les destinations — un simple rang
// (1/2/3) suffit, dans l'ordre où data.geojson les liste.
// "min à pied" (pas juste "min") : approche_min est un temps de MARCHE
// parking->falaise, à ne pas confondre avec trajet_gite_min (popupParking,
// "en voiture") — les deux se ressemblent d'un coup d'œil ("X min") sans ce
// qualificatif, alors que ce sont deux temps de nature différente.
//
// Cas 1 parking : reste sur une ligne info-ligne classique (label + un seul
// bouton, ça tient toujours). Cas plusieurs parkings : bascule sur le motif
// "label seul sur sa ligne + liste en flux" (.liens-detail, même motif que
// champLiensFalaises) plutôt qu'un texte assemblé avec des "·" (1er jet) —
// avec le qualificatif "à pied" en plus sur chaque bouton, ces libellés sont
// devenus trop longs pour rester en ligne : le séparateur pouvait finir seul
// sur sa propre ligne au retour à la ligne (constaté en réel).
function champParkingAssocie(noms, approches) {
  // Chaque parking est une LIGNE cliquable avec son temps d'approche — modèle
  // uniforme entre 1 et N parkings : [P] Parking [n] · X min à pied. La ligne
  // entière navigue vers le parking (handler .parking-ligne dans carte.js,
  // même chemin que .lien-secteur). Le badge P relie aux icônes P de la carte,
  // le libellé "Parking n" est souligné (affordance de lien cliquable).
  const badgeP = '<span class="badge-parking" aria-hidden="true">P</span>';
  const lignes = noms.map((nom, i) => {
    const libelle = noms.length === 1 ? 'Parking' : `Parking ${i + 1}`;
    const duree = approches[i] ? `<span class="parking-duree">· ${approches[i]} min à pied</span>` : '';
    return `<button type="button" class="parking-ligne" data-nom="${escapeHtml(nom)}">${badgeP}<span class="parking-libelle">${libelle}</span>${duree}</button>`;
  }).join('');
  return `<div class="parkings-list">${lignes}</div>`;
}

// Liste des falaises desservies par un parking, regroupées par sommet (nom).
// Un même sommet peut apporter jusqu'à une dizaine de secteurs (vu en
// pratique) : un bouton par secteur qui répète à chaque fois le nom du
// sommet devient un mur illisible. On affiche donc le nom une seule fois en
// en-tête de groupe, seulement s'il y a plus d'un sommet desservi (avec un
// seul sommet, le badge de site au-dessus de la popup le montre déjà).
function champLiensFalaises(falaises) {
  const parNom = new Map();
  falaises.forEach(f => {
    if (!parNom.has(f.nom)) parNom.set(f.nom, []);
    parNom.get(f.nom).push(f);
  });

  const bouton = (f, texte) => `<button type="button" class="lien-secteur" data-nom="${escapeHtml(f.cle)}">${escapeHtml(texte)}</button>`;

  const groupes = Array.from(parNom.entries()).map(([nom, items]) => {
    const liens = items.map(f => bouton(f, f.secteur || nom)).join(' · ');
    const seulUnSommet = parNom.size === 1;
    const seulSecteurEtSansNomDistinct = items.length === 1 && !items[0].secteur;
    const afficherEntete = !seulUnSommet && !seulSecteurEtSansNomDistinct;
    return afficherEntete
      ? `<span class="groupe-falaises"><span class="nom-falaise">${escapeHtml(nom)} :</span> ${liens}</span>`
      : `<span class="groupe-falaises">${liens}</span>`;
  }).join('');

  // Pas de valeur simple à mettre à droite du libellé (c'est une liste, pas
  // un fait unique) : le libellé reste seul sur sa ligne, la liste suit en
  // pleine largeur en dessous, en flux (plusieurs sommets courts peuvent
  // partager une ligne plutôt que d'en forcer chacun une).
  return `<div class="info-ligne"><span class="info-label">Falaises</span></div><div class="liens-detail">${groupes}</div>`;
}

// Histogramme "1 case = 1 voie" par cotation. Remplace le 1er jet (nuage en
// miroir sur une échelle 3a→9b fixe et globale) : testé en vrai, une falaise
// typique ne couvre que 2-3 crans sur les ~39 possibles, donc l'échelle
// globale compressait ses points dans une toute petite tranche du popup —
// des cotations voisines finissaient à quelques pixels les unes des autres,
// illisible (confirmé sur capture d'écran réelle, pas en théorie).
//
// Ici, une colonne par cotation RÉELLEMENT présente sur CETTE falaise (pas
// les ~39 crans possibles) : la largeur du popup reste toujours bien
// utilisée, quelle que soit l'étendue de la falaise, aucun risque de
// chevauchement (positions de grille, pas de pixels calculés en continu).
// Contrepartie assumée : la position d'une colonne n'est plus comparable
// d'une fiche à l'autre — priorité donnée à la lisibilité individuelle.
// Best-effort de placement pour 3 formes de cotation non standard mais
// raisonnablement déductibles — UNIQUEMENT pour positionner une voie sur ce
// graphique, jamais pour une valeur affichée ailleurs (cotationVersValeur,
// donnees.js, reste strict — utilisée entre autres pour le mode "Voies
// faciles" du sélecteur "Cercles", où une estimation n'a pas sa place). Les
// cases qui en résultent ne sont PAS distinguées visuellement des cotations
// exactes (essayé, puis retiré : un marquage pour un cas aussi marginal
// faisait plus de bruit qu'autre chose) — une fois la règle posée, elle
// s'applique sans réserve affichée.
function approximerCotation(cotation) {
  if (!cotation) return null;
  const texte = String(cotation).trim();
  // Lettrée + "-" (ex. "6a-") : le "-" est ignoré plutôt que de basculer
  // vers le cran précédent (6a- rejoint la colonne 6a, pas 5c+ — reste dans
  // SA lettre, pas dans une colonne qui semblerait être une autre cotation
  // réelle).
  let m = /^(\d)([abc])-$/.exec(texte);
  if (m) return { label: `${m[1]}${m[2]}` };
  // Chiffre seul + "-" (ex. "4-", ancienne cotation) : bas de fourchette.
  m = /^(\d)-$/.exec(texte);
  if (m) return { label: `${m[1]}a` };
  // Chiffre seul (ex. "4", ancienne cotation) : milieu de fourchette.
  m = /^(\d)$/.exec(texte);
  if (m) return { label: `${m[1]}b` };
  return null;
}

// Synthèse "Voies" (total + répartition sportives/autres) : n'utilise que les
// compteurs du fichier principal, pas le détail des voies — affichée tout de
// suite à l'ouverture de la fiche, pendant que l'histogramme se charge à la
// demande. "autres" (trad/artificielle) n'est pas détaillé par voie (seul le
// compte existe dans les données) — pas d'histogramme pour cette part,
// seulement ce compteur global.
// Style de grimpe de la falaise (colonne "Grimpe"), déduit du rapport
// sportives / autres : la colonne Voies porte le TOTAL, l'histogramme ne
// montre que les SPORTIVES (titre "Cotation voies sportives") — la colonne
// Grimpe signale l'écart sans ligne de texte séparée. Les données portent
// désormais la répartition exacte (nb_voie_sportive / nb_voie_trad /
// nb_voie_artificielle) : on ne déduit plus le style d'un vague "autres".
function styleGrimpe(p) {
  const total = p.nb_voie_total ?? 0;
  const sportive = p.nb_voie_sportive ?? 0;
  const trad = p.nb_voie_trad ?? 0;
  const artificielle = p.nb_voie_artificielle ?? 0;
  if (total <= 0) return '';
  // Nombre de disciplines réellement présentes : une seule -> son nom ;
  // plusieurs -> "mixte".
  const disciplines = [sportive > 0, trad > 0, artificielle > 0].filter(Boolean).length;
  if (disciplines <= 1) {
    if (sportive > 0) return 'sportive';
    if (trad > 0) return 'trad';
    if (artificielle > 0) return 'artificielle';
    return '';
  }
  return 'mixte';
}

// Histogramme "1 case = 1 voie" par cotation — chargé à la demande (voir
// marqueurs.js, popup.on('open')) depuis routes/<id>.json : c'est la seule
// partie du popup qui a besoin de la liste détaillée des voies, donc la
// seule qui ne vit pas dans le fichier de données principal. Remplace le 1er
// jet (nuage en miroir sur une échelle 3a→9b fixe et globale) : testé en
// vrai, une falaise typique ne couvre que 2-3 crans sur les ~39 possibles,
// donc l'échelle globale compressait ses points dans une toute petite
// tranche du popup — des cotations voisines finissaient à quelques pixels
// les unes des autres, illisible (confirmé sur capture d'écran réelle, pas
// en théorie).
//
// Ici, une colonne par cotation RÉELLEMENT présente sur CETTE falaise (pas
// les ~39 crans possibles) : la largeur du popup reste toujours bien
// utilisée, quelle que soit l'étendue de la falaise, aucun risque de
// chevauchement (positions de grille, pas de pixels calculés en continu).
// Contrepartie assumée : la position d'une colonne n'est plus comparable
// d'une fiche à l'autre — priorité donnée à la lisibilité individuelle.
// Best-effort de placement pour 3 formes de cotation non standard mais
// raisonnablement déductibles — UNIQUEMENT pour positionner une voie sur ce
// graphique, jamais pour une valeur affichée ailleurs (cotationVersValeur,
// donnees.js, reste strict — utilisée entre autres pour le mode "Voies
// faciles" du sélecteur "Cercles", où une estimation n'a pas sa place). Les
// cases qui en résultent ne sont PAS distinguées visuellement des cotations
// exactes (essayé, puis retiré : un marquage pour un cas aussi marginal
// faisait plus de bruit qu'autre chose) — une fois la règle posée, elle
// s'applique sans réserve affichée.
export function construireHistogramme(voiesSportives, aAutresDisciplines) {
  if (!voiesSportives || !voiesSportives.length) return '';

  // Regroupe par cotation EXACTE (6a et 6a+ n'ont jamais la même colonne).
  // Les voies à cotation non standard (~2,5% des cas réels — anciennes
  // cotations sans lettre, ex. certaines voies "Les Roches" à Crest, issues
  // d'une brochure plus ancienne que le reste des données) rejoignent leur
  // colonne via approximerCotation quand c'est raisonnablement déductible
  // (voir cette fonction pour le détail des règles retenues) ; les cases qui
  // en résultent ne sont pas distinguées visuellement des cotations exactes
  // — un choix assumé une fois la règle posée, pas une approximation à
  // signaler à chaque fois. Ce qui reste incalculable récolte sa propre
  // colonne "non côté" en fin de graphique — le compte de cases affiché
  // correspond alors bien au total sportif annoncé plus haut.
  const parCotation = new Map();
  const nonCotees = [];
  voiesSportives.forEach(v => {
    let val = cotationVersValeur(v.cotation);
    let label = v.cotation;
    if (val == null) {
      const estimee = approximerCotation(v.cotation);
      if (estimee) {
        val = cotationVersValeur(estimee.label);
        label = estimee.label;
      }
    }
    if (val == null) { nonCotees.push(v); return; }
    if (!parCotation.has(label)) parCotation.set(label, { val, voies: [] });
    parCotation.get(label).voies.push(v);
  });
  // Pas de voie sportive à afficher du tout (falaise 100% trad) : rien à
  // rendre — la synthèse, affichée séparément, suffit.
  if (!parCotation.size && !nonCotees.length) return '';

  const colonnes = Array.from(parCotation.entries())
    .map(([cotation, { val, voies }]) => ({ cotation, val, voies, nonCote: false }))
    .sort((a, b) => a.val - b.val);
  if (nonCotees.length) colonnes.push({ cotation: 'non côté', voies: nonCotees, nonCote: true });

  const case_ = (v, nonCote) => {
    const classe = nonCote ? 'non-cote' : (v.type_voie === 'couenne' ? 'couenne' : 'gv');
    return `<span class="histo-case ${classe}"></span>`;
  };
  const colonnesHtml = colonnes.map(c => `
    <div class="histo-colonne">
      <div class="histo-cases">${c.voies.map(v => case_(v, c.nonCote)).join('')}</div>
      <span class="histo-label">${escapeHtml(c.cotation)}</span>
    </div>`).join('');

  // Pas d'entrée de légende pour "non côté" : contrairement à couenne/grande
  // voie (mélangées à l'intérieur d'une même colonne, indécodables sans
  // légende), la colonne non côté porte déjà sa propre étiquette explicite
  // — une légende redondante n'ajouterait rien.
  const legende = [
    '<span class="histo-cle"><span class="histo-swatch couenne"></span>couenne</span>',
    '<span class="histo-cle"><span class="histo-swatch gv"></span>grande voie</span>',
  ];

  // role="img" + un seul aria-label résumé sur l'histogramme entier (pas un
  // par case) : le détail au clic est fourni par le bouton "Voir le détail
  // des voies" ci-dessous (voir construireDetailVoies), pas par les cases
  // elles-mêmes (8-13px, sous la règle des 44px de cible tactile déjà
  // appliquée ailleurs sur ce site pour les marqueurs — poserTailleMarqueur,
  // symboles.js) : annoncer individuellement jusqu'à plusieurs dizaines de
  // cases n'aiderait personne de toute façon.
  // Titre "Cotation (hors trad et artificielle)" plutôt que "Cotation voies
  // sportives" UNIQUEMENT quand la falaise a aussi des voies trad/artificielle
  // (aAutresDisciplines, dérivé de nb_voie_trad/nb_voie_artificielle — voir
  // l'attribut data-autres-disciplines posé par popupFalaise) : au-delà de
  // servir de rupture visuelle avant la légende couenne/grande voie (une
  // classification différente qui s'enchaînerait sinon sans signal), la
  // formulation par EXCLUSION prévient explicitement toute confusion avec le
  // total "Voies" plus haut — l'histogramme ne couvre pas les voies
  // trad/artificielle (non détaillées par voie dans les données, seulement
  // comptées), contrairement à ce qu'un titre par inclusion ("voies
  // sportives") laisse deviner seul. "trad"/"artificielle" sont déjà le
  // vocabulaire affiché ailleurs dans cette même fiche (colonne "Grimpe",
  // voir styleGrimpe) — pas une terminologie nouvelle. Si la falaise est
  // 100% sportive, cette précision n'exclut plus rien : la mention
  // deviendrait du bruit ("hors" de quoi, puisqu'il n'y a que ça ?), simple
  // "Cotation" suffit.
  const titre = aAutresDisciplines ? 'Cotation (hors trad et artificielle)' : 'Cotation';
  // .fiche-voies-resume : conteneur masqué en bloc quand le détail (plus bas)
  // est ouvert (voir style-carte.css, .mode-detail-voies) — un seul swap de
  // classe sur .popup bascule l'un pour l'autre, pas de logique JS dédiée.
  const histo = `
    <div class="fiche-voies-resume">
      <span class="legende-titre">${titre}</span>
      <div class="voies-histo" role="img" aria-label="Répartition des ${voiesSportives.length} voies sportives par cotation${nonCotees.length ? `, dont ${nonCotees.length} non côtées` : ''}">
        ${colonnesHtml}
      </div>
      <div class="histo-legende">${legende.join('')}</div>
      <button type="button" class="btn-voir-detail-voies">Voir le détail des voies</button>
    </div>`;

  return histo;
}

// Liste détaillée des voies (nom, cotation, points d'assurage, hauteur
// estimée) — drill-down depuis le bouton "Voir le détail des voies" de
// construireHistogramme (même tableau voiesSportives, pas un 2e fetch : voir
// afficherDetailVoies, marqueurs.js, qui relit le cache déjà rempli). Pas de
// case cliquable individuelle (voir le commentaire dans construireHistogramme
// sur la règle des 44px) ni de lien par voie vers un site communautaire (seul
// lien_oblyk/lien_camptocamp existe, au niveau falaise) : nom + points +
// hauteur suffisent à justifier l'écran sans ces deux ajouts.
// Valeur numérique pour trier par cotation croissante (même logique
// d'approximation que le regroupement en colonnes de l'histogramme,
// réutilisée à l'identique pour que les deux vues restent cohérentes entre
// elles). Une voie dont la cotation reste incalculable part en FIN de liste
// (Infinity), jamais mélangée au hasard parmi de vraies valeurs.
function valeurCotationPourTri(v) {
  const direct = cotationVersValeur(v.cotation);
  if (direct != null) return direct;
  const estimee = approximerCotation(v.cotation);
  return estimee ? cotationVersValeur(estimee.label) : Infinity;
}

// Texte de cotation à AFFICHER — même règle d'approximation que ci-dessus et
// que l'histogramme (colonnesHtml, plus haut dans ce fichier) : une cotation
// non standard mais déductible ("4-", "5"...) doit s'afficher sous sa forme
// normalisée ("4a", "5b") ici AUSSI, pas seulement pour le tri/regroupement
// en interne — sinon la MÊME voie affiche 2 cotations différentes selon
// qu'on la lit dans l'histogramme (déjà normalisé) ou dans cette liste
// (texte brut de la donnée), une incohérence repérée en relisant les deux
// vues côte à côte. Une cotation ni standard ni approximable reste affichée
// telle quelle : rien de mieux à montrer.
function libelleCotationAffichee(cotation) {
  if (cotationVersValeur(cotation) != null) return cotation;
  const estimee = approximerCotation(cotation);
  return estimee ? estimee.label : cotation;
}

// Valeur numérique pour trier par position sur la paroi (gauche à droite) :
// v.numero est la clé technique assignée côté CSV (voir NOTICE.md, dépôt
// escalade) — jamais affichée telle quelle, seulement comme ordre de tri.
// Une voie sans numero (secteur pas encore numéroté, faute de topo papier)
// part en fin de liste (même motif Infinity que valeurCotationPourTri),
// jamais mélangée au hasard parmi de vraies positions.
function valeurPositionPourTri(v) {
  return v.numero != null ? v.numero : Infinity;
}

function classeSwatch(v) {
  return v.type_voie === 'couenne' ? 'couenne' : 'gv';
}

export function construireDetailVoies(voiesSportives, mode = 'cotation') {
  const n = voiesSportives.length;
  // Juste le compte (utile pour se repérer avant de faire défiler la liste),
  // sans répéter "(hors trad et artificielle)" : cette précision vient déjà
  // d'être lue à l'instant sur l'écran précédent (titre de l'histogramme,
  // voir construireHistogramme) — la redire ici alourdit sans rien apporter
  // de nouveau, contrairement à sa 1ère apparition où elle évite une
  // confusion avec le total "Voies" de la fiche compacte.
  const titre = `${n} voie${n > 1 ? 's' : ''}`;
  // En-tête TEXTE (pas d'icône) pour "Points"/"Hauteur" : ce site a déjà une
  // règle posée ailleurs (le "P" du marqueur parking) — texte plutôt
  // qu'icône, aucun pictogramme nulle part sur ce site, justement parce
  // qu'une icône est ambiguë (quel symbole désigne sans confusion "points
  // d'assurage" ?) alors qu'un mot ne l'est jamais.
  //
  // Deux tris, deux besoins différents (pas un mélange des deux dans une
  // seule liste) : Cotation répond à "quoi de facile/dur", en une ligne par
  // voie comme avant ; Position répond à "qu'y a-t-il en marchant le long de
  // la paroi", et EXPOSE le détail longueur par longueur des grandes voies
  // (v.longueurs, absent des voies à une seule longueur) — demandé pour
  // préparer une sortie en amont, sans intérêt pour le tri Cotation qui n'a
  // pas vocation à s'alourdir de ce détail.
  const liste = mode === 'position' ? construireListePosition(voiesSportives) : construireListeCotation(voiesSportives);
  const bascule = (valeur, libelle) =>
    `<button type="button" class="btn-tri-voies${mode === valeur ? ' actif' : ''}" data-tri="${valeur}" aria-pressed="${mode === valeur}">${libelle}</button>`;
  // "Retour" en bas, PAS en haut à côté du titre (1er jet, abandonné) :
  // repéré au retour terrain — sur mobile, une fois la fiche quasi plein
  // écran (voir style-carte.css, .detail-voies-ouvert), un bouton en haut se
  // retrouve à l'opposé du pouce, inconfortable à atteindre à une main. En
  // `position: sticky; bottom: 0` (CSS) DANS la liste qui défile : reste
  // accessible en permanence, quelle que soit la position de scroll dans
  // une liste de 40+ voies, sans avoir à remonter tout en haut. Redevenu un
  // vrai bouton à cadre (comme "Voir le détail des voies") plutôt qu'un lien
  // souligné : plus prononcé, plus facile à repérer d'un coup d'œil comme
  // action possible — corrige aussi le "pas assez explicite" relevé sur la
  // version précédente (texte simple à côté du titre, discret).
  return `
    <div class="fiche-voies-detail">
      <h4 class="detail-voies-titre">${escapeHtml(titre)}</h4>
      <div class="detail-voies-tri" role="group" aria-labelledby="detail-voies-tri-titre">
        <span id="detail-voies-tri-titre" class="detail-voies-tri-label">Trier par</span>
        ${bascule('cotation', 'Cotation')}
        ${bascule('position', 'Position')}
      </div>
      ${liste}
      <button type="button" class="btn-retour-fiche" aria-label="Retour à la fiche"><span aria-hidden="true">←</span> Retour</button>
    </div>`;
}

// Mode Cotation (par défaut, inchangé) : du plus facile en haut au plus dur
// en bas (pas l'ordre alphabétique du nom, celui renvoyé par défaut côté
// SQL — sans rapport avec la difficulté). sort() est stable (ES2019+) : à
// cotation égale, l'ordre alphabétique d'origine sert de sous-tri, sans code
// dédié pour ça. Une ligne par voie, jamais de détail longueur par longueur
// ici — voir construireDetailVoies pour pourquoi ce détail reste réservé au
// mode Position.
function construireListeCotation(voiesSportives) {
  const voiesTriees = [...voiesSportives].sort((a, b) => valeurCotationPourTri(a) - valeurCotationPourTri(b));
  return `
    <ul class="detail-voies-liste">
      <li class="detail-voie detail-voie-entete-colonnes" aria-hidden="true">
        <span class="detail-voie-type"></span><span>Voie</span><span>Cotation</span><span>Points</span><span>Hauteur</span>
      </li>
      ${voiesTriees.map((v, i) => ligneDetailVoie(v, i)).join('')}
    </ul>`;
}

// Mode Position : trié de gauche à droite sur la paroi (voir
// valeurPositionPourTri) — le nom lui-même ne porte aucun repère de position
// (pas de préfixe numéro : le badge actif "Position" du bandeau de tri
// suffit déjà à signaler que ce tri est bien appliqué, voir
// construireDetailVoies). Une grande voie (v.longueurs renseigné) devient un
// GROUPE de lignes — une ligne "voie" (identique à ligneDetailVoie, valeurs
// globales déjà connues du mode Cotation) suivie d'une ligne indentée par
// longueur (cotation/points/hauteur DE cette longueur précise). La zébrure
// suit le GROUPE (indexGroupe), pas la ligne brute, pour que l'en-tête et
// ses sous-lignes restent visuellement une seule bande — sinon chaque
// longueur alternerait indépendamment, cassant la lecture "ceci est une
// seule voie" que le groupement est censé donner.
function construireListePosition(voiesSportives) {
  const voiesTriees = [...voiesSportives].sort((a, b) => valeurPositionPourTri(a) - valeurPositionPourTri(b));
  const lignes = voiesTriees.map((v, indexGroupe) => {
    const entete = ligneDetailVoie(v, indexGroupe);
    if (!v.longueurs || !v.longueurs.length) return entete;
    const sousLignes = v.longueurs.map(l => ligneDetailLongueur(l, indexGroupe)).join('');
    return entete + sousLignes;
  }).join('');
  return `
    <ul class="detail-voies-liste">
      <li class="detail-voie detail-voie-entete-colonnes" aria-hidden="true">
        <span class="detail-voie-type"></span><span>Voie</span><span>Cotation</span><span>Points</span><span>Hauteur</span>
      </li>
      ${lignes}
    </ul>`;
}

// Une <li> par voie, mais display:contents en CSS (voir style-carte.css) :
// ses enfants deviennent des items du grid porté par .detail-voies-liste —
// alignement en vraies colonnes sur TOUTE la liste (nom/cotation/points/
// hauteur), pas juste au sein d'une ligne. Chaque ligne émet TOUJOURS ses 5
// cellules, même vides (points/hauteur en particulier) : une grille a besoin
// d'un nombre de cellules fixe par ligne pour que l'alignement colonne par
// colonne reste correct d'une voie à l'autre. Le repère couenne/grande voie
// est enveloppé dans .detail-voie-type (pas directement .histo-swatch en
// cellule de grille) : la cellule porte le padding/la bordure de séparation
// de ligne, le carré lui-même doit en rester indemne pour garder EXACTEMENT
// les mêmes proportions que dans la légende de l'histogramme juste au-dessus
// (repéré en test : le padding de la cellule, appliqué directement sur un
// carré de 8px avec box-sizing:border-box, l'écrasait en rectangle 8×13).
// nb_points rempli à 59,6% des voies seulement (jeu de données actuel) :
// omission pure si absent (cellule vide, pas de texte) — jamais "0"/"N/A",
// qui se lirait comme "aucun point" (faux signal de sécurité) plutôt que
// "non renseigné". 0 est affiché tel quel quand IL EST réellement saisi (ex.
// certaines traversées sans point fixe) : != null distingue bien les deux
// cas. Partagé entre les 3 formes de ligne (voie/en-tête/longueur) : mêmes
// champs nb_points/hauteur_estimee_m, qu'ils viennent d'une voie ou d'une
// longueur individuelle (voir export_geojson.py, struct "longueurs").
function formatPoints(nbPoints) {
  return nbPoints != null ? `${nbPoints} pt${nbPoints > 1 ? 's' : ''}` : '';
}
// hauteur_estimee_m : affichée en chiffre nu (pas de "≈", jugé superflu à
// l'usage) — reste malgré tout une estimation lue sur photo de topo, jamais
// un métrage terrain.
function formatHauteur(hauteurM) {
  return hauteurM != null ? `${hauteurM} m` : '';
}

function ligneDetailVoie(v, index) {
  // Fond alterné 1 ligne sur 2 (repéré comme utile pour suivre une ligne des
  // yeux jusqu'à la colonne Hauteur, la plus éloignée du nom) : classe posée
  // ici plutôt que déduite en CSS par nth-child — chaque voie émet 5
  // cellules dans une grille aplatie par display:contents (voir CSS), et la
  // ligne d'en-tête (elle aussi 5 cellules) décale tout calcul nth-child
  // purement CSS ; un index explicite reste correct quel que soit le nombre
  // de colonnes ou la présence de l'en-tête.
  const impaire = index % 2 === 1;
  return `
    <li class="detail-voie${impaire ? ' detail-voie-impaire' : ''}">
      <span class="detail-voie-type"><span class="histo-swatch ${classeSwatch(v)}"></span></span>
      <span class="detail-voie-nom">${escapeHtml(v.nom)}</span>
      <span class="detail-voie-cotation">${escapeHtml(libelleCotationAffichee(v.cotation))}</span>
      <span class="detail-voie-points">${formatPoints(v.nb_points)}</span>
      <span class="detail-voie-hauteur">${formatHauteur(v.hauteur_estimee_m)}</span>
    </li>`;
}

// Mode Position, sous-ligne d'une longueur (grande voie uniquement, voir
// construireListePosition) : le repère couenne/gv ne se répète pas (déjà
// porté par la ligne "voie" juste au-dessus, cellule laissée vide plutôt que
// de dupliquer le même carré à chaque longueur), remplacé par "L1"/"L2"...
// à la place du nom — indentée en CSS (voir style-carte.css,
// .detail-voie-longueur) pour signaler visuellement son appartenance à la
// voie précédente plutôt qu'une voie indépendante dans la liste.
function ligneDetailLongueur(l, indexGroupe) {
  const impaire = indexGroupe % 2 === 1;
  return `
    <li class="detail-voie detail-voie-longueur${impaire ? ' detail-voie-impaire' : ''}">
      <span class="detail-voie-type"></span>
      <span class="detail-voie-nom">L${l.numero_longueur}</span>
      <span class="detail-voie-cotation">${escapeHtml(libelleCotationAffichee(l.cotation))}</span>
      <span class="detail-voie-points">${formatPoints(l.nb_points)}</span>
      <span class="detail-voie-hauteur">${formatHauteur(l.hauteur_estimee_m)}</span>
    </li>`;
}
