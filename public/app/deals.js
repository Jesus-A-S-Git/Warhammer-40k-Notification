// Deals page: every product with filters/sorts synced to the URL.
import { toast } from '../ui.js';
import { overview } from './api.js';
import { mountBrowse, browseSkeleton } from './browse.js';
import { skeletonCards, dataBanners, emptyState } from './kit.js';

const root = document.getElementById('browse');
browseSkeleton(root, skeletonCards(12));
try {
  const ov = await overview();
  document.getElementById('banners').replaceChildren(...dataBanners(ov));
  mountBrowse({ root, ov, products: ov.products });
} catch (err) {
  toast(`Could not load prices: ${err.message}`, 'bad');
  root.replaceChildren(emptyState('Prices are unavailable right now', err.message));
}
