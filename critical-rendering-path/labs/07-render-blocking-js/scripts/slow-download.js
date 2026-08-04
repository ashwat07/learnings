// The other kind of slow: this file is padded to be large (slow to DOWNLOAD) but its
// executed work is trivial. Compare it against heavy.js under network throttling to see
// which problem the preload scanner can solve and which it cannot.
//
// Padding follows. Yes, this is silly; the point is bytes on the wire.
window.LabLog?.note('slow-download.js executed (large file, trivial work)');
window.HEAVY_RESULT = 1;

/* eslint-disable */
// ---8<--- padding ---8<---
// prettier-ignore
const __pad = `
${'x'.repeat(2000)}
`;
// Repeat the padding block by generating it at build time if you want a genuinely large
// file. For now, throttle the network in DevTools instead — same effect, no wasted disk:
//   Network → Throttling → Slow 3G, and note this file's download time in the waterfall.
// If you want the real thing, run:
//   node -e "require('fs').appendFileSync('scripts/slow-download.js', '//' + 'x'.repeat(2e6))"
// and then measure again. Remember to git-ignore or revert it.
void __pad;
