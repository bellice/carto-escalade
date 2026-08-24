// donnees.js — lecture/normalisation des propriétés GeoJSON : identifiants,
// libellés, agrégats (max/médiane, bornes de cotation par site), et les
// prédicats de visibilité d'une falaise (mode "Cercles" + recherche/filtres).
// Aucune dépendance : ces fonctions travaillent uniquement sur les
// properties GeoJSON ou sur la forme "entree" construite par marqueurs.js.

// Le secteur n'est affiché/utilisé que s'il apporte une info distincte du nom
// (les falaises à secteur unique ont souvent secteur === nom dans les données).
export function secteurDistinct(p) {
  return p.secteur && p.secteur !== p.nom ? p.secteur : null;
}

// Identifiant unique d'une falaise. Depuis l'ajout des secteurs, plusieurs
// features peuvent partager le même "nom" (un même sommet, plusieurs
// secteurs) — nom seul ne suffit plus, d'où nom+secteur quand ils diffèrent.
export function cleFalaise(p) {
  const s = secteurDistinct(p);
  return s ? `${p.nom}::${s}` : p.nom;
}

// Texte affiché pour une falaise (titre de popup sur une ligne, autocomplétion,
// liens croisés) : "nom" seul, ou "nom · secteur" quand le secteur distingue.
export function libelleFalaise(p) {
  const s = secteurDistinct(p);
  return s ? `${p.nom} · ${s}` : p.nom;
}

// Pour chaque parking : les falaises (secteurs) qui le référencent — clé,
// sommet (nom) et secteur distinct séparément (pour pouvoir les regrouper
// par sommet dans la popup, voir champLiensFalaises dans popups.js) — et
// l'ensemble des "site" de ces falaises, pour le badge affiché sur la popup
// parking.
export function indexerParkingInfos(geojson) {
  const infos = new Map();
  geojson.features.forEach(f => {
    const p = f.properties;
    if (p.categorie !== 'falaise' || !p.parking_associe || !p.parking_associe.length) return;
    const cle = cleFalaise(p);
    const secteur = secteurDistinct(p);
    p.parking_associe.forEach(nomParking => {
      if (!infos.has(nomParking)) infos.set(nomParking, { falaises: [], sites: new Set() });
      const info = infos.get(nomParking);
      info.falaises.push({ cle, nom: p.nom, secteur });
      if (p.site) info.sites.add(p.site);
    });
  });
  return infos;
}

// "Voies faciles" (≤ 6a+) : depuis la disparition de nb_voies_cot5/cot6a
// (couvraient uniquement les grades 5 et 6a/6a+, angle mort documenté sur
// les voies encore plus faciles en 3/4), dérivé directement de la cotation
// réelle de chaque voie — corrige cet angle mort au passage.
const SEUIL_FACILE = cotationVersValeur('6a+');

// nb_couenne/nb_gv n'existent plus comme champs source : reconstruits à
// partir du détail voies_sportives (type_voie ne prend que "couenne" ou
// "grande voie" dans les vraies données). Source unique, réutilisée par
// calculerMaxima ci-dessous ET par la construction de "entree" dans
// marqueurs.js — pas de logique dupliquée entre les deux.
export function compterVoiesSportivesParType(voiesSportives) {
  let couenne = 0, grandeVoie = 0, faciles = 0;
  (voiesSportives || []).forEach(v => {
    if (v.type_voie === 'couenne') couenne++;
    else if (v.type_voie === 'grande voie') grandeVoie++;
    const val = cotationVersValeur(v.cotation);
    if (val != null && val <= SEUIL_FACILE) faciles++;
  });
  return { couenne, grandeVoie, faciles };
}

// Temps de trajet EN VOITURE gîte -> parking, par le meilleur parking
// associé à chaque falaise (trajet_gite_min, sur la feature parking) —
// délibérément SANS l'approche à pied (approche_min, sur la falaise) :
// mélanger les deux donnait un chiffre composite qui ne correspondait plus à
// rien de précis (deux falaises servies par le même parking, mais à 5 min et
// 45 min de marche l'une de l'autre, se retrouvaient avec des temps
// "depuis le gîte" différents alors que le trajet routier réel est
// identique) — et surtout, plus la même grandeur que "Depuis le gîte" déjà
// affiché sur le popup parking (en voiture, seul). Un seul sens pour "depuis
// le gîte" dans toute l'app. L'approche à pied reste visible séparément,
// propre à chaque falaise (voir champ "Approche", popups.js) — pas perdue,
// juste hors de ce filtre. Minimum sur tous les parkings associés (un
// grimpeur choisirait le plus rapide, pas une moyenne). null si aucun
// parking associé n'a de trajet_gite_min renseigné — utilisé par le filtre
// "Depuis le gîte" (carte.js) pour masquer les falaises trop éloignées, une
// falaise sans temps calculable reste affichée par défaut (on ne peut pas
// prouver qu'elle est hors plage).
export function calculerTempsDepuisGite(geojson) {
  const trajetParParking = new Map();
  geojson.features.forEach(f => {
    const p = f.properties;
    if (p.categorie === 'parking' && p.trajet_gite_min != null) {
      trajetParParking.set(p.nom, p.trajet_gite_min);
    }
  });

  const temps = new Map(); // cleFalaise -> minutes
  geojson.features.forEach(f => {
    const p = f.properties;
    if (p.categorie !== 'falaise') return;
    const noms = p.parking_associe || [];
    let meilleur = null;
    noms.forEach((nom) => {
      const gite = trajetParParking.get(nom);
      if (gite == null) return;
      if (meilleur == null || gite < meilleur) meilleur = gite;
    });
    if (meilleur != null) temps.set(cleFalaise(p), meilleur);
  });
  return temps;
}

export function calculerMaxima(geojson) {
  const totaux = [], couennes = [], gvs = [], faciles = [];
  geojson.features.forEach(f => {
    if (f.properties.categorie !== 'falaise') return;
    const p = f.properties;
    totaux.push(p.nb_voie_total || 0);
    const compte = compterVoiesSportivesParType(p.voies_sportives);
    couennes.push(compte.couenne);
    gvs.push(compte.grandeVoie);
    faciles.push(compte.faciles);
  });
  return {
    total: Math.max(0, ...totaux), totalMedian: mediane(totaux),
    couenne: Math.max(0, ...couennes), couenneMedian: mediane(couennes),
    gv: Math.max(0, ...gvs), gvMedian: mediane(gvs),
    faciles: Math.max(0, ...faciles), facilesMedian: mediane(faciles),
  };
}

function mediane(valeurs) {
  const tri = [...valeurs].sort((a, b) => a - b);
  const n = tri.length;
  if (!n) return 0;
  const milieu = Math.floor(n / 2);
  return n % 2 ? tri[milieu] : Math.round((tri[milieu - 1] + tri[milieu]) / 2);
}

// Cotation française -> position numérique continue sur une échelle 3a→9c+
// (0 à 20.5), pour placer la jauge min→max. Repli silencieux (jauge omise)
// si le texte ne correspond pas au format attendu.
export function cotationVersValeur(cotation) {
  if (!cotation) return null;
  const m = /^(\d)([abc])(\+)?$/.exec(String(cotation).trim());
  if (!m) return null;
  const chiffre = Number(m[1]);
  const lettre = { a: 0, b: 1, c: 2 }[m[2]];
  const plus = m[3] ? 0.5 : 0;
  return (chiffre - 3) * 3 + lettre + plus;
}

// En mode thématique (tout sauf "aucun"), une falaise sans donnée pour la
// grandeur affichée (0 ou absente) n'a rien à montrer sur ce thème : un
// petit cercle laisserait croire à une petite quantité plutôt qu'à une
// absence. Utilisée à la fois pour masquer le marqueur (dessinerFalaise,
// symboles.js) et pour exclure ces falaises de la cascade de visibilité des
// parkings (appliquerFiltres, carte.js) — sinon un parking reste affiché
// seul, sans qu'aucune falaise visible ne justifie sa présence sur ce thème.
export function estFalaiseVideDansMode(entree, mode) {
  if (mode === 'couenne') return !entree.nbCouenne;
  if (mode === 'gv') return !entree.nbGrandeVoie;
  if (mode === 'faciles') return !entree.nbFaciles;
  return false;
}

// Lit l'état réel du DOM plutôt que de refaire le calcul (mode + recherche) :
// deux mécanismes indépendants peuvent masquer un marqueur falaise — la
// classe marqueur-invisible (dessinerFalaise, piloté par le mode "Cercles")
// et le style.display (appliquerFiltres, piloté par la recherche/sélection).
// Utilisée par appliquerAntiCollisionSecteurs pour ne garder un libellé de
// secteur que s'il lui reste au moins un figuré ponctuel visible en dessous.
export function falaiseVisible(entree) {
  const el = entree.marker.getElement();
  return !el.classList.contains('marqueur-invisible') && el.style.display !== 'none';
}
