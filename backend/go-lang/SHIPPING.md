# Shipping Go

The checklist items that are **reference, not drill** — project layout, tooling, the database
libraries, logging and containers. There is no failing assertion that proves you can choose
between `pgx` and `sqlc`; the reason for the choice is the useful part.

For the drillable half, see the [drills](.); for profiling and GC tuning,
[lab 01](labs/01-profiling/).

---

## Project layout

Ignore `golang-standards/project-layout`. It is not a standard, the Go team has said so, and
copying its fifteen directories into a service with four files is cargo cult.

What is actually load-bearing:

```
cmd/api/main.go          one directory per binary. main() is wiring and nothing else.
internal/                the compiler ENFORCES this: nothing outside this module can import it.
  order/                 packages named for the DOMAIN, not the layer
  payment/
  postgres/              adapters named for the technology they adapt
pkg/                     only if you genuinely publish it. Most repos should not have this.
migrations/
```

Two rules that matter more than the tree:

**`internal/` is a real compiler feature.** Anything under it is importable only by code rooted at
its parent. That is the only access control Go has, and it is the difference between "please do not
depend on this" and "you cannot".

**Package names are the API.** `order.Service`, not `services.OrderService` — the package name is
part of every call site, so `util`, `helpers`, `common`, `models` and `base` are all names that
tell a reader nothing. A package called `order` containing `Order`, `Create` and `Repository` reads
as `order.Create(...)`, which is the point.

And accept interfaces, return structs — but define the interface in the package that **consumes**
it, not the one that implements it. That is the inversion that makes Go packages testable without
a mocking framework.

---

## Tooling

```sh
gofmt -l .                 # formatting is not a discussion. gofumpt for a stricter variant.
go vet ./...               # in the standard toolchain. Catches printf mistakes, lost cancels, locks copied by value.
staticcheck ./...          # the one worth installing. Finds real bugs, not style.
golangci-lint run          # runs those plus ~50 more, configured in .golangci.yml
go test -race ./...        # always, in CI
go mod tidy                # and `git diff --exit-code go.mod go.sum` in CI so it stays tidy
govulncheck ./...          # official vulnerability scanner, and it checks whether you actually
                           # CALL the vulnerable function — far less noise than an SCA tool
```

A `.golangci.yml` worth starting from enables `errcheck` (unchecked errors),
`govet`, `staticcheck`, `ineffassign`, `exhaustive` (the switch-over-enum check Go itself
lacks — see [drill 09](09-constants-and-iota/)), and `bodyclose`. Turn off `lll` and the style
linters; they generate noise and no bugs.

**Cross-compilation** is one line and needs no toolchain:

```sh
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/api ./cmd/api
```

`CGO_ENABLED=0` produces a genuinely static binary, which is what lets the Docker image below be
`FROM scratch`. It also changes behaviour: the pure-Go DNS resolver is used instead of the system
one, and `os/user` stops reading `/etc/passwd`. Both are usually fine and both have surprised
people.

`-ldflags="-s -w"` strips the symbol table and DWARF — typically 25% off the binary, at the cost of
readable stack traces from a core dump. And the same flag is how you stamp a build:
`-ldflags="-X main.version=$(git rev-parse --short HEAD)"`.

---

## database/sql, pgx and sqlc

Three layers, and the question is which one you want to own.

**`database/sql`** is the standard interface: a connection pool, `Query`/`Exec`, `Scan` into
variables, and transactions. It knows nothing about any particular database. Everything worth
knowing about the pool itself is in
[node-runtime drill 12](../node-runtime/drills/12-connection-pool/) — the numbers are the same,
the API is `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`.

```go
db.SetMaxOpenConns(25)                    // pods x this <= postgres max_connections
db.SetMaxIdleConns(25)                    // set it EQUAL to MaxOpenConns; the default is 2,
                                          // so 23 connections are opened and closed constantly
db.SetConnMaxLifetime(30 * time.Minute)   // so a load balancer or a failover cannot hand you
                                          // a connection to a server that no longer exists
db.SetConnMaxIdleTime(5 * time.Minute)
```

**`pgx`** is the Postgres driver, and it is better used *natively* than through `database/sql`.
Native mode gives you the binary protocol (measurably faster), real Postgres types (arrays,
`jsonb`, `numeric`, ranges, `LISTEN/NOTIFY`), `CopyFrom` for bulk loads, and batching. Use
`database/sql` compatibility mode only when you need a library that demands `*sql.DB`.

**`sqlc`** generates type-safe Go from your SQL: you write the query, it writes the struct and the
method. This is the option to default to. The queries stay real SQL — reviewable, `EXPLAIN`-able
(see [postgres lab 02](../postgres/labs/02-explain-analyze/)), pasteable into `psql` — and the
compiler checks the plumbing. Compare with:

- **GORM** — an ORM in the Rails sense. It generates the SQL, which means the N+1 in
  [postgres lab 08](../postgres/labs/08-n-plus-1-and-orms/) is one `Preload` away and invisible
  until you profile. Popular; the Go community is broadly sceptical.
- **sqlx** — `database/sql` plus struct scanning. A small, honest improvement, no codegen.
- **ent** — a graph/schema-first ORM with real codegen. Genuinely good if your domain is a graph.

The Go-flavoured advice: you already know SQL, and the plans matter more than the syntax. Write the
query, generate the types.

**Transactions**, with the shape that cannot leak:

```go
func withTx(ctx context.Context, db *sql.DB, fn func(*sql.Tx) error) error {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil { return err }
    defer tx.Rollback()             // a no-op after a successful Commit. This is the idiom.
    if err := fn(tx); err != nil { return err }
    return tx.Commit()
}
```

`defer tx.Rollback()` immediately after `BeginTx` is the Go equivalent of `defer f.Close()`, and
the reason a forgotten rollback path cannot hold a connection open. The isolation-level and
retry material — 40001, `SELECT ... FOR UPDATE SKIP LOCKED`, lost updates — is in
[postgres lab 06](../postgres/labs/06-transactions-and-locking/) and is identical in any language.

---

## Structured logging with `log/slog`

`slog` is in the standard library as of Go 1.21. There is no longer a reason to add zap or zerolog
to a new service unless you have measured logging as a bottleneck.

```go
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level:     slog.LevelInfo,
    AddSource: true,
}))
slog.SetDefault(logger)

slog.InfoContext(ctx, "order created",
    slog.String("order_id", id),
    slog.Int("items", len(items)),
    slog.Duration("took", elapsed))
```

Four things worth doing from the start:

- **`logger.With(...)`** returns a child logger with fields pre-attached. Put the request id and
  the trace id on it once, in middleware, and pass it down the context — the Go equivalent of
  [node-runtime drill 10](../node-runtime/drills/10-async-context/), except Go makes you pass it.
- **Use the typed constructors** (`slog.String`, `slog.Int`) on hot paths: the `...any` form
  allocates for boxing, the typed form does not.
- **Write a custom `Handler`** or implement `LogValuer` to redact secrets at the boundary. A
  `slog.LogValuer` on your `Token` type means it can never be logged in full, from anywhere. That
  is a much stronger guarantee than a redaction regex over the output.
- **JSON to stdout, one line per event, and nothing else.** No log files, no rotation, no
  timestamps you formatted yourself. The platform collects stdout.

The reliability half — RED metrics, percentiles, trace propagation — is in
[`../reliability/`](../reliability/), and the concepts port directly.

---

## Docker

```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download                       # cached until the manifests change
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot:nonroot
ENTRYPOINT ["/api"]
```

This is where Go is genuinely better than everything else: a static binary and nothing else. The
image is the size of your binary — usually 10-30MB — and contains no shell, no package manager and
no libc, so most CVE scanners have nothing to report.

`distroless/static` needs `CGO_ENABLED=0`. If you need CGO (`go-sqlite3`, some image libraries),
use `distroless/base` and accept the extra size.

**Set these, always** — the reasons and the measurements are in [lab 01](labs/01-profiling/):

```
GOMAXPROCS   from the CPU limit. The default reads the HOST's cores, so a 2-core pod on a
             64-core node starts 64 threads and gets throttled. go.uber.org/automaxprocs
             reads the cgroup for you, in one blank import.
GOMEMLIMIT   ~90% of the memory limit. A soft ceiling that makes the GC work harder instead
             of letting the kernel kill you.
GOGC         raise it (200-400) once GOMEMLIMIT is set — measurably less CPU spent collecting.
```

---

## gRPC, briefly

Belongs to the API-styles tier rather than the language, but the Go-specific parts:

- `protoc` + `protoc-gen-go` + `protoc-gen-go-grpc`, orchestrated by **buf** — which also gives you
  linting and, more usefully, **breaking-change detection** against the previous schema in CI.
- **Deadlines propagate automatically.** A `context.Context` with a deadline becomes a gRPC
  deadline on the wire and arrives as a `context.Context` with a deadline on the server. This is
  the thing gRPC gets right that REST leaves to you.
- **Interceptors** are gRPC's middleware, unary and streaming as separate chains. Logging, metrics,
  auth and recovery go here — `go-grpc-middleware` has the standard set.
- **`connect-go`** is worth knowing about: the same generated code, speaking gRPC, gRPC-Web *and*
  plain HTTP/JSON, so a browser can call it with `fetch` and no proxy.
- Four call types — unary, server-stream, client-stream, bidi. Backpressure on a stream is the same
  problem as [node-runtime drill 05](../node-runtime/drills/05-backpressure/), and gRPC's flow
  control handles it for you until you buffer in your own handler.
