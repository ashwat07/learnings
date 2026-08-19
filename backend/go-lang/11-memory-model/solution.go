// Package drill11 — the memory model: what "happens before" what, and why a bool is not a signal.
//
//	cd backend/go-lang && go test -race ./11-memory-model/
//
// Go's memory model says almost nothing, and that is the point: if two goroutines touch the same
// variable and at least one writes, you MUST establish a happens-before relationship between
// them, or the program has no defined behaviour. Not "usually works" — undefined.
//
// The mechanisms that establish it, and they are the complete list:
//
//	a channel send happens before the corresponding receive completes
//	closing a channel happens before a receive that returns because it is closed
//	an unlock of a Mutex happens before a subsequent lock
//	the return of once.Do(f) happens after f returns, for every caller
//	an atomic write happens before an atomic read that observes it
//	the go statement happens before the goroutine starts
//	a goroutine's exit does NOT happen before anything — you need a WaitGroup or a channel
//
// Everything below is broken because it uses none of them.
package drill11

import "sync"

// ---------------------------------------------------------------------------
// 1. Lazy initialisation.

type Conn struct{ ID int }

var (
	conn      *Conn
	connCount int
)

// Connect must open the connection EXACTLY ONCE, however many goroutines call it at once.
//
// The version below is "check, then lock, then check again" written without either the check or
// the lock being safe. It is the classic double-checked locking bug, and in Go it is not merely
// a race in theory: `conn = &Conn{...}` is a pointer write and a struct write, and another
// goroutine can observe the pointer before the struct it points at is initialised.
func Connect(open func() *Conn) *Conn {
	if conn == nil {
		conn = open()
		connCount++
	}
	return conn
}

func ConnCount() int { return connCount }

// ---------------------------------------------------------------------------
// 2. A hot-path config swap.

type Config struct {
	Timeout int
	Retries int
	Tag     string
}

var current *Config

// GetConfig is read on every request. SetConfig is called when the config file changes — perhaps
// once an hour. That ratio is the whole design constraint: reads must be as close to free as
// possible, and writes can be as expensive as they like.
//
// Readers must never see a half-built Config: Timeout from the new one and Retries from the old
// is a combination that never existed and that nobody wrote a test for.
func GetConfig() *Config { return current }

func SetConfig(c *Config) { current = c }

// ---------------------------------------------------------------------------
// 3. A read-heavy registry.

type Registry struct {
	mu    sync.Mutex
	items map[string]int
}

func NewRegistry() *Registry { return &Registry{items: map[string]int{}} }

// Lookup is called constantly by many goroutines; Store is rare. A plain Mutex serialises the
// readers against each other for no reason — with eight cores and a 50µs read, that is a 8x
// throughput ceiling you did not need.
func (r *Registry) Lookup(key string) (int, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.items[key]
	return v, ok
}

func (r *Registry) Store(key string, v int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.items[key] = v
}

// ---------------------------------------------------------------------------
// 4. "Are we done yet?"

type Signal struct {
	done bool
}

func NewSignal() *Signal { return &Signal{} }

// Done marks it; Wait blocks until it is marked.
//
// A plain bool plus a spin loop is wrong twice over: it is a data race, and there is nothing
// requiring the compiler or the CPU to ever make the write visible to the reader — so the loop
// may genuinely never terminate. It also burns a core while it waits.
func (s *Signal) Done() { s.done = true }

func (s *Signal) Wait() {
	for !s.done {
	}
}
