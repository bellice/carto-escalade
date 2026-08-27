// serveur.js — serveur statique minimal pour les tests.
//
// Écrit à la main plutôt que d'ajouter une dépendance : le site est servi tel
// quel par GitHub Pages, un `python -m http.server` ou ce fichier suffisent à
// le reproduire. Les tests ne doivent pas dépendre de python étant installé.
//
// Port 0 : le système en attribue un libre. Deux exécutions simultanées (ou
// un serveur oublié d'une session précédente) ne peuvent donc pas se marcher
// dessus — piège rencontré en vrai, avec quatre serveurs sur le même port et
// des résultats de test incohérents.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

// Le type MIME des modules ES doit être un type JavaScript, sinon le
// navigateur refuse de les exécuter (« strict MIME type checking »).
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function demarrerServeur() {
  const serveur = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let chemin = decodeURIComponent(url.pathname);
      if (chemin.endsWith('/')) chemin += 'index.html';

      // normalize + garde-fou : empêche un ../ de sortir du dépôt.
      const absolu = join(RACINE, normalize(chemin));
      if (!absolu.startsWith(RACINE)) {
        res.writeHead(403).end('Interdit');
        return;
      }

      const contenu = await readFile(absolu);
      res.writeHead(200, {
        'content-type': TYPES[extname(absolu).toLowerCase()] || 'application/octet-stream',
        // Sans cela, le cache HTTP du navigateur peut masquer une
        // modification entre deux assertions du même test.
        'cache-control': 'no-store',
      });
      res.end(contenu);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Introuvable');
    }
  });

  return new Promise((resoudre) => {
    serveur.listen(0, '127.0.0.1', () => {
      const { port } = serveur.address();
      resoudre({
        base: `http://127.0.0.1:${port}`,
        arreter: () => new Promise((fini) => serveur.close(fini)),
      });
    });
  });
}
