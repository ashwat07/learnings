import { run } from './program.mjs';

export const title = 'Predict the order';
export const task = `Open program.mjs and read it. Then write down — WITHOUT RUNNING IT — the order
in which the eight labels A..H are logged, and export that array from solution.mjs.

There is nothing to implement. This drill is checking one thing: whether you actually know where
your callback runs, or whether you have been guessing and getting away with it.`;
export const passIf = 'your predicted order matches what Node actually does, exactly';

const LABELS = ['A sync', 'B nextTick', 'C promise', 'D promise queued by the nextTick',
  'E immediate', 'F nextTick inside immediate', 'G promise inside immediate', 'H timeout 0'];

export async function check(s) {
  const predicted = s.ORDER;
  if (!Array.isArray(predicted)) {
    return [{ check: 'exports ORDER as an array of 8 strings', actual: typeof predicted, pass: false }];
  }

  const actual = await run();
  const known = new Set(LABELS);
  const unknown = predicted.filter((p) => !known.has(p));

  // Report the FIRST divergence rather than a bare true/false — the position you got wrong tells
  // you which queue you misunderstand, and that is the only useful output here.
  let firstWrong = -1;
  for (let i = 0; i < Math.max(actual.length, predicted.length); i++) {
    if (predicted[i] !== actual[i]) { firstWrong = i; break; }
  }
  const shortActual = actual.map((s) => s[0]).join(' ');
  const shortPred = predicted.map((s) => (known.has(s) ? s[0] : '?')).join(' ');

  const exact = firstWrong === -1;
  return [
    { check: '8 labels, no typos', actual: unknown.length ? `unknown: ${unknown[0]}` : `${predicted.length} labels`, pass: predicted.length === 8 && unknown.length === 0 },
    { check: 'your prediction', actual: shortPred, pass: predicted.length === 8 && unknown.length === 0 },
    { check: 'what Node did', actual: shortActual, pass: true },
    { check: 'they match', actual: exact ? 'exactly' : `first wrong at position ${firstWrong + 1}: you said "${predicted[firstWrong] ?? '(nothing)'}", it was "${actual[firstWrong] ?? '(nothing)'}"`, pass: exact },
  ];
}
