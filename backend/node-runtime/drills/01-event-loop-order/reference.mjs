/** Drill 01 — reference. */

export const ORDER = [
  'A sync',
  'B nextTick',
  'C promise',
  'D promise queued by the nextTick',
  'E immediate',
  'F nextTick inside immediate',
  'G promise inside immediate',
  'H timeout 0',
];

/*
WHY, in the order the questions come up.

A first, obviously: everything else was only SCHEDULED. The synchronous body of a callback always
runs to completion before any queue is drained. This is the fact that makes "just await it" not
help a blocked loop — see drill 02.

B before C: process.nextTick is not part of the JavaScript microtask queue at all. It is Node's
own queue, and it is drained COMPLETELY before V8's microtask queue gets a turn. That ordering is
a Node implementation detail, not a language guarantee, and it is the reason nextTick can starve
the loop in a way promises cannot: a nextTick that queues another nextTick loops forever without
the poll phase ever running again. (Try it: process.nextTick(function f(){ process.nextTick(f) })
and watch your server stop answering while the CPU sits at 100%.)

The practical rule: you almost never want process.nextTick. It exists so a library can emit an
event "after the constructor returns but before any I/O" — for instance, letting the caller attach
an 'error' listener to an object that already knows it has failed. Use queueMicrotask, or nothing.

C before D: at the moment the nextTick queue starts draining, the microtask queue already holds C
(queued during the synchronous body). B runs and appends D. Microtasks are FIFO, so C, then D.
Note that D still runs in this same checkpoint, not the next one — the microtask queue is drained
to EMPTY, including anything added while draining. That is also how a promise loop starves the
loop just as effectively as a nextTick loop.

E before H — the one people get wrong. We are inside an fs.readFile callback, which means we are
standing in the POLL phase. The loop's phase order is:

    timers  →  pending callbacks  →  idle/prepare  →  POLL  →  CHECK  →  close callbacks
                                                       ^you are here  ^setImmediate runs here

CHECK is the very next phase, so the immediate fires within this same iteration. The timer has to
wait for the TIMERS phase of the NEXT iteration. Hence setImmediate first, every single time.

At the top level of a module this flips to a coin toss, because setTimeout(fn, 0) is clamped to
1ms and whether that millisecond has elapsed by the time the first timers phase runs depends on
how long the process spent booting. If you have ever seen this ordering described as
"nondeterministic", that is the case being described — and it stops being nondeterministic the
moment you are inside an I/O callback. "setImmediate means: after the poll phase I am currently
in" is the useful definition; "setTimeout(0) means: at least 1ms from now, checked next lap" is
the other half.

F and G before H: the nextTick and microtask queues are drained after EVERY callback, not once per
loop iteration. So when E finishes, F drains, then G — all still inside the check phase. Only then
does the loop move on, come round to timers, and fire H.

The single sentence worth keeping: microtasks (nextTick, then promises) run between callbacks;
phases run between iterations. Everything above follows from that.
*/
