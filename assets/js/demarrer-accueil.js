// demarrer-accueil.js — point d'entrée de la page d'accueil.
// Voir demarrer-sortie.js : même raison d'être (supprimer le script inline
// pour permettre une CSP sans 'unsafe-inline').

import { enregistrerServiceWorker } from './sw-client.js';

enregistrerServiceWorker('sw.js');
