# Shipping Node

The checklist items that are **reference, not drill** — because there is no failing assertion that
proves you can choose a package manager. Everything here is a decision with a defensible answer,
and the reason for the answer is the useful part.

For the drillable half, see [the drills](drills/). For diagnostics and profiling, see
[lab 03](labs/03-diagnostics/); for clustering and reloads, [lab 04](labs/04-cluster-and-reloads/).

---

## TypeScript with Node

Three ways to run it, and they are not interchangeable:

| | What it is | Use it when |
|---|---|---|
| `tsc` then `node dist/` | a real build, real `.js` output, real `.d.ts` | you publish a library, or you want the build to fail before deploy |
| `tsx` (or `--import tsx`) | esbuild-based, strips types, no type checking | dev and tests. Fast because it does **not** type check |
| `node --experimental-strip-types` | built in (22.6+), unflagged from 23.6 | scripts, and increasingly services. Type-only syntax only |

**The trap in the last two: stripping types is not type checking.** `tsx` and Node's own stripper
delete annotations and run the result. Nothing verifies them. So `tsc --noEmit` has to run
separately — in CI and in your pre-commit hook — or you are writing TypeScript and getting
JavaScript's guarantees.

Node's stripper also rejects syntax that *emits* code rather than erasing: `enum`, `namespace`,
parameter properties (`constructor(private x: string)`), and legacy decorators. `--experimental-transform-types`
handles them; better, do not use them, because they are the parts of TypeScript that are not
type-level.

The `tsconfig.json` that matches what Node actually does:

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",           // NOT "esnext" — nodenext models Node's real resolution
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,   // arr[i] is T | undefined. It always was.
    "verbatimModuleSyntax": true,       // `import type` stays, `import` stays — no guessing
    "isolatedModules": true,            // so tsx/esbuild and tsc agree
    "sourceMap": true,
    "outDir": "dist"
  }
}
```

`"module": "nodenext"` is the one that matters. Anything else lies to you about what Node will do
at runtime, and the lie surfaces at deploy. It also forces the `.js` extension on relative imports
from `.ts` source — which looks wrong and is correct: you are naming the *output* file.

In production, run the **compiled JavaScript**. `--enable-source-maps` so stack traces point at
your TypeScript, and accept the small startup cost.

---

## Packages, npm and pnpm

**Pick pnpm unless you have a reason not to.** It hard-links a global content-addressed store
instead of copying, so disk and install time drop several-fold, and — more importantly — it
creates a *strict* `node_modules` where a package can only import its own declared dependencies.
npm's flat tree lets you `require('lodash')` because something else depends on it, and that works
until the day it does not.

`package.json`, the fields that decide behaviour:

```jsonc
{
  "type": "module",              // .js files are ESM. Decide once, at the top of the repo.
  "engines": { "node": ">=20.11" },
  "exports": {                   // the public surface. Once present, nothing else is importable.
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist"],             // what actually gets published
  "sideEffects": false           // lets bundlers tree-shake your library
}
```

**`"types"` must come first** in an `exports` condition object — conditions are matched in
declaration order, and TypeScript will silently pick a JavaScript file and infer `any`.

**Semver, as a consumer:** `^1.2.3` is what you want in a library and what you should question in
an application. Pin exact versions plus a lockfile for a service; a lockfile alone is enough if
your CI runs `npm ci` / `pnpm install --frozen-lockfile`, which it must — plain `install` can
silently update.

**Monorepos:** workspaces in `package.json` (npm/pnpm/yarn all support them) plus Turborepo or
Nx for task orchestration and caching. The real question is not the tool, it is whether packages
depend on each other's *source* or *build output* — source is faster in dev and lies about
publishing; output is honest and needs a watcher.

**Publishing:** `npm publish --provenance` from CI (signed, attested to the commit that built it),
`prepublishOnly` to run the build and tests, and `npm pack --dry-run` to see exactly what ships
before it ships.

---

## Testing

Node has a test runner. Use it before reaching for a dependency:

```sh
node --test                     # discovers *.test.js, test/**, etc.
node --test --watch
node --test --experimental-test-coverage
node --test-concurrency=4
```

It gives you `describe`/`it`, `before`/`after`, `t.mock` (functions, timers, modules),
`assert.snapshot`, and TAP output. Two of the three suites in this repo use it. Vitest is worth it
when you need a browser-ish environment, ESM/TS transforms, or its watch UI; Jest is worth it when
your team already knows it.

**The testing shape that matters more than the runner:**

- **Unit** — pure logic, no I/O, milliseconds. Most of your tests.
- **Integration** — your code against a *real* Postgres and Redis, not a mock. Use
  [testcontainers](https://node.testcontainers.org/) so the database is started by the test and
  thrown away after. A mocked database tests your mock.
- **HTTP contract** — start your real app, call it over a real socket. `supertest` wraps this
  neatly; `fetch` against `server.listen(0)` needs no dependency at all and is what
  [`api-craft`](../api-craft/) does.
- **End to end** — a handful, on the critical paths only. They are slow and flaky and worth it
  anyway for "can a user actually sign up".

**What to mock:** the network boundary you do not own (a payment provider, an email service).
**What not to mock:** your own database, your own modules. A test suite full of module mocks tests
the wiring you wrote in the test file.

---

## Security, in the shape it takes in Node

The application-layer material is in [`../auth-and-security/`](../auth-and-security/) (five drills
where the runner plays the attacker) and [`../../security-and-auth/`](../../security-and-auth/) for
the browser half. The Node-specific parts:

| Concern | The answer |
|---|---|
| Headers | `helmet` (Express) or `@fastify/helmet` — CSP, HSTS, `X-Content-Type-Options`, and turning off `X-Powered-By` |
| Rate limiting | Redis-backed, not in-process — see [caching drill 02](../caching-and-queues/drills/02-the-rate-limiter/). In-process means N pods = N× your limit |
| Input validation | Zod or TypeBox at the boundary, then trust the type. Parse, don't validate |
| Body limits | Set them explicitly. See [drill 11](drills/11-streaming-http/) |
| Secrets | Never in `.env` in production. A secret manager, injected as env at runtime, rotated. `--env-file` is a dev convenience |
| Dependency audit | `npm audit --omit=dev` in CI, Dependabot/Renovate for updates, and a lockfile so what you audited is what you install |
| Supply chain | `--ignore-scripts` for installs where you can; postinstall scripts are arbitrary code execution at `npm i` time |
| Prototype pollution | `Object.create(null)` for maps built from user input; validate before merging anything |
| `child_process` | `execFile`/`spawn` with an argument array, never `exec` with an interpolated string |

---

## Docker, and running it

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci                            # cached unless the manifests change
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node                             # the image provides this user; do not run as root
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
```

The five things that are usually wrong:

1. **No `--max-old-space-size`.** Node does not read your cgroup limit. A 512MB pod with Node's
   default ~2GB heap ceiling gets OOM-killed by the kernel with no JavaScript error at all. Set it
   to roughly 75% of the container limit.
2. **`CMD ["npm", "start"]`.** npm becomes PID 1, swallows SIGTERM, and your graceful shutdown
   ([drill 07](drills/07-graceful-shutdown/)) never runs. Exec `node` directly.
3. **No init process.** Node as PID 1 does not reap zombies. Use `--init` or `tini` if you spawn
   child processes.
4. **Running as root.** `USER node`.
5. **Copying `node_modules` from the host.** Native modules are compiled for the host's platform.
   Always `.dockerignore` it.

`node:22-slim` over `-alpine` unless you have measured the difference: Alpine uses musl, which has
caused real, hard-to-diagnose DNS and performance differences. Distroless is smaller still and
gives you no shell to debug with — a real trade, not automatically the right one.

---

## Native addons and N-API

When JavaScript genuinely is not enough — an existing C library, SIMD, or a hot loop that profiles
as the whole cost.

- **N-API (node-api)** is the ABI-stable C interface. An addon built against it keeps working
  across Node major versions **without recompiling** — which is the entire reason it exists, and
  why the old V8-API addons were a maintenance disaster.
- **node-addon-api** is the C++ wrapper over it. **napi-rs** is the Rust one, and is what most new
  native work uses: cargo, no node-gyp, and prebuilt binaries per platform.
- **Prebuild and ship binaries** (`prebuildify`, or napi-rs's platform packages). Requiring your
  users to have a C++ toolchain is how a dependency becomes a support burden.

Before you write one, check the cheaper answers: is it a `worker_thread`
([drill 09](drills/09-worker-threads/))? Is it WebAssembly, which needs no toolchain per platform?
Is it a subprocess? A native addon can crash the whole process with no stack trace and blocks the
event loop unless it is explicitly async, so the bar should be high.

---

## Frameworks

| | |
|---|---|
| **Fastify** | the default recommendation. Fast, schema-first (JSON Schema in, validation and serialisation out), good plugin encapsulation. What [`api-craft`](../api-craft/) uses |
| **Express** | ubiquitous, tiny, no opinions. v5 finally handles async errors. Fine, and you will write the structure yourself |
| **NestJS** | Angular-style DI, decorators, modules. Worth it for a large team that wants one way to do everything; a lot of ceremony for a small service, and its decorators need a `tsc` build |
| **Hono** | runs on Node, Bun, Deno, Workers. Reach for it when the edge is a target |

The thing worth internalising: all four are `http.createServer` plus routing and middleware. If you
know what [drill 07](drills/07-graceful-shutdown/) and [drill 11](drills/11-streaming-http/) are
about, switching between them is an afternoon.
