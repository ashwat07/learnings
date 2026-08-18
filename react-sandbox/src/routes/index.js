import { StateStrategy } from './state-strategy.jsx';
import { RenderPerf } from './render-perf.jsx';
import { OptimisticUI } from './optimistic.jsx';
import { Machine } from './machine.jsx';
import { Boundaries } from './boundaries.jsx';
import { Hooks } from './hooks.jsx';
import { Patterns } from './patterns.jsx';
import { Concurrent } from './concurrent.jsx';

export const ROUTES = {
  hooks: { title: 'hooks in depth', component: Hooks },
  state: { title: 'state strategy', component: StateStrategy },
  render: { title: 'render perf', component: RenderPerf },
  optimistic: { title: 'optimistic UI', component: OptimisticUI },
  machine: { title: 'state machine', component: Machine },
  patterns: { title: 'patterns', component: Patterns },
  concurrent: { title: 'concurrent', component: Concurrent },
  boundaries: { title: 'error boundaries', component: Boundaries },
};
