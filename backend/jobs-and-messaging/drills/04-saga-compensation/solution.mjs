/**
 * export async function placeOrder(steps) -> void   (throw if the saga could not complete)
 *
 * `steps` is an ordered array of { name, run(), compensate() }.
 *
 * Run them in order. If one throws, UNDO the ones that already succeeded — and think about the
 * order you undo them in, and about whether the step that just failed needs undoing.
 *
 * The version below has no compensation at all: the card stays charged.
 */
export async function placeOrder(steps) {
  for (const step of steps) {
    await step.run();
  }
}

