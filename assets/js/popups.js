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
const ROSE_RAYON_POINTS = 12; // distance centre -> pastille, px
const ROSE_RAYON_LABELS = 22; // distance centre -> libellé, px

function roseDesVents(orientation) {
  const actifs = new Set(orientation.split('|').map(s => s.trim()).filter(Boolean));

  const points = POINTS_ROSE.map((point, i) => {
    const angle = i * 45;
    const classe = actifs.has(point) ? 'rose-vents-point rose-vents-point-actif' : 'rose-vents-point';
    return `<span class="${classe}" style="transform: rotate(${angle}deg) translateY(-${ROSE_RAYON_POINTS}px);"></span>`;
  }).join('');

  // Réserve tout de même un repère "N" discret même hors zone orientée (sauf
  // si N est déjà actif, pour ne pas doubler le libellé) : la position en
  // haut de l'anneau ne suffit à elle seule que si on sait déjà que la carte
  // est orientée nord en haut — un rappel textuel évite d'avoir à le savoir.
  const labels = POINTS_ROSE
    .filter(point => actifs.has(point) || point === 'N')
    .map(point => {
      const angle = POINTS_ROSE.indexOf(point) * 45;
      const classe = actifs.has(point) ? 'rose-vents-label rose-vents-label-actif' : 'rose-vents-label';
      return `<span class="${classe}" style="transform: rotate(${angle}deg) translateY(-${ROSE_RAYON_LABELS}px) rotate(${-angle}deg);">${escapeHtml(point)}</span>`;
    }).join('');

  return `
    <div class="rose-vents" role="img" aria-label="Orientation : ${escapeHtml(Array.from(actifs).join(', '))}">
      <div class="rose-vents-cercle"></div>
      ${points}
      ${labels}
    </div>`;
}

// Orientation en haut à droite de l'en-tête falaise (voir popup-entete) : ce
// champ sort de la fiche d'infos pour gagner de la place, donc doit rester
// lisible par un lecteur d'écran via l'aria-label posé dans roseDesVents. Le
// type de roche (lui, resté dans la fiche, voir popupFalaise) n'a pas ce
// problème de place : pas de widget dédié à construire, juste une valeur texte.
function construireCoinInfos(orientation) {
  if (!orientation) return '';
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

export function popupFalaise(p, lat, lon, cle, bornesSite) {
  // Deux groupes distincts, séparés par un espacement plus grand qu'entre
  // deux lignes du même groupe (voir .fiche-groupe-suivant) — pas de trait ni
  // de fond, juste plus de blanc : le regroupement par proximité (Gestalt)
  // suffit à signaler "nouveau sujet" sans ajouter le moindre élément visuel.
  const rowsCaractere = []; // à quoi ressemble l'escalade ici
  const rowsLogistique = []; // comment y aller

  if (p.type_roche) rowsCaractere.push(champ('Roche', p.type_roche));
  if (p.cotation_min || p.cotation_max) {
    rowsCaractere.push(champCotation(p.cotation_min, p.cotation_max, bornesSite));
  }
  if (p.nb_voies) {
    const cot5 = p.nb_voies_cot5 ?? 0;
    const cot6a = p.nb_voies_cot6a ?? 0;
    rowsCaractere.push(champVoies(p.nb_voies, cot5, cot6a));
  }
  if (p.parking_associe) {
    const noms = p.parking_associe.split('|').map(s => s.trim()).filter(Boolean);
    rowsLogistique.push(champParkingAssocie(noms, p.approche_min));
    // Plusieurs parkings : le temps est déjà sur chaque bouton (voir
    // champParkingAssocie), pas de ligne "Approche" séparée à dupliquer.
    if (noms.length === 1 && p.approche_min) {
      rowsLogistique.push(champ('Approche', `${p.approche_min} min` + (p.approche_metre ? ` (${p.approche_metre} m)` : '')));
    }
  }

  const rows = [
    rowsCaractere.join(''),
    rowsLogistique.length ? `<div class="fiche-groupe-suivant">${rowsLogistique.join('')}</div>` : '',
  ];

  const secteur = secteurDistinct(p);
  const lienOblyk = p.lien_oblyk ? `<a href="${escapeHtml(p.lien_oblyk)}" target="_blank" rel="noopener">Voir sur Oblyk</a>` : '';
  const lienC2C = p.lien_camptocamp ? `<a href="${escapeHtml(p.lien_camptocamp)}" target="_blank" rel="noopener">Voir sur Camp to Camp</a>` : '';

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
  if (p.trajet_gite_min) rows.push(champ('Depuis le gîte', `${p.trajet_gite_min} min en voiture`));

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

// Parking(s) associé(s) à une falaise : le nom réel du parking (souvent une
// description type "petit parking D136") n'aide pas à décider de cliquer —
// seul le fait qu'il y en ait un compte. Cas courant (61 falaises/71, un
// seul parking) : un verbe d'action plutôt qu'un nom — et surtout pas le mot
// "parking" une 2e fois, déjà dit par le libellé juste à gauche (repéré après
// coup : "Parking" suivi de "Voir le parking" faisait doublon). Plusieurs
// parkings (toujours 3 ici dans les données, jamais 2) : impossible de rester
// générique, il faut bien distinguer les destinations — un simple rang
// (1/2/3) suffit, dans l'ordre où data.geojson les liste.
function champParkingAssocie(noms, approcheMin) {
  const approches = noms.length > 1 && approcheMin
    ? approcheMin.split('|').map(s => s.trim())
    : null;
  const valeur = noms.length === 1
    ? `<button type="button" class="lien-secteur" data-nom="${escapeHtml(noms[0])}">Voir sur la carte</button>`
    : noms.map((nom, i) => {
        const duree = approches && approches[i] ? ` (${approches[i]} min)` : '';
        return `<button type="button" class="lien-secteur" data-nom="${escapeHtml(nom)}">Parking ${i + 1}${duree}</button>`;
      }).join(' · ');
  return `<div class="info-ligne"><span class="info-label">Parking</span><span class="info-valeur">${valeur}</span></div>`;
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
  return `<div class="info-ligne"><span class="info-label">Falaises</span></div><div class="falaises-detail">${groupes}</div>`;
}

// Grille "1 case = 1 voie" (isotype, pas un waffle chart classique — celui-là
// représente des pourcentages sur 10×10, ici c'est un compte réel) ET
// légende, les deux ensemble : la grille seule (1re version) n'avait pas de
// légende, la légende seule (2e version) perdait l'intérêt visuel de "voir"
// la quantité d'un coup d'œil et de comparer deux falaises entre elles rien
// qu'à la taille du bloc — aucune des deux versions seules ne suffisait.
// La légende réutilise EXACTEMENT les mêmes carrés que la grille (même
// classe .voies-case) : la puce et la case sont littéralement la même
// marque, pas juste la même couleur. nb_voies_cot5/cot6a ne couvrent que les
// grades 5 et 6a-6a+ : il peut y avoir des voies encore plus faciles (3, 4 —
// bien présentes dans les données, cf. cotation_min) non comptées ailleurs —
// la case/puce "autres" reste un contour creux, sans prétendre dire si c'est
// plus facile ou plus dur.
// Le total va dans la valeur à droite du libellé (comme tous les autres
// champs), la grille s'affiche TOUJOURS en dessous — même sans une seule
// voie en 5 ou 6a/6a+, le total reste une info utile même sans détail par
// grade.
function champVoies(total, cot5, cot6a) {
  if (!total) return '';
  const reste = Math.max(0, total - cot5 - cot6a);
  const case_ = (classe) => `<span class="voies-case ${classe}"></span>`;

  const grille = `<div class="voies-grille" role="img" aria-label="${total} voies au total, dont ${cot5} en 5 et ${cot6a} en 6a/6a+">${[
    ...Array(cot5).fill('voies-case-5'),
    ...Array(cot6a).fill('voies-case-6a'),
    ...Array(reste).fill('voies-case-reste'),
  ].map(case_).join('')}</div>`;

  // Pas de compte répété ici (pas de "4 en 5") : les carrés eux-mêmes portent
  // déjà la quantité (il suffit de les compter/regrouper par couleur), la
  // légende n'a plus qu'à dire CE QUE chaque couleur signifie. "5" et
  // "6a/6a+" restent toujours affichés, même à 0 : une légende qui change de
  // contenu d'une popup à l'autre s'apprend mal, et voir "5" sans le moindre
  // carré de cette couleur EST l'information (aucune voie dans ce grade ici),
  // pas une case à cacher.
  const groupes = [['voies-case-5', '5'], ['voies-case-6a', '6a/6a+']];
  if (reste) groupes.push(['voies-case-reste', 'autres']);
  const legende = `<div class="voies-detail">${groupes.map(([classe, texte]) => `<span class="voies-groupe">${case_(classe)}${texte}</span>`).join('')}</div>`;

  return `<div class="info-ligne"><span class="info-label">Voies sportives</span><span class="info-valeur">${total}</span></div>${grille}${legende}`;
}

// Bornes d'échelle affichées de part et d'autre de la jauge : sans elles, le
// segment coloré n'a aucun repère et sa position/largeur n'est pas décodable.
// bornesSite (voir calculerBornesCotationParSite dans donnees.js) : omis si
// le site n'a qu'une seule cotation connue au total (bornes.max ===
// bornes.min, ex. site à une seule falaise) — une échelle à largeur nulle
// n'a rien à montrer.
function jaugeCotation(min, max, bornesSite) {
  const vMin = cotationVersValeur(min);
  const vMax = cotationVersValeur(max);
  if (vMin == null || vMax == null) return '';
  if (!bornesSite || bornesSite.max <= bornesSite.min) return '';
  const echelle = bornesSite.max - bornesSite.min;
  const debut = ((vMin - bornesSite.min) / echelle) * 100;
  const largeur = Math.max(((vMax - vMin) / echelle) * 100, 3);
  return `
    <div class="jauge-cotation" role="img" aria-label="Cotation de ${escapeHtml(min)} à ${escapeHtml(max)}, sur l'échelle des cotations du site (${escapeHtml(bornesSite.minLabel)} à ${escapeHtml(bornesSite.maxLabel)})">
      <span class="jauge-segment" style="left:${debut}%; width:${largeur}%"></span>
    </div>
    <div class="jauge-echelle"><span>${escapeHtml(bornesSite.minLabel)}</span><span>${escapeHtml(bornesSite.maxLabel)}</span></div>`;
}

function champCotation(min, max, bornesSite) {
  const jauge = jaugeCotation(min, max, bornesSite);
  const valeur = `${escapeHtml(min ?? '?')} → ${escapeHtml(max ?? '?')}`;
  return `<div class="info-ligne"><span class="info-label">Cotation</span><span class="info-valeur">${valeur}</span></div>${jauge}`;
}
