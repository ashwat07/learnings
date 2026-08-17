// A BARREL FILE. Re-exports everything so callers can write:
//
//     import { formatPrice } from '../lib/index.js';
//
// It is convenient, it is everywhere, and it is the single most common reason a bundle contains
// modules nobody uses. Whether that is harmless depends entirely on whether every re-exported
// module is side-effect free — see lab 03.

export * from './format.js';
export * from './dates.js';
export * from './validate.js';
export * from './analytics.js';
