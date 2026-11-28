// etat.js — état partagé de la page carte et constantes de zoom.
// Une page porte une seule carte : l'état vit dans cet objet, importé par les
// modules de la carte plutôt que passé de l'un à l'autre.

// Valeur de ?pratique= dans l'URL pour chaque pratique (lien partageable, ex.
// ?pratique=trad) : les libellés courts de la légende.
export const JETON_URL_STYLE = { sportive: 'sportive', trad: 'trad', artificielle: 'artif' };

// Sous ce zoom, les falaises sont réduites à un petit point uniforme. À valider
// par un essai sur le terrain.
export const ZOOM_SIMPLIFICATION = 13;

// Plafond de la vue d'ensemble (cadrage initial et « Tout voir »). Le seuil
// ci-dessus est une inégalité stricte : s'arrêter pile à 13 afficherait encore
// les cercles pleine taille. Pas ZOOM_SIMPLIFICATION - 1 : ce plafond doit
// seulement franchir le seuil (le plancher de dézoom de limiterZoneCarte garde
// ce -1), sinon un lieu compact s'éloigne trop et laisse un vide autour.
export const ZOOM_VUE_ENSEMBLE_MAX = ZOOM_SIMPLIFICATION - 0.1;

// Au-delà de ce zoom, les parkings sont visibles sans recherche ni falaise
// sélectionnée. Calé sur ZOOM_LABELS_SECTEUR (labels.js) : la vue détaillée,
// où les marqueurs sont assez espacés pour ne pas se chevaucher.
export const ZOOM_PARKINGS = 15;

export const etat = {
  map: null, // créée une fois data.geojson chargé (voir creerCarte, carte.js)
  dataUrl: '',
  baseRoutes: '', // dossier routes/ du lieu, à côté de data.geojson
  couleurEloigne: '', // token CSS --clay, lu une fois au démarrage

  // { marker, cat, nom, secteur, cle, recherche, parkingAssocie, nbVoies,
  //   nbGrandeVoie, nbCouenne, tempsGite }
  entries: [],
  index: new Map(), // cle -> entrée, pour naviguer vers un marqueur lié
  entriesParSecteur: new Map(), // secteur -> falaises, pour l'anti-collision
  entriesParSite: new Map(), // site -> falaises, pour l'anti-collision
  labelsSecteurs: [], // [{ el, marker, nom, cle }]
  labelsSites: [], // [{ el, marker, site }]
  secteursVisibles: null, // vrai quand les noms de secteur sont affichés
  sitesVisibles: null, // miroir : les noms de site ne s'affichent que sans ceux de secteur
  falaisesVisibles: new Set(), // clés des falaises affichées (couche native)
  parkingsAutorises: new Set(), // noms des parkings des falaises visibles
  etatEstompeParCle: new Map(), // dernier feature-state « estompe » posé, pour ne pas le reposer à l'identique

  borneGlobale: null, // étendue de tous les points, pour « Tout voir »
  maxima: { total: 0, couenne: 0, gv: 0 }, // taille des cercles proportionnels

  modeFigureActuel: 'aucun', // « Type de voie » : aucun, couenne ou gv
  // Bouton « Épurer » : indépendant de modeFigureActuel. Un filtre Type de voie
  // ou Cotation reste actif en vue épurée.
  epureeActuelle: false,
  modeSimplifieActuel: null, // vrai sous ZOOM_SIMPLIFICATION

  falaiseSelectionneeCle: null, // falaise dont la fiche est ouverte, ou origine/cible d'une navigation

  // Fiche ouverte (popup flottante ou panneau desktop). addMarker s'en sert
  // pour ignorer une fermeture périmée : une autre fiche a déjà pris le relais.
  popupOuverte: null,
  // État replié/déplié de la fiche mobile, partagé entre toutes les fiches : le
  // choix suit l'utilisateur d'une falaise à l'autre, comme la fiche du bas de
  // Google ou Apple Maps.
  ficheReduite: false,

  // Posés par configurerFiltreEnsoleillement : un filtre actif masque aussi les
  // falaises sans orientation connue (16 sur 60 à Crozon), à signaler.
  falaisesSansOrientationConnue: false,
  noteEnsoleillementAucune: null,

  filtres: {
    recherche: '',
    // Infinity = pas de filtre. tempsGitePlafond est la référence « aucun
    // filtre actif » (voir configurerFiltreTemps).
    tempsMaxGite: Infinity,
    tempsGitePlafond: Infinity,
    // Catégories cochées (matin, apres-midi, journee, nord), vide = pas de
    // filtre. Plusieurs cases se combinent en OU, chacune par correspondance
    // exacte : cocher Matin + Après-midi ne suppose pas Journée.
    ensoleillement: [],
    // 'tous' ou une pratique (sportive, trad, artificielle), choix unique. Donne
    // aussi sa taille aux cercles (voir valeurSelection).
    pratique: 'tous',
    // Fourchette de cotation, filtre à part entière qui se combine avec Pratique
    // et Type de voie. Plancher et plafond : amplitude réelle de la sortie
    // (posée par preparerFourchette). Inactive quand les bornes sont aux
    // extrêmes.
    cotationMin: -Infinity,
    cotationMax: Infinity,
    cotationPlancher: -Infinity,
    cotationPlafond: Infinity,
  },
};

// La fourchette exclut-elle des falaises ? Faux quand preparerFourchette a
// retiré la section (sortie sans cotation exploitable : bornes à ±Infinity).
export function filtreCotationActif() {
  return etat.filtres.cotationMin > etat.filtres.cotationPlancher
    || etat.filtres.cotationMax < etat.filtres.cotationPlafond;
}
