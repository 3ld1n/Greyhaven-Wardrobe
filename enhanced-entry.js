/* Greyhaven Wardrobe 1.4.1: extend catalog before original core initializes. */
import './wardrobe-catalog-expansion.js';
await import('./index.js');
await import('./wardrobe-features.js');
