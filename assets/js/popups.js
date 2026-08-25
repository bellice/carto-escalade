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
    // Pointes raccourcies (17/11 au lieu de 22/15) : à rayon 22, les pointes
    // cardinales venaient chevaucher les libellés placés à rayon 25
    // (enchevêtrement signalé au test). Les 4 cardinales restent nettement
    // plus longues que les intercardinales, toujours bien à l'intérieur de
    // l'anneau (r 24) — un net espace d'air entre la rose et les lettres.
    const rayon = cardinal ? 17 : 11;
    const demiL = cardinal ? 4 : 2.8;
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
    // il ne couvre que les SPORTIVES — le titre "Cotation voies sportives" et
    // la colonne Grimpe (mixte, le cas échéant) signalent l'écart avec le
    // total de la colonne Voies.
    contenuCaractere += `<div class="voies-histo-placeholder" data-route="${escapeHtml(String(p.routes))}"></div>`;
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

  const rows = [
    contenuCaractere,
    rowsLogistique.length ? `<div class="fiche-groupe-suivant"><div class="fiche-groupe-titre">Accès</div>${rowsLogistique.join('')}</div>` : '',
  ];

  const secteur = secteurDistinct(p);
  const lienOblyk = p.lien_oblyk ? `<a href="${escapeHtml(p.lien_oblyk)}" target="_blank" rel="noopener">Voir sur Oblyk</a>` : '';
  const lienC2C = p.lien_camptocamp ? `<a href="${escapeHtml(p.lien_camptocamp)}" target="_blank" rel="noopener">Voir sur Camptocamp</a>` : '';

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
        <a class="btn-primary" href="${lienItineraire(lat, lon, p.nom)}" target="_blank" rel="noopener">Itinéraire</a>
        ${boutonGps(lat, lon)}
        ${construireActionsSecondaires([lienOblyk, lienC2C])}
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
// Grimpe signale l'écart sans ligne de texte séparée. Limite assumée : les
// données ne distinguent pas trad et artificielle ("autres" recouvre les
// voies non sportives ; ici de grandes voies classiques) — "artificielle"
// serait le pendant de "trad" si les données le portaient un jour.
function styleGrimpe(p) {
  const total = p.nb_voie_total ?? 0;
  const sportive = p.nb_voie_sportive ?? 0;
  const autres = p.nb_voie_autres ?? 0;
  if (total <= 0) return '';
  if (autres <= 0) return 'sportive';
  if (sportive <= 0) return 'trad';
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
export function construireHistogramme(voiesSportives) {
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
  // par case) : le détail au tap sur une voie est reporté à une itération
  // future, annoncer individuellement jusqu'à plusieurs dizaines de cases
  // n'aiderait personne pour l'instant.
  //
  // TODO (en attente, pas de décision) : rendre chaque case cliquable pour
  // afficher nom/cotation/nb_longueur en popup secondaire. Valeur incertaine
  // à trancher avant de coder : utile sur les falaises à noms de voie
  // distinctifs (ex. "ALINÉA"), quasi nul sur celles à voies numérotées
  // ("1", "10"... — vieux topo). Et sans lien par voie vers un site
  // communautaire (seul lien_oblyk/lien_camptocamp existe, au niveau
  // falaise — voir donnees.js), le popup resterait pauvre. Ne pas
  // implémenter tant que ce calcul valeur/coût n'a pas été retranché.
  // Le titre "Cotation voies sportives" (plus haut, même voix typographique
  // que les colonnes Voies/Grimpe/Roche) et cette légende couenne/grande voie
  // sous l'histogramme sont deux classifications différentes qui s'enchaînent
  // sans signal de rupture : un micro-libellé annonce explicitement le
  // changement.
  const histo = `
    <span class="legende-titre">Cotation voies sportives</span>
    <div class="voies-histo" role="img" aria-label="Répartition des ${voiesSportives.length} voies sportives par cotation${nonCotees.length ? `, dont ${nonCotees.length} non côtées` : ''}">
      ${colonnesHtml}
    </div>
    <div class="histo-legende">${legende.join('')}</div>`;

  return histo;
}
