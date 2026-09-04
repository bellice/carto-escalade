// demarrer-sortie.js — point d'entrée d'une page sortie.
//
// Remplace les deux <script> inline de la page (démarrage de la carte +
// enregistrement du service worker) : sans code inline, la CSP peut interdire
// 'unsafe-inline' pour les scripts (voir la meta dans index.html).
//
// Le chemin des données est lu sur #map (data-donnees) plutôt que codé en dur
// ici : ce module est partagé par toutes les sorties, chacune ayant son
// propre data.geojson. Le chemin reste relatif à la PAGE, comme avant.

import { initCarte } from './carte.js';
import { enregistrerServiceWorker } from './sw-client.js';

// La feuille de MapLibre est déclarée en <link rel="preload"> dans la page :
// son téléchargement a donc déjà commencé, sans bloquer le premier rendu (voir
// le commentaire de la balise). On la promeut ici en feuille de style, juste
// avant initCarte — donc avant que MapLibre ne crée le moindre élément à
// styler. Le fichier étant déjà dans le cache HTTP, l'application est
// immédiate : pas de fenêtre où des contrôles s'afficheraient sans style.
const feuille = document.createElement('link');
feuille.rel = 'stylesheet';
feuille.href = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.css';
document.head.appendChild(feuille);

const conteneur = document.getElementById('map');
initCarte((conteneur && conteneur.dataset.donnees) || 'data.geojson');

// Scope racine : le SW couvre aussi l'accueil et les autres lieux.
// '../' et non '../../' : les dossiers de lieu sont à UN niveau depuis
// l'abandon de sorties/<date>/. L'ancien chemin se repliait sur la racine
// (une URL ne remonte pas au-dessus), donc il marchait — par accident.
enregistrerServiceWorker('../sw.js', { scope: '../' });
