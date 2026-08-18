# Go, the language

Concurrency lives next door in [`../go-concurrency/`](../go-concurrency/) — goroutines, channels,
`context`, the race detector. This module is everything else: the semantics that decide whether
your program is correct before any goroutine starts.

```bash
cd backend/go-lang
go test ./...                        # all eight, all red
go test ./01-slices-and-aliasing/    # one
go test -bench . -benchmem ./07-allocations/
go build -gcflags='-m' ./07-allocations/ 2>&1 | grep escapes
```

Each drill is a package with a `solution.go` you edit, a `drill_test.go` you do not, and a
`reference.go.txt` with a worked answer and the reasoning. Rename the reference to `.go` to
compile it — after you have tried.

| | | The starting code |
|---|---|---|
| **01** | Slices & aliasing | five functions that quietly corrupt the caller's data |
| **02** | Errors | `%v` instead of `%w` — the sentinel does not survive the trip |
| **03** | The nil interface | returns a non-nil error on the success path, then panics |
| **04** | defer, panic, recover | a divide-by-zero escapes; 1,000 file handles held open |
| **05** | Generics | the constraint is missing `~`, so no named type satisfies it |
| **06** | encoding/json & time | ten defaults that are wrong for an API contract |
| **07** | Allocations | 14 allocations where 1 will do — measured, not guessed |
| **08** | net/http & context | a string context key, middleware in the wrong order |

## What each one is really about

**01 — Slices.** A slice is a pointer, a length and a capacity. It is passed by value, so the
header is copied and the pointer is not. `Evens` uses the well-known `src[:0]` trick and scribbles
on its input; `Insert` overwrites the element it was inserting before; `Split` returns two slices
that share memory. The fix for the last one is the **three-index slice expression** `s[:n:n]` —
the most useful thing about slices and the one most people never learn.

**02 — Errors.** One character: `%w` keeps the error inspectable, `%v` flattens it into text. Then
sentinel vs typed vs opaque, `errors.Is` vs `errors.As`, and `errors.Join` for reporting every
validation problem instead of one per round trip.

**03 — The nil interface.** An interface is two words, and it is nil only when both are nil. A nil
`*NotFoundError` in an `error` is not nil, so `if err != nil` fires on success — and then
`err.Error()` panics on the nil receiver. The compiler cannot help: the conversion is legal.

**04 — defer, panic, recover.** Deferred arguments evaluate immediately, deferred closures do not.
`defer` runs at *function* exit, so one in a loop over 100,000 rows holds 100,000 handles open.
`recover` works only in a function called directly by `defer`, in the panicking goroutine — which
is why a panic in a goroutine your handler spawned kills the whole process.

**05 — Generics.** `int | float64` rejects `type Celsius float64`. `~int | ~float64` accepts it.
The compiler even tells you: *"possibly missing ~ for float64 in Number"*. Also `cmp.Ordered`,
`comparable`, zero values that work without a constructor, and the three things generics still
cannot do.

**06 — JSON & time.** A missing field and a zero field look identical; `omitempty` drops
legitimate zeros; a nil slice is `null`; `,string` is one-way tolerant; and `time.Time` carries a
monotonic reading that makes `==` return false for two identical timestamps.

**07 — Allocations.** `testing.AllocsPerRun` gives an exact count, so this is the rare performance
work you can unit-test. Measured: string concatenation 14 → 1, an unsized slice 12 → 1, an unsized
map 17 → 4. It also documents a target I **removed** because escape analysis was already handling
it — which is the real lesson.

**08 — net/http & context.** A `string` context key collides with every other package in your
build. Middleware wrapped forwards runs backwards, putting your recover *inside* what it protects.
`http.ResponseWriter` does not expose the status code. And `context.WithTimeout` per call, so one
slow shard costs its own budget rather than the whole request's.

## Related

- [`../go-concurrency/`](../go-concurrency/) — goroutines, worker pools, `context` cancellation, `-race`
- [`../node-runtime/`](../node-runtime/) — the same problems, single-threaded
- [`../reliability/`](../reliability/) — timeouts, retries and breakers, in JavaScript
