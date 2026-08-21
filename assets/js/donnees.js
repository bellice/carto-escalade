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
    if (p.categorie !== 'falaise' || !p.parking_associe) return;
    const cle = cleFalaise(p);
    const secteur = secteurDistinct(p);
    p.parking_associe.split('|').map(s => s.trim()).filter(Boolean).forEach(nomParking => {
      if (!infos.has(nomParking)) infos.set(nomParking, { falaises: [], sites: new Set() });
      const info = infos.get(nomParking);
      info.falaises.push({ cle, nom: p.nom, secteur });
      if (p.site) info.sites.add(p.site);
    });
  });
  return infos;
}

export function calculerMaxima(geojson) {
  const totaux = [], couennes = [], gvs = [], faciles = [];
  geojson.features.forEach(f => {
    if (f.properties.categorie !== 'falaise') return;
    const p = f.properties;
    totaux.push(p.nb_voies || 0);
    couennes.push(p.nb_couenne || 0);
    gvs.push(p.nb_gv || 0);
    faciles.push((p.nb_voies_cot5 || 0) + (p.nb_voies_cot6a || 0));
  });
  return {
    total: Math.max(0, ...totaux), totalMedian: mediane(totaux),
    couenne: Math.max(0, ...couennes), couenneMedian: mediane(couennes),
    gv: Math.max(0, ...gvs), gvMedian: mediane(gvs),
    faciles: Math.max(0, ...faciles), facilesMedian: mediane(faciles),
  };
}

export function mediane(valeurs) {
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

// Regroupe les falaises par site (voir p.site — 10 sites distincts dans
// cette sortie, de 1 à 24 falaises chacun, souvent à des dizaines de minutes
// les uns des autres) et calcule, pour chacun, l'étendue RÉELLE des
// cotations rencontrées. Sert d'échelle à jaugeCotation (popups.js) : une
// échelle fixe 3a→9c+ (le spectre théorique du sport) tasse toutes les
// falaises d'un même site dans une petite portion de la barre — ici, la
// plupart des sites plafonnent bien avant 9c+, donc l'essentiel de la barre
// ne servait jamais. Recalé sur les bornes réelles du site, la position
// d'une falaise devient directement comparable à ses voisines du même site.
export function calculerBornesCotationParSite(geojson) {
  const parSite = new Map();
  geojson.features.forEach(f => {
    const p = f.properties;
    if (p.categorie !== 'falaise') return;
    if (!parSite.has(p.site)) parSite.set(p.site, { min: Infinity, max: -Infinity, minLabel: null, maxLabel: null });
    const bornes = parSite.get(p.site);
    const vMin = cotationVersValeur(p.cotation_min);
    const vMax = cotationVersValeur(p.cotation_max);
    if (vMin != null && vMin < bornes.min) { bornes.min = vMin; bornes.minLabel = p.cotation_min; }
    if (vMax != null && vMax > bornes.max) { bornes.max = vMax; bornes.maxLabel = p.cotation_max; }
  });
  return parSite;
}

// En mode thématique (tout sauf "aucun"), une falaise sans donnée pour la
// grandeur affichée (0 ou absente) n'a rien à montrer sur ce thème : un
// petit cercle laisserait croire à une petite quantité plutôt qu'à une
// absence. Utilisée à la fois pour masquer le marqueur (dessinerFalaise,
// symboles.js) et pour exclure ces falaises de la cascade de visibilité des
// parkings (appliquerFiltres, carte.js) — sinon un parking reste affiché
// seul, sans qu'aucune falaise visible ne justifie sa présence sur ce thème.
export function estFalaiseVideDansMode(entree, mode) {
  if (mode === 'type') return (entree.nbGrandeVoie + entree.nbCouenne) === 0;
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
