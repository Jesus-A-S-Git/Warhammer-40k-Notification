// Serves _site/ under /<repo>/ exactly like GitHub Pages project sites.
// Usage: node scripts/preview-static.js [port]
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '_site');
const base = '/Warhammer-40k-Notification';
const port = Number(process.argv[2]) || 4000;
const app = express();
app.use(base, express.static(root));
app.get('/', (_req, res) => res.redirect(`${base}/`));
app.listen(port, () => console.log(`Static preview on http://localhost:${port}${base}/`));
