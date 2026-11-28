// detail-voies.js — liste détaillée des voies d'une falaise (tri par cotation
// ou par position, longueurs des grandes voies). Pur templating.

import { escapeHtml } from './utils.js';
import { cotationVersValeur, approximerCotation } from './donnees.js';

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

// Même normalisation qu'à l'histogramme, sinon la MÊME voie afficherait deux
// cotations différentes selon qu'on la lit dans l'un ou dans cette liste. Une
// cotation ni standard ni approximable reste affichée telle quelle.
function libelleCotationAffichee(cotation) {
  if (cotationVersValeur(cotation) != null) return cotation;
  // "6c+/A0" garde son passage d'artif : seul le positionnement l'ignore.
  if (/[ABC]\d/.test(cotation)) return cotation;
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

// Rang d'une cotation artificielle : le chiffre du grade A ou C (A0 à A5, "C1").
// La cotation est saisie telle quelle dans les données, parfois avec le
// passage libre ("5c/A1", "A1/A2", "C1-5b") : on cherche le grade d'artif, pas
// le premier chiffre venu. Illisible ou absente, la voie part en fin de liste,
// même motif que valeurCotationPourTri.
function valeurAidePourTri(v) {
  const m = /[AC](\d)/.exec(String(v.cotation_artif ?? ''));
  return m ? Number(m[1]) : Infinity;
}

// Les trois styles détaillés, dans l'ordre d'affichage : les sportives
// d'abord (comme avant), puis trad et artif à la suite. Un groupe vide est
// omis : clés absentes du fichier de routes (export amont pas encore fait) =
// détail identique à celui d'avant. `libelle` sert de sous-titre quand
// plusieurs groupes coexistent (même libellé que la colonne Grimpe).
const GROUPES_DETAIL = [
  { groupe: 'sportive', cle: 'sportives', libelle: 'Sportive' },
  { groupe: 'trad', cle: 'trad', libelle: 'Trad' },
  { groupe: 'artificielle', cle: 'artificielles', libelle: 'Artif' },
];

// detail : { sportives, trad, artificielles }, trois tableaux (éventuellement
// vides), voir detailDepuisEntree dans marqueurs.js.
// selection : (voie, groupe) => true | false | 'sans-cote', les filtres de voie
// actifs sur la carte (voir definirSelectionVoies, marqueurs.js). 'sans-cote' :
// la voie n'a pas de cotation comparable à la fourchette (artif pur "A1"),
// elle reste listée mais ne compte pas dans le titre. Absente = toutes les voies.
export function construireDetailVoies(detail, mode = 'cotation', selection = null) {
  const compte = (gs) => gs.reduce((total, g) => total + g.voies.length, 0);
  const tous = GROUPES_DETAIL.map((g) => ({ ...g, voies: (detail && detail[g.cle]) || [] }));
  let sansCote = 0;
  const groupes = tous
    .map((g) => (selection ? {
      ...g,
      voies: g.voies.filter((v) => {
        const retenue = selection(v, g.groupe);
        if (retenue === 'sans-cote') sansCote += 1;
        return retenue !== false;
      }),
    } : g))
    .filter((g) => g.voies.length);
  const n = compte(groupes) - sansCote;
  const nTotal = compte(tous);
  // Juste le compte (utile pour se repérer avant de faire défiler la liste),
  // sans répéter "(hors trad et artificielle)" : cette précision vient déjà
  // d'être lue à l'instant sur l'écran précédent (titre de l'histogramme,
  // voir construireHistogramme) — la redire ici alourdit sans rien apporter
  // de nouveau, contrairement à sa 1ère apparition où elle évite une
  // confusion avec le total "Voies" de la fiche compacte.
  const titre = `${n} voie${n > 1 ? 's' : ''}`
    + (n + sansCote < nTotal ? ` sur ${nTotal}` : '')
    + (sansCote ? ` · ${sansCote} sans cotation comparable` : '');
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
  const liste = construireListeVoies(groupes, mode);
  const bascule = (valeur, libelle) =>
    `<button type="button" class="btn-tri-voies${mode === valeur ? ' actif' : ''}" data-tri="${valeur}" aria-pressed="${mode === valeur}">${libelle}</button>`;
  // « Retour » en bas et non près du titre : fiche quasi plein écran sur
  // mobile, un bouton en haut tombe à l'opposé du pouce. En sticky dans la
  // liste, il reste atteignable au milieu de 40 voies.
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

// Liste des voies. Une grande voie (v.longueurs renseigné) devient, en mode
// Position, un GROUPE de lignes — une ligne "voie" (identique à ligneDetailVoie,
// valeurs globales déjà connues du mode Cotation) suivie d'une ligne indentée
// par longueur (cotation/points/hauteur DE cette longueur précise). La zébrure
// suit la VOIE (index), pas la ligne brute, pour que l'en-tête et ses
// sous-lignes restent visuellement une seule bande — sinon chaque longueur
// alternerait indépendamment, cassant la lecture "ceci est une seule voie".
//
// Mode Cotation (par défaut) : un bloc par style (sportives puis trad puis
// artif, voir GROUPES_DETAIL), chaque bloc trié séparément : une cotation
// française et une cotation A0-A5 ne se comparent pas, les mélanger n'aurait
// aucun ordre lisible. Du plus facile en haut au plus dur en bas (pas l'ordre
// alphabétique du nom, celui renvoyé par défaut côté SQL — sans rapport avec
// la difficulté). sort() est stable (ES2019+) : à cotation égale, l'ordre
// alphabétique d'origine sert de sous-tri, sans code dédié pour ça. Une ligne
// par voie, jamais de détail longueur par longueur ici. Sous-titre de bloc
// seulement quand plusieurs styles coexistent : une liste 100 % sportive (ou
// 100 % trad) reste identique à celle d'avant.
//
// Mode Position : UNE seule liste, tous styles confondus, trié de gauche à
// droite sur la paroi (voir valeurPositionPourTri) : le numéro est unique par
// secteur, quel que soit le style, et une voie trad entre deux sportives se
// lit à sa place sur la paroi. Ni sous-titre ni bloc ; le carré couenne /
// grande voie reste réservé aux sportives (voir ligneDetailVoie). Le nom
// lui-même ne porte aucun repère de position (pas de préfixe numéro : le
// badge actif "Position" du bandeau de tri suffit déjà à signaler que ce tri
// est bien appliqué, voir construireDetailVoies). À numéro égal ou absent,
// l'ordre sportive, trad, artif sert de départage (tri stable).
function construireListeVoies(groupes, mode) {
  let blocs;
  if (mode === 'position') {
    const voies = groupes.flatMap(({ groupe, voies }) => voies.map((v) => ({ v, groupe })));
    voies.sort((a, b) => valeurPositionPourTri(a.v) - valeurPositionPourTri(b.v));
    blocs = voies.map(({ v, groupe }, index) => {
      const entete = ligneDetailVoie(v, index, groupe);
      if (!v.longueurs || !v.longueurs.length) return entete;
      return entete + v.longueurs.map((l) => ligneDetailLongueur(l, index)).join('');
    }).join('');
  } else {
    const plusieursStyles = groupes.length > 1;
    blocs = groupes.map(({ groupe, libelle, voies }) => {
      const valeur = groupe === 'artificielle' ? valeurAidePourTri : valeurCotationPourTri;
      const lignes = [...voies].sort((a, b) => valeur(a) - valeur(b))
        .map((v, index) => ligneDetailVoie(v, index, groupe)).join('');
      const sousTitre = plusieursStyles ? `<li class="detail-voie-groupe">${escapeHtml(libelle)}</li>` : '';
      return sousTitre + lignes;
    }).join('');
  }
  return `
    <ul class="detail-voies-liste">
      <li class="detail-voie detail-voie-entete-colonnes" aria-hidden="true">
        <span class="detail-voie-type"></span><span>Voie</span><span>Cotation</span><span>Points</span><span>Hauteur</span>
      </li>
      ${blocs}
    </ul>`;
}

// Une <li> par voie, mais display:contents en CSS (voir assets/css/) :
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

// Cotation affichée selon le style : la française pour sportive (normalisée
// comme l'histogramme) ; pour trad, telle que saisie ("V+", "6b/A0", pas
// d'histogramme à laquelle l'aligner), avec la protection R/X/PG à côté quand
// elle existe ; cotation_artif telle que saisie pour l'artif. Champ absent =
// cellule vide, jamais "N/A".
function cotationDetailVoie(v, groupe) {
  if (groupe === 'artificielle') return escapeHtml(v.cotation_artif ?? '');
  const cotation = escapeHtml(groupe === 'trad' ? (v.cotation ?? '') : libelleCotationAffichee(v.cotation));
  if (groupe === 'trad' && v.protection) {
    return `${cotation}<span class="detail-voie-protection">${escapeHtml(v.protection)}</span>`;
  }
  return cotation;
}

function ligneDetailVoie(v, index, groupe = 'sportive') {
  // Classe posée ici et non par nth-child en CSS : display:contents aplatit
  // chaque voie en 5 cellules et la ligne d'en-tête décale tout calcul CSS.
  const impaire = index % 2 === 1;
  // Le carré couenne / grande voie n'a de sens que pour une sportive : trad et
  // artif gardent la cellule, vide, pour que les colonnes restent alignées
  // avec les sportives du même tableau.
  const repere = groupe === 'sportive'
    ? `<span class="histo-swatch ${classeSwatch(v)}"></span>`
    : '';
  return `
    <li class="detail-voie${impaire ? ' detail-voie-impaire' : ''}">
      <span class="detail-voie-type">${repere}</span>
      <span class="detail-voie-nom">${escapeHtml(v.nom)}</span>
      <span class="detail-voie-cotation">${cotationDetailVoie(v, groupe)}</span>
      <span class="detail-voie-points">${formatPoints(v.nb_points)}</span>
      <span class="detail-voie-hauteur">${formatHauteur(v.hauteur_estimee_m)}</span>
    </li>`;
}

// Mode Position, sous-ligne d'une longueur (grande voie uniquement, voir
// construireListePosition) : le repère couenne/gv ne se répète pas (déjà
// porté par la ligne "voie" juste au-dessus, cellule laissée vide plutôt que
// de dupliquer le même carré à chaque longueur), remplacé par "L1"/"L2"...
// à la place du nom — indentée en CSS (voir assets/css/,
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
