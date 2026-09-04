// hors-ligne.js — « Préparer la sortie » : télécharge à l'avance le fond de
// carte autour des points de la sortie, pour que la carte reste lisible en
// falaise sans réseau.
//
// POURQUOI CE MODULE EXISTE
// Le service worker met les tuiles en cache APRÈS les avoir affichées : il
// protège les zones déjà visitées, mais pas celles qu'on découvrira sur
// place. Arriver au pied de la falaise sans réseau donnait donc un fond gris.
// Ici on inverse : l'utilisateur déclenche le téléchargement pendant qu'il a
// du réseau (wifi, à la maison), et le SW se charge du reste.
//
// POURQUOI DES DISQUES AUTOUR DES POINTS, ET PAS LE RECTANGLE ENGLOBANT
// Mesuré sur la sortie Drôme (bbox ~60x31 km) : le rectangle complet
// représente ~13 000 tuiles / ~650 Mo — inutilisable. Les falaises sont des
// POINTS dispersés, pas une surface : ne garder qu'un disque de quelques
// tuiles autour de chacun (dédupliqué entre points proches) tombe à ~460
// tuiles / ~21 Mo, soit une dizaine de secondes en wifi. C'est ce qui rend
// la fonctionnalité viable.
//
// POURQUOI S'ARRÊTER À z14
// La source OpenFreeMap déclare maxzoom 14 : au-delà, aucune tuile n'existe,
// MapLibre réutilise celle de z14 en la sur-zoomant. Pré-charger z15/z16
// téléchargerait donc des 404 — z9..z14 couvre TOUS les niveaux de zoom
// atteignables, y compris le plus fort.

const ZOOM_MIN = 9;
const ZOOM_MAX = 14;   // = maxzoom de la source ; au-delà MapLibre sur-zoome
const MARGE_TUILES = 1; // anneau autour de chaque point (1 => carré 3x3)
const PARALLELE = 6;    // requêtes simultanées : assez pour saturer une ligne, assez peu pour ne pas se faire limiter
const CLE_STOCKAGE = 'preparation-hors-ligne';
// Part minimale de tuiles réellement obtenues en dessous de laquelle on refuse
// d'appeler ça une préparation. Le module tolère volontairement le partiel
// (voir telechargerLot : sur un réseau instable, mieux vaut 95 % de la zone
// que rien) — mais sans plancher, un lot ENTIÈREMENT en échec était enregistré
// comme une réussite : hors ligne, un clic écrivait « prête, 463 tuiles » en
// une seconde alors que 465 fichiers sur 469 avaient échoué. Une confiance
// fausse est pire que pas de fonctionnalité du tout : elle ne se découvre
// qu'au pied de la falaise, sans réseau pour rattraper.
const SEUIL_REUSSITE = 0.5;

// --- Conversions géographiques (schéma XYZ standard) ---
function tuileDe(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y, n };
}

// Ensemble dédupliqué de tuiles couvrant un disque autour de chaque point.
// Set de chaînes "z/x/y" : deux falaises voisines partagent leurs tuiles, on
// ne les compte (et ne les télécharge) qu'une fois.
// EXPORTÉ sans être importé par un autre module du site, et c'est voulu :
// fonction pure, appelée depuis un script d'analyse pour chiffrer
// l'empreinte hors-ligne d'un lieu AVANT de le publier (99 tuiles pour
// Pen-Hir, 463 pour la Drôme). Sans l'export il faudrait dupliquer le
// calcul, et les deux chiffres finiraient par diverger.
export function tuilesPourPoints(points, zMin = ZOOM_MIN, zMax = ZOOM_MAX, marge = MARGE_TUILES) {
  const tuiles = new Set();
  for (let z = zMin; z <= zMax; z++) {
    for (const [lon, lat] of points) {
      const { x, y, n } = tuileDe(lon, lat, z);
      for (let dx = -marge; dx <= marge; dx++) {
        for (let dy = -marge; dy <= marge; dy++) {
          const tx = x + dx;
          const ty = y + dy;
          // Hors monde : ignoré plutôt que replié, sinon on téléchargerait
          // des tuiles de l'autre bout du planisphère pour rien.
          if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
          tuiles.add(`${z}/${tx}/${ty}`);
        }
      }
    }
  }
  return tuiles;
}

// Gabarit d'URL des tuiles vectorielles, tel que MapLibre l'utilise vraiment.
// On préfère la source déjà résolue par la carte (elle a suivi la TileJSON)
// et on retombe sur un fetch de la TileJSON si elle n'expose pas ses tuiles.
async function gabaritTuiles(map) {
  const source = map.getSource('openmaptiles');
  if (source && Array.isArray(source.tiles) && source.tiles.length) return source.tiles[0];
  const style = map.getStyle();
  const decl = style && style.sources && style.sources.openmaptiles;
  if (decl && Array.isArray(decl.tiles) && decl.tiles.length) return decl.tiles[0];
  if (decl && decl.url) {
    const tj = await fetch(decl.url).then((r) => r.json());
    if (Array.isArray(tj.tiles) && tj.tiles.length) return tj.tiles[0];
  }
  throw new Error('Gabarit de tuiles introuvable dans le style');
}

// Le chemin des tuiles OpenFreeMap contient l'horodatage du build planète
// (ex. /planet/20260823_080002_pt/{z}/{x}/{y}.pbf). À chaque nouveau build,
// ce segment change et TOUTES les tuiles déjà en cache deviennent
// inatteignables d'un coup — une préparation faite trop tôt expire donc en
// silence. On mémorise ce segment pour pouvoir prévenir l'utilisateur.
function modeleDeGabarit(gabarit) {
  const m = /\/planet\/([^/]+)\//.exec(gabarit);
  return m ? m[1] : gabarit;
}

// Les libellés de la carte ont besoin des glyphes ; sans eux, un fond
// hors-ligne s'affiche sans aucun nom de lieu. On ne prend que les plages
// 0-255 et 256-511 (latin + latin étendu) : elles couvrent le français, et
// pré-charger toutes les plages Unicode serait disproportionné.
function urlsGlyphes(map) {
  const style = map.getStyle();
  if (!style || !style.glyphs) return [];
  const piles = new Set();
  for (const couche of style.layers || []) {
    const police = couche.layout && couche.layout['text-font'];
    if (Array.isArray(police) && police.length) piles.add(police.join(','));
  }
  const urls = [];
  for (const pile of piles) {
    for (const plage of ['0-255', '256-511']) {
      urls.push(style.glyphs.replace('{fontstack}', encodeURIComponent(pile)).replace('{range}', plage));
    }
  }
  return urls;
}

// Télécharge une liste d'URL avec un parallélisme borné. Les réponses ne sont
// pas lues : le seul but est que le service worker les intercepte et les
// range dans son cache (voir sw.js, CACHE_TUILES). Un échec isolé n'arrête
// pas le lot — sur un réseau instable, mieux vaut 95 % de la zone que rien.
//
// Renvoie l'ENSEMBLE des URL en échec, pas seulement leur nombre : l'appelant
// doit pouvoir distinguer une tuile manquante d'un glyphe manquant, les deux
// catégories étant mêlées dans le même lot alors que l'état enregistré, lui,
// compte des tuiles. Sans cette distinction on ne peut pas dire honnêtement
// ce qui a été obtenu.
async function telechargerLot(urls, { onProgres, signal }) {
  let faits = 0;
  const echoues = new Set();
  const file = urls.slice();
  const ouvrier = async () => {
    while (file.length) {
      if (signal.annule) return;
      const url = file.pop();
      try {
        const r = await fetch(url, { signal: signal.controleur.signal });
        if (!r.ok) echoues.add(url);
      } catch {
        echoues.add(url);
      }
      faits++;
      onProgres(faits, echoues.size);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLELE, urls.length) }, ouvrier));
  return { faits, echoues };
}

function lireEtatPreparation() {
  try {
    return JSON.parse(localStorage.getItem(CLE_STOCKAGE) || 'null');
  } catch {
    return null;
  }
}

function ecrireEtatPreparation(etat) {
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat));
  } catch {
    /* mode privé / quota : la préparation reste valable, on perd juste la trace */
  }
}

// --- Durabilité du stockage ---
//
// Télécharger 21 Mo ne sert à rien si le navigateur les jette avant la
// sortie. Par défaut le stockage d'un site est « best-effort » : évincable
// dès que la place manque. Et WebKit va plus loin — il supprime le stockage
// scriptable d'un site après 7 jours sans visite en tant que site principal.
// C'est exactement le scénario visé ici : on prépare chez soi, on roule, on
// arrive à la falaise deux semaines plus tard, sans réseau pour rattraper.
//
// persist() bascule le site en stockage « persistant », que le navigateur
// s'engage à ne pas évincer tout seul. On ne le demande PAS au chargement
// mais au clic sur « Préparer » : les navigateurs accordent la permission
// sur des heuristiques d'engagement, et une action explicite de
// l'utilisateur est le meilleur moment pour la réclamer.
//
// Renvoie true (accordé), false (refusé) ou null (API absente / erreur) —
// trois cas distincts, parce qu'on ne dira pas la même chose dans les trois.
async function assurerPersistance({ demander }) {
  const s = navigator.storage;
  if (!s || !s.persisted) return null;
  try {
    if (await s.persisted()) return true;
    if (!demander || !s.persist) return false;
    return await s.persist();
  } catch {
    return null;
  }
}

// Monte l'interface (un seul bouton) dans `conteneur`.
//
// Un bouton SEUL, dont le libellé porte l'état, plutôt qu'un bouton plus une
// ligne de statut : le bloc vit désormais dans l'en-tête de page (où il ne
// recouvre rien), et une seconde ligne n'y tiendrait pas sur un téléphone.
// L'état complet est de toute façon binaire à l'usage — préparé ou non — et
// la date suffit à le qualifier.
export function monterPreparationHorsLigne({ map, points, conteneur }) {
  if (!conteneur || !points.length) return;

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'btn-preparer';
  conteneur.appendChild(bouton);

  const signal = { annule: false, controleur: new AbortController() };
  let enCours = false;
  // true / false / null (inconnu) — voir assurerPersistance. Tenu à jour ici
  // plutôt que relu à chaque fois : majLibelle est synchrone et appelé depuis
  // une demi-douzaine d'endroits.
  let stockagePersistant = null;
  // Le fond de carte a été reconstruit depuis la préparation : les tuiles en
  // cache pointent vers un chemin qui n'est plus servi.
  let caduque = false;

  // Le libellé visible est court par contrainte de place ; la description
  // complète part dans aria-label (lecteurs d'écran) ET title (infobulle au
  // pointeur), les deux tenus par la même fonction pour qu'ils ne divergent
  // jamais.
  //
  // Budget mesuré dans l'en-tête à 390px : 107px pour ce bouton (viewport
  // moins paddings, gaps, lien de retour et titre de la sortie). D'où la
  // règle qui gouverne tous les libellés ci-dessous : aucun état de REPOS ne
  // dépasse 98px, et le passage « action faite » RÉTRÉCIT le bouton
  // (Préparer 83px -> Prête 60px) au lieu de l'élargir. Un libellé qui
  // grossit couperait le titre de la sortie et déformerait l'en-tête —
  // c'est exactement ce que faisait « Hors-ligne 28/08 » (144px).
  // Seuls les deux états d'ERREUR s'autorisent à dépasser : ils sont
  // transitoires (4s) et doivent attirer l'œil.
  //
  // « Préparer » et non « Hors-ligne » : un substantif seul dans un en-tête
  // se lit comme un STATUT (« le site est hors ligne »), pas comme une
  // action. L'infinitif lève l'ambiguïté ; l'objet (la carte) est donné par
  // le contexte et par la description.
  // La disponibilité se recalcule ICI, à chaque changement de libellé, plutôt
  // que dans un chemin séparé qu'on oublierait de rappeler : hors ligne,
  // préparer est impossible — chaque tuile échouerait — donc le bouton se
  // désactive au lieu d'accepter un clic sans effet possible.
  // EXCEPTION : pendant une préparation en cours, ce même bouton sert à
  // ANNULER. Le désactiver parce que le réseau vient de tomber piégerait
  // l'utilisateur dans un téléchargement qu'il ne pourrait plus interrompre.
  const poser = (texte, description) => {
    bouton.disabled = !navigator.onLine && !enCours;
    bouton.textContent = texte;
    bouton.setAttribute('aria-label', description);
    bouton.title = description;
  };

  // Ajoutée aux seuls états de REPOS : un message d'erreur qui dit déjà
  // « impossible sans réseau » n'a pas besoin qu'on le lui répète.
  const noteReseau = () => (navigator.onLine
    ? ''
    : ' Indisponible tant que le réseau manque.');

  const majLibelle = () => {
    const etat = lireEtatPreparation();
    if (!etat) {
      poser('Préparer', 'Préparer la carte pour une utilisation hors ligne.' + noteReseau());
      bouton.classList.remove('pret');
      return;
    }
    if (caduque) {
      poser('Repréparer', 'Le fond de carte a été mis à jour : préparation à refaire.' + noteReseau());
      bouton.classList.remove('pret');
      return;
    }
    // La date reste dans la description, pas dans le libellé : elle sert à
    // juger si la préparation est encore bonne, or le code répond déjà à
    // cette question tout seul (voir le contrôle de gabarit en bas de
    // fichier, qui bascule sur « Repréparer »). L'afficher en permanence
    // coûterait la largeur du titre pour une information lue une fois.
    // « Prête » sans réserve serait un demi-mensonge quand le navigateur n'a
    // pas accordé le stockage persistant : il peut libérer la place à tout
    // moment. On le dit, avec la parade — rouvrir le site remet à zéro le
    // compteur d'inactivité de WebKit.
    const reserve = stockagePersistant === false
      ? ' Le navigateur peut libérer cet espace : rouvrez le site peu avant de partir.'
      : '';
    // Une préparation partielle est légitime (voir SEUIL_REUSSITE) mais ne
    // doit pas se faire passer pour complète : le compte réel est dit.
    // nbTuilesVisees peut manquer sur un état écrit par une version
    // antérieure — dans ce cas on ne prétend rien.
    const partielle = etat.nbTuilesVisees && etat.nbTuiles < etat.nbTuilesVisees
      ? ` Préparation partielle : ${etat.nbTuiles} tuiles sur ${etat.nbTuilesVisees}.`
      : '';
    poser('Prête',
      `Carte prête pour le hors-ligne — préparée le `
      + `${new Date(etat.date).toLocaleDateString('fr-FR')} `
      + `(${etat.nbTuiles} tuiles). Activer pour remettre à jour.${partielle}${reserve}`
      + noteReseau());
    bouton.classList.add('pret');
  };

  async function preparer() {
    if (enCours) {
      // 2e activation = annulation. Ce qui est déjà téléchargé reste en
      // cache : une préparation interrompue n'est pas perdue, juste partielle.
      signal.annule = true;
      signal.controleur.abort();
      return;
    }

    enCours = true;
    signal.annule = false;
    signal.controleur = new AbortController();
    poser('Annuler', 'Annuler la préparation hors ligne en cours');

    // Avant de télécharger, réclamer le droit de garder. Demandé ici et pas
    // ailleurs : c'est le seul instant où l'utilisateur vient d'exprimer
    // explicitement qu'il veut conserver cette carte.
    stockagePersistant = await assurerPersistance({ demander: true });

    try {
      const gabarit = await gabaritTuiles(map);
      const tuiles = tuilesPourPoints(points);
      // Les tuiles restent isolées des glyphes : c'est sur elles seules que se
      // juge la réussite, et c'est leur compte qui est enregistré.
      const urlsTuiles = Array.from(tuiles, (t) => {
        const [z, x, y] = t.split('/');
        return gabarit.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      });
      const urls = [...urlsGlyphes(map), ...urlsTuiles];

      // Prévenir AVANT de lancer si l'espace disponible est manifestement
      // insuffisant : mieux vaut le dire que remplir le quota et voir le
      // navigateur évincer, au pire, la coquille elle-même.
      if (navigator.storage && navigator.storage.estimate) {
        const { quota = 0, usage = 0 } = await navigator.storage.estimate();
        const besoin = urls.length * 45 * 1024; // ~45 Ko/tuile, mesuré sur la zone
        if (quota && quota - usage < besoin) {
          // enCours remis à false AVANT poser : c'est lui qui décide si le
          // bouton doit être désactivé (voir poser).
          enCours = false;
          poser('Espace plein', 'Espace de stockage insuffisant pour préparer la zone');
          setTimeout(majLibelle, 4000);
          return;
        }
      }

      const total = urls.length;
      const { echoues } = await telechargerLot(urls, {
        signal,
        onProgres: (n) => {
          const pct = Math.round((100 * n) / total);
          poser(`${pct} %`, `Préparation hors ligne : ${n} sur ${total} fichiers`);
        },
      });

      if (!signal.annule) {
        const visees = urlsTuiles.length;
        const obtenues = urlsTuiles.filter((u) => !echoues.has(u)).length;

        // Trop peu de tuiles pour que la zone soit lisible sur le terrain :
        // on n'écrit RIEN. Un état correct plus ancien survit donc à une
        // tentative ratée, au lieu d'être écrasé par une fausse réussite.
        if (visees && obtenues / visees < SEUIL_REUSSITE) {
          enCours = false;
          poser('Échec', navigator.onLine
            ? `Préparation incomplète : ${obtenues} tuiles sur ${visees}. Réseau instable — réessayer sur une meilleure connexion.`
            : 'Impossible de préparer sans réseau : aucune tuile n\'a pu être téléchargée.');
          setTimeout(majLibelle, 5000);
          return;
        }

        caduque = false; // on vient de préparer sur le gabarit courant
        ecrireEtatPreparation({
          date: new Date().toISOString(),
          modele: modeleDeGabarit(gabarit),
          nbTuiles: obtenues,  // ce qui est VRAIMENT en cache, pas ce qui était visé
          nbTuilesVisees: visees,
        });
        if (obtenues < visees) {
          console.warn(`Préparation hors ligne : ${visees - obtenues} tuile(s) manquante(s) sur ${visees}`);
        }
      }
    } catch (err) {
      console.error('Préparation hors-ligne', err);
      enCours = false;
      poser('Échec', 'La préparation hors ligne a échoué (réseau ?)');
      setTimeout(majLibelle, 4000);
      return;
    }
    enCours = false;
    majLibelle();
  }

  bouton.addEventListener('click', preparer);
  // Le passage en ligne / hors ligne ne change pas l'ÉTAT de la préparation,
  // mais change ce qu'on peut en faire : majLibelle repasse par poser, qui
  // recalcule la disponibilité du bouton.
  window.addEventListener('online', majLibelle);
  window.addEventListener('offline', majLibelle);
  majLibelle();

  // Relire l'état de persistance au retour sur le site. persisted() ne
  // DEMANDE rien (aucune permission déclenchée) : on peut l'appeler au
  // montage, contrairement à persist(), réservé au clic. Sans ça, la
  // description mentirait sur toutes les visites suivantes.
  assurerPersistance({ demander: false }).then((p) => {
    if (p === stockagePersistant) return;
    stockagePersistant = p;
    if (!enCours) majLibelle();
  });

  // Le fond a-t-il été reconstruit depuis la préparation ? Si oui, les tuiles
  // en cache pointent vers un chemin qui n'est plus servi : la préparation est
  // caduque même si le cache paraît plein. On le signale plutôt que de laisser
  // découvrir le problème sur le terrain.
  const etat = lireEtatPreparation();
  if (etat && etat.modele) {
    gabaritTuiles(map)
      .then((gabarit) => {
        // Passer par le drapeau + majLibelle plutôt que poser() directement :
        // deux promesses écrivent sur ce bouton (celle-ci et celle de la
        // persistance ci-dessus), et rien ne garantit leur ordre. L'état est
        // porté par une variable, l'affichage recalculé — pas de course.
        if (modeleDeGabarit(gabarit) !== etat.modele && !enCours) {
          caduque = true;
          majLibelle();
        }
      })
      .catch(() => { /* hors ligne : on garde l'état connu, sans alarmer */ });
  }
}
