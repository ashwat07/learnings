// Package drill10 — errgroup and a weighted semaphore, built from scratch.
//
//	cd backend/go-lang && go test -race ./10-errgroup-and-semaphore/
//
// golang.org/x/sync gives you both of these and you should use them. Writing them once is how
// you learn what they guarantee — and, more usefully, what they do NOT.
//
// A sync.WaitGroup counts. It does not collect errors, it does not cancel the others when one
// fails, it does not bound concurrency, and it does not survive a panic. Every real fan-out needs
// all four, and reaching for a bare WaitGroup is how you end up with 5,000 goroutines all still
// working on a request that failed two seconds ago.
package drill10

import (
	"context"
	"sync"
)

// Group runs functions concurrently and reports the FIRST error.
//
//	g, ctx := NewGroup(parent)
//	g.SetLimit(8)
//	for _, id := range ids {
//	    g.Go(func() error { return fetch(ctx, id) })
//	}
//	err := g.Wait()
//
// Requirements:
//
//	· Wait() returns the first non-nil error, or nil
//	· the ctx returned by NewGroup is CANCELLED as soon as any function returns an error, so the
//	  others can stop instead of finishing work nobody wants
//	· SetLimit(n) bounds how many run at once; Go() blocks when the limit is reached
//	· a PANIC in a function becomes an error rather than killing the process
//	· no goroutine outlives Wait()
type Group struct {
	wg  sync.WaitGroup
	err error
}

func NewGroup(ctx context.Context) (*Group, context.Context) {
	return &Group{}, ctx
}

func (g *Group) SetLimit(n int) {}

func (g *Group) Go(fn func() error) {
	g.wg.Add(1)
	go func() {
		defer g.wg.Done()
		if err := fn(); err != nil {
			g.err = err // <- written from many goroutines. `go test -race` has opinions.
		}
	}()
}

func (g *Group) Wait() error {
	g.wg.Wait()
	return g.err
}

// ---------------------------------------------------------------------------

// Semaphore is a WEIGHTED semaphore: a caller can ask for more than one unit at a time.
//
// That is the difference from a plain "max N concurrent". Weight lets you model the resource
// rather than the caller: a job that will load a 500MB file takes 500 units of a 1000-unit
// memory budget, and a job that loads 10MB takes 10. Two big jobs cannot run together; fifty
// small ones can.
//
// Requirements:
//
//	· Acquire blocks until n units are free, or ctx is done — in which case it returns ctx.Err()
//	  and takes NOTHING
//	· Release returns units
//	· FIFO: a waiter asking for a large weight must not be starved by a queue of small ones
//	· TryAcquire never blocks
type Semaphore struct {
	mu   sync.Mutex
	free int64
}

func NewSemaphore(n int64) *Semaphore { return &Semaphore{free: n} }

func (s *Semaphore) Acquire(ctx context.Context, n int64) error {
	for {
		s.mu.Lock()
		if s.free >= n {
			s.free -= n
			s.mu.Unlock()
			return nil
		}
		s.mu.Unlock()
		// spin. This burns a core and is not FIFO.
	}
}

func (s *Semaphore) TryAcquire(n int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.free < n {
		return false
	}
	s.free -= n
	return true
}

func (s *Semaphore) Release(n int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.free += n
}
