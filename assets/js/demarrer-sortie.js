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

const conteneur = document.getElementById('map');
initCarte((conteneur && conteneur.dataset.donnees) || 'data.geojson');

// Scope racine : le SW couvre aussi l'accueil et les autres sorties.
enregistrerServiceWorker('../../sw.js', { scope: '../../' });
