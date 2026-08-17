import { StateStrategy } from './state-strategy.jsx';
import { RenderPerf } from './render-perf.jsx';
import { OptimisticUI } from './optimistic.jsx';
import { Machine } from './machine.jsx';
import { Boundaries } from './boundaries.jsx';

export const ROUTES = {
  state: { title: 'state strategy', component: StateStrategy },
  render: { title: 'render perf', component: RenderPerf },
  optimistic: { title: 'optimistic UI', component: OptimisticUI },
  machine: { title: 'state machine', component: Machine },
  boundaries: { title: 'error boundaries', component: Boundaries },
};
