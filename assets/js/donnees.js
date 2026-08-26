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

// nb_couenne/nb_gv/nb_faciles ne sont PLUS calculés ici : précalculés à la
// GÉNÉRATION (voir scripts/export_geojson.py, repo escalade — le SQL y doit
// rester le miroir de ce que cotationVersValeur + la règle "facile ≤ 6a+"
// produisaient côté client). Ça permet de ne pas embarquer le détail
// voies_sportives dans le fichier web principal (chargé à la demande dans
// les popups, voir marqueurs.js) — c'était ~70% du poids du geojson.

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

// Table de référence des sources (voir export_geojson.py, sources_lookup) :
// une falaise ne porte qu'un topo_id/source_id (texte court), résolu ici en
// {nom, url, ...} une seule fois au chargement plutôt que de dupliquer ces
// champs sur chaque falaise côté export — même géojson.sources déjà exporté,
// jusqu'ici jamais lu côté site.
export function indexerSources(geojson) {
  const index = new Map();
  (geojson.sources || []).forEach(s => index.set(s.id, s));
  return index;
}

export function calculerMaxima(geojson) {
  const totaux = [], couennes = [], gvs = [], faciles = [];
  geojson.features.forEach(f => {
    if (f.properties.categorie !== 'falaise') return;
    const p = f.properties;
    totaux.push(p.nb_voie_total || 0);
    couennes.push(p.nb_couenne || 0);
    gvs.push(p.nb_gv || 0);
    faciles.push(p.nb_faciles || 0);
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
// absence. Utilisée à la fois pour exclure ces falaises de la SOURCE native
// (construireSourceFalaises, symboles.js) et de la cascade de visibilité des
// parkings (appliquerFiltres, carte.js) — sinon un parking reste affiché
// seul, sans qu'aucune falaise visible ne justifie sa présence sur ce thème.
export function estFalaiseVideDansMode(entree, mode) {
  if (mode === 'couenne') return !entree.nbCouenne;
  if (mode === 'gv') return !entree.nbGrandeVoie;
  if (mode === 'faciles') return !entree.nbFaciles;
  return false;
}

// NOTE : l'ancienne fonction falaiseVisible (lecture du DOM d'un marqueur)
// a été retirée à la Phase 3 — les falaises sont rendues en couche native
// (source "falaises"), sans marqueur DOM. La logique équivalente vit
// désormais dans carte.js sous le nom entreeVisible() (Set falaisesVisibles
// maintenu par appliquerFiltres).
