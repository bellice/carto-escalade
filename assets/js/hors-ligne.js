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
async function telechargerLot(urls, { onProgres, signal }) {
  let faits = 0;
  let echecs = 0;
  const file = urls.slice();
  const ouvrier = async () => {
    while (file.length) {
      if (signal.annule) return;
      const url = file.pop();
      try {
        const r = await fetch(url, { signal: signal.controleur.signal });
        if (!r.ok) echecs++;
      } catch {
        echecs++;
      }
      faits++;
      onProgres(faits, echecs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLELE, urls.length) }, ouvrier));
  return { faits, echecs };
}

export function lireEtatPreparation() {
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

  // aria-label toujours explicite : le libellé visible est volontairement
  // court pour tenir dans l'en-tête, mais un lecteur d'écran doit entendre
  // l'action complète, pas « Hors-ligne ».
  const poser = (texte, description) => {
    bouton.textContent = texte;
    bouton.setAttribute('aria-label', description);
  };

  const majLibelle = () => {
    const etat = lireEtatPreparation();
    if (!etat) {
      poser('Hors-ligne', 'Préparer la carte pour une utilisation hors ligne');
      bouton.classList.remove('pret');
      return;
    }
    const quand = new Date(etat.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    poser(`Hors-ligne ${quand}`,
      `Carte préparée pour le hors-ligne le ${new Date(etat.date).toLocaleDateString('fr-FR')} `
      + `(${etat.nbTuiles} tuiles). Activer pour remettre à jour.`);
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

    try {
      const gabarit = await gabaritTuiles(map);
      const tuiles = tuilesPourPoints(points);
      const urls = [
        ...urlsGlyphes(map),
        ...Array.from(tuiles, (t) => {
          const [z, x, y] = t.split('/');
          return gabarit.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        }),
      ];

      // Prévenir AVANT de lancer si l'espace disponible est manifestement
      // insuffisant : mieux vaut le dire que remplir le quota et voir le
      // navigateur évincer, au pire, la coquille elle-même.
      if (navigator.storage && navigator.storage.estimate) {
        const { quota = 0, usage = 0 } = await navigator.storage.estimate();
        const besoin = urls.length * 45 * 1024; // ~45 Ko/tuile, mesuré sur la zone
        if (quota && quota - usage < besoin) {
          poser('Espace insuffisant', 'Espace de stockage insuffisant pour préparer la zone');
          enCours = false;
          setTimeout(majLibelle, 4000);
          return;
        }
      }

      const total = urls.length;
      const { faits, echecs } = await telechargerLot(urls, {
        signal,
        onProgres: (n) => {
          const pct = Math.round((100 * n) / total);
          poser(`${pct} %`, `Préparation hors ligne : ${n} sur ${total} fichiers`);
        },
      });

      if (!signal.annule) {
        ecrireEtatPreparation({
          date: new Date().toISOString(),
          modele: modeleDeGabarit(gabarit),
          nbTuiles: tuiles.size,
        });
        if (echecs) console.warn(`Préparation hors ligne : ${echecs} tuile(s) manquante(s) sur ${total}`);
      }
      void faits;
    } catch (err) {
      console.error('Préparation hors-ligne', err);
      poser('Échec', 'La préparation hors ligne a échoué (réseau ?)');
      enCours = false;
      setTimeout(majLibelle, 4000);
      return;
    }
    enCours = false;
    majLibelle();
  }

  bouton.addEventListener('click', preparer);
  majLibelle();

  // Le fond a-t-il été reconstruit depuis la préparation ? Si oui, les tuiles
  // en cache pointent vers un chemin qui n'est plus servi : la préparation est
  // caduque même si le cache paraît plein. On le signale plutôt que de laisser
  // découvrir le problème sur le terrain.
  const etat = lireEtatPreparation();
  if (etat && etat.modele) {
    gabaritTuiles(map)
      .then((gabarit) => {
        if (modeleDeGabarit(gabarit) !== etat.modele && !enCours) {
          poser('À repréparer', 'Le fond de carte a été mis à jour : préparation à refaire');
          bouton.classList.remove('pret');
        }
      })
      .catch(() => { /* hors ligne : on garde l'état connu, sans alarmer */ });
  }
}
