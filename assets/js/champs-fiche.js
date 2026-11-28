// champs-fiche.js — lignes et colonnes d'information de la fiche (Voies,
// Grimpe, Roche, hauteur, parkings desservis, secteurs d'un parking). Pur
// templating, aucun état.

import { escapeHtml } from './utils.js';

// hauteur_max_voie_m est un PLAFOND DE SECTEUR, jamais la hauteur d'une voie
// et jamais une longueur de corde. Vérifié sur les données : un plafond de
// 350 m coexiste avec une voie de 13 longueurs, et sur « L'Éperon » le plafond
// saisi (150 m) est de l'ordre de la voie entière calculée (185 m), jamais
// d'une longueur (50 m). C'est la hauteur de la paroi.
//
// D'où DEUX libellés, et c'est le libellé qui porte la distinction :
//   secteur sans grande voie   « Hauteur 30 m »   se lit directement en corde
//   secteur avec grande voie   « Paroi 350 m »    ne se confond avec rien
//
// C'est la seule donnée du site dont une mauvaise lecture a une conséquence
// physique : annoncer « hauteur 350 m » sur une grande voie laisserait croire
// qu'il faut une corde de 350 m. Ne jamais fusionner ces deux libellés.
//
// Renvoie null quand la donnée manque (12 secteurs sur 171) : la colonne
// disparaît plutôt que d'afficher un tiret ou une valeur par défaut.
export function colonneHauteur(p) {
  const m = p && p.hauteur_max_voie_m;
  if (typeof m !== 'number' || !(m > 0)) return null;
  return { label: (p.nb_gv || 0) > 0 ? 'Paroi' : 'Hauteur', valeur: `${m} m` };
}

// Variante "bloc" (voir .info-bloc) : libellé sur sa propre ligne, valeur en
// pleine largeur en dessous — pour une valeur à donner en évidence (ex. le
// temps de trajet "71 min en voiture" dans la popup parking) plutôt que
// serrée à droite d'un libellé.
export function champBloc(label, valeur) {
  return `<div class="info-bloc"><span class="info-label">${label}</span><span class="info-valeur">${escapeHtml(String(valeur))}</span></div>`;
}

// Mini-colonne d'info (Roche / Voies, fiche falaise) : label en petite
// majuscule au-dessus de la valeur (voir .fiche-infos-cols/.col).
export function col(label, valeur) {
  return `<div class="col"><span class="col-label">${label}</span><span class="col-valeur">${escapeHtml(String(valeur))}</span></div>`;
}

// « min à pied » et non « min » : approche_min est un temps de MARCHE, à ne
// pas confondre avec trajet_gite_min, en voiture — les deux se ressemblent
// d'un coup d'œil sans ce qualificatif.
export function champParkingAssocie(noms, approches) {
  // Chaque parking est une LIGNE cliquable avec son temps d'approche — modèle
  // uniforme entre 1 et N parkings : [P] Parking [n] · X min à pied. La ligne
  // entière navigue vers le parking (handler .parking-ligne dans actions-fiche.js,
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
// Au-delà de ce nombre d'entrées, la liste se replie. Seuil calé sur une
// HAUTEUR mesurée, pas sur une intuition : au parking principal de Pen-Hir,
// les 44 liens occupent 396 px alors que la partie visible de la fiche mobile
// en fait 380 — la liste chassait donc « Itinéraire » et « GPS » hors de
// l'écran, c'est-à-dire les deux seuls gestes qu'on vient faire en arrivant
// au parking. Douze liens tiennent en 4 à 5 lignes et leur laissent la place.
// La Drôme plafonne à 11 secteurs par parking (médiane 2) : elle n'est pas
// concernée, ce qui est une observation, pas la raison du seuil.
const SEUIL_REPLI_FALAISES = 12;

export function champLiensFalaises(falaises) {
  const parNom = new Map();
  falaises.forEach(f => {
    if (!parNom.has(f.nom)) parNom.set(f.nom, []);
    parNom.get(f.nom).push(f);
  });

  const bouton = (f, texte) => `<button type="button" class="lien-secteur" data-nom="${escapeHtml(f.cle)}">${escapeHtml(texte)}</button>`;

  // Tri alphabétique, absent jusqu'ici : la liste sortait dans l'ordre du CSV,
  // ce qui se lit comme du hasard passé quelques entrées. PAS de tri par temps
  // d'approche, qui serait pourtant plus utile : cette donnée n'existe que
  // dans la Drôme (aucune approche saisie côté breton), et une liste dont
  // l'ordre change de sens d'une carte à l'autre vaut moins qu'un ordre
  // prévisible partout.
  const cmp = (a, b) => a.localeCompare(b, 'fr');
  const groupes = Array.from(parNom.entries())
    .sort(([a], [b]) => cmp(a, b))
    .map(([nom, items]) => {
      const liens = [...items]
        .sort((x, y) => cmp(x.secteur || nom, y.secteur || nom))
        .map(f => bouton(f, f.secteur || nom)).join(' · ');
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
  // « Secteurs » et non « Falaises » : ce sont des couples site+secteur, et le
  // résumé du repli dit déjà « N secteurs » — les deux se contredisaient.
  const etiquette = '<div class="info-ligne"><span class="info-label">Secteurs</span></div>';
  const liste = `<div class="liens-detail">${groupes}</div>`;
  if (falaises.length <= SEUIL_REPLI_FALAISES) return etiquette + liste;

  // <details> natif plutôt qu'un bouton câblé dans actions-fiche.js : rien à
  // ajouter au répartiteur de clics, et l'ouverture au clavier vient sans une
  // ligne de JS. Le compte reste lisible replié — « 44 secteurs » dit déjà
  // quelque chose d'utile : ce parking dessert toute la pointe.
  return `${etiquette}<details class="liens-replies"><summary>${falaises.length} secteurs</summary>${liste}</details>`;
}


// Synthèse "Voies" (total + répartition sportives/autres) : n'utilise que les
// compteurs du fichier principal, pas le détail des voies — affichée tout de
// suite à l'ouverture de la fiche, pendant que l'histogramme se charge à la
// demande. "autres" (trad/artificielle) n'est pas détaillé par voie (seul le
// compte existe dans les données) — pas d'histogramme pour cette part,
// seulement ce compteur global.
// Styles de grimpe de la falaise (colonne "Grimpe"), déduits des compteurs :
// la colonne Voies porte le TOTAL, l'histogramme ne montre que les SPORTIVES
// (titre "Cotation voies sportives") — la colonne Grimpe signale l'écart sans
// ligne de texte séparée. Tous les styles présents sont listés ("sportive,
// trad"), à la place de l'ancien "mixte" qui ne disait pas lesquels. Les
// données portent la répartition exacte (nb_voie_sportive / nb_voie_trad /
// nb_voie_artificielle) : on ne déduit plus le style d'un vague "autres".
// Libellé affiché quand il diffère du nom de donnée (le type interne reste
// 'artificielle', comme la clé nb_voie_artificielle et le filtre). Aligné sur
// la case « Artif » du filtre Style.
const LIBELLE_GRIMPE = { artificielle: 'artif' };

// Un secteur peut avoir plusieurs roches, saisies séparées par "|" dans
// falaise.csv (même convention que l'orientation) : affichées avec ", ", comme
// les styles de la colonne Grimpe, sans les barres verticales de la saisie.
export function libelleRoche(typeRoche) {
  return String(typeRoche).split('|').map((r) => r.trim()).filter(Boolean).join(', ');
}

export function styleGrimpe(p) {
  const total = p.nb_voie_total ?? 0;
  if (total <= 0) return '';
  // Ordre = ordre d'affichage de la liste.
  // « moulinette » comptait auparavant comme sportive, faute d'exister dans
  // le modèle : elle était donc annoncée à tort comme grimpe en tête.
  const styles = [
    ['sportive', p.nb_voie_sportive ?? 0],
    ['trad', p.nb_voie_trad ?? 0],
    ['artificielle', p.nb_voie_artificielle ?? 0],
    ['moulinette', p.nb_voie_moulinette ?? 0],
  ].filter(([, n]) => n > 0);
  return styles.map(([nom]) => LIBELLE_GRIMPE[nom] || nom).join(', ');
}
