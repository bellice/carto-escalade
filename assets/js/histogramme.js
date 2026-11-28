// histogramme.js — histogramme « 1 case = 1 voie » des cotations sportives
// d'une falaise, et bouton qui ouvre le détail des voies. Pur templating.

import { escapeHtml } from './utils.js';
import { cotationVersValeur, approximerCotation } from './donnees.js';

// Histogramme « 1 case = 1 voie » : une colonne par cotation RÉELLEMENT
// présente sur cette falaise, pas sur les ~39 crans possibles — une falaise
// typique n'en couvre que 2-3, et une échelle globale les compressait dans
// une tranche illisible. Contrepartie assumée : les colonnes ne sont plus
// comparables d'une fiche à l'autre.
// L'approximation de cotation ne sert QU'À positionner une case ici ;
// cotationVersValeur (donnees.js) reste strict, une estimation n'ayant pas sa
// place dans un filtre.
// nAutresDetaillees : voies trad + artificielles détaillées dans le fichier de
// routes (0 tant que l'export ne les fournit pas). Sans voie sportive, elles
// suffisent à justifier le bouton « Voir le détail des voies » : un secteur
// 100 % trad ou 100 % artif n'aurait sinon aucun accès à son détail.
const BOUTON_DETAIL_VOIES = '<button type="button" class="btn-voir-detail-voies">Voir le détail des voies</button>';

// Pas d'histogramme (rien de sportif à y montrer), seulement le bouton s'il y
// a un détail à ouvrir.
const boutonDetailSeul = (nAutresDetaillees) => (nAutresDetaillees > 0
  ? `<div class="fiche-voies-resume">${BOUTON_DETAIL_VOIES}</div>`
  : '');

export function construireHistogramme(voiesSportives, aAutresDisciplines, nAutresDetaillees = 0) {
  if (!voiesSportives || !voiesSportives.length) return boutonDetailSeul(nAutresDetaillees);

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
  // Aucune voie sportive positionnable : le bouton seul, voir plus haut.
  if (!parCotation.size && !nonCotees.length) return boutonDetailSeul(nAutresDetaillees);

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

  // Un seul aria-label résumé sur l'histogramme entier, pas un par case :
  // annoncer plusieurs dizaines de cases n'aiderait personne, le détail vient
  // du bouton ci-dessous.
  // Titre par EXCLUSION quand la falaise a aussi du trad/artificiel :
  // l'histogramme ne les couvre pas (comptés mais non détaillés), et un titre
  // par inclusion laisserait croire l'inverse face au total « Voies » plus
  // haut. Sur une falaise 100 % sportive la mention n'exclurait plus rien.
  // Dit ce qui EST montré plutôt que d'énumérer ce qui ne l'est pas : la
  // liste des autres styles s'allonge (moulinette est arrivée avec Pen-Hir),
  // pas le titre.
  const titre = aAutresDisciplines ? 'Cotation (voies sportives seules)' : 'Cotation';
  // Répartition couenne/grande voie ÉNONCÉE DANS L'aria-label : dans le
  // graphique, cette distinction ne repose que sur la couleur des cases
  // (WCAG 1.4.1). L'encodage par la couleur est le bon choix sémiologique
  // pour une différence de nature — y ajouter une 2e variable visuelle
  // (forme) entrerait en concurrence avec la lecture "1 case = 1 voie", qui
  // est justement quantitative. La redondance passe donc par le TEXTE, où
  // elle ne coûte rien à la lisibilité du graphique.
  const nbCouenne = voiesSportives.filter(v => v.type_voie === 'couenne').length;
  const nbGv = voiesSportives.length - nbCouenne;
  const repartition = [
    nbCouenne ? `${nbCouenne} couenne${nbCouenne > 1 ? 's' : ''}` : '',
    nbGv ? `${nbGv} grande${nbGv > 1 ? 's' : ''} voie${nbGv > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' et ');
  const resumeAria = `Répartition des ${voiesSportives.length} voies sportives par cotation`
    + (nonCotees.length ? `, dont ${nonCotees.length} non côtées` : '')
    + (repartition ? ` — ${repartition}` : '');
  // .fiche-voies-resume : conteneur masqué en bloc quand le détail (plus bas)
  // est ouvert (voir assets/css/, .mode-detail-voies) — un seul swap de
  // classe sur .popup bascule l'un pour l'autre, pas de logique JS dédiée.
  const histo = `
    <div class="fiche-voies-resume">
      <span class="legende-titre">${titre}</span>
      <div class="voies-histo" role="img" aria-label="${escapeHtml(resumeAria)}">
        ${colonnesHtml}
      </div>
      <div class="histo-legende">${legende.join('')}</div>
      ${BOUTON_DETAIL_VOIES}
    </div>`;

  return histo;
}
