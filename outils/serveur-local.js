// Petit serveur pour tester le site en local (node outils/serveur-local.js), sans dépendance.
// Le site publié sur GitHub Pages n'en a pas besoin.
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xls': 'application/vnd.ms-excel', '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let fichier = path.join(RACINE, path.normalize(chemin));
  if (!fichier.startsWith(RACINE)) { res.writeHead(403); return res.end(); }
  if (chemin.endsWith('/')) fichier = path.join(fichier, 'index.html');
  fs.readFile(fichier, (err, contenu) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream' });
    res.end(contenu);
  });
}).listen(PORT, () => console.log(`Site local : http://localhost:${PORT}`));
