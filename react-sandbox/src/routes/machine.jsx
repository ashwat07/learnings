import { useReducer, useMemo } from 'react';
import { useRenderCount } from '../lib/instrument.js';

/**
 * A UI state machine, in about 40 lines.
 *
 * The argument for machines is not elegance, it is that a checkout flow written with five
 * booleans has 32 states, most of which you never considered — and the bug reports come from
 * exactly those. A machine makes the legal states explicit and the illegal ones unrepresentable.
 */

const MACHINE = {
  initial: 'cart',
  states: {
    cart:      { NEXT: 'address' },
    address:   { NEXT: 'payment', BACK: 'cart' },
    payment:   { SUBMIT: 'submitting', BACK: 'address' },
    submitting:{ SUCCESS: 'confirmed', FAILURE: 'payment_error', TIMEOUT: 'unknown' },
    payment_error: { RETRY: 'payment', BACK: 'address' },
    // The state everyone forgets: the request timed out, so you do NOT know whether the payment
    // went through. Modelling it forces you to decide what the UI says — which is the whole point.
    unknown:   { CHECK: 'checking' },
    checking:  { FOUND: 'confirmed', NOT_FOUND: 'payment', TIMEOUT: 'unknown' },
    confirmed: {},
  },
};

function reducer(state, event) {
  const next = MACHINE.states[state.value]?.[event.type];
  if (!next) {
    // An event that is not legal in this state is IGNORED rather than corrupting the state.
    // With booleans it would have set a flag and produced an impossible combination.
    return { ...state, rejected: [...state.rejected.slice(-4), `${event.type} in ${state.value}`] };
  }
  return { value: next, history: [...state.history, `${state.value} --${event.type}--> ${next}`], rejected: state.rejected };
}

export function Machine() {
  useRenderCount('Machine');
  const [state, send] = useReducer(reducer, { value: MACHINE.initial, history: [], rejected: [] });
  const legal = useMemo(() => Object.keys(MACHINE.states[state.value] ?? {}), [state.value]);

  return (
    <>
      <div className="panel">
        <h2>checkout, as a machine</h2>
        <p>
          <span className="stat">state <b>{state.value}</b></span>
          <span className="stat">legal events <b>{legal.join(', ') || 'none — terminal'}</b></span>
        </p>
        <div className="toolbar">
          {['NEXT', 'BACK', 'SUBMIT', 'SUCCESS', 'FAILURE', 'TIMEOUT', 'RETRY', 'CHECK', 'FOUND', 'NOT_FOUND'].map((e) => (
            <button key={e} onClick={() => send({ type: e })}
              style={{ opacity: legal.includes(e) ? 1 : 0.4 }}>
              {e}
            </button>
          ))}
        </div>
        <p className="hint">
          Faded buttons are events that are not legal in the current state. Press one: nothing
          breaks, and the attempt is logged. With booleans, that same event would have set a flag
          and produced a state nobody designed — <code>isSubmitting && isError && !hasPaid</code>.
        </p>
      </div>

      <div className="panel">
        <h2>the states, and why each exists</h2>
        <div className="rows">
          {Object.entries(MACHINE.states).map(([name, transitions]) => (
            <div className="row" key={name} style={{ gridTemplateColumns: '140px 1fr' }}>
              <span style={{ color: name === state.value ? 'var(--good)' : undefined }}>{name}</span>
              <span>{Object.entries(transitions).map(([e, t]) => `${e} → ${t}`).join(' · ') || '(terminal)'}</span>
            </div>
          ))}
        </div>
        <p className="hint">
          Note <code>unknown</code>: the payment request timed out, so you do not know whether the
          charge went through. Five booleans cannot express “I do not know”; a machine forces you
          to name it and decide what the user sees.
        </p>
      </div>

      <div className="panel">
        <h2>transition log</h2>
        <div className="rows" style={{ maxHeight: 180 }}>
          {state.history.map((h, i) => <div className="row" key={i} style={{ gridTemplateColumns: '1fr' }}>{h}</div>)}
        </div>
        {state.rejected.length > 0 && (
          <p className="hint failed">ignored: {state.rejected.join(' · ')}</p>
        )}
      </div>
    </>
  );
}
