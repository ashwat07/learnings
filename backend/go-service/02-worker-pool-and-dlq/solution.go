// Package drill02 — a job worker, with the failure modes Go adds.
//
//	cd backend/go-service && go test -race ./02-worker-pool-and-dlq/
//
// jobs-and-messaging drill 01 is the JavaScript version of this. Go adds four things it could not
// test: real concurrency (so the counters are a data race), goroutine leaks, a panic in a worker
// killing the whole PROCESS, and graceful drain driven by a context.
//
//	Process(ctx, in, dead, workers, maxAttempts, handle) error
//
//	  in           jobs arrive here; the producer closes it when there are no more
//	  dead          jobs that will never succeed go here, with why
//	  workers       how many run at once. Not 1, and not "one per job".
//	  maxAttempts   give up after this many tries and dead-letter it
//	  handle        may return an error, may block, and may PANIC
//
// Return when `in` is closed and everything in flight has finished — or when ctx is cancelled, in
// which case finish what is in flight and stop taking new work.
//
// The version below is the one that gets written first: one job at a time, retry forever, and a
// panic in a handler takes the service with it.
package drill02

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Job struct {
	ID   int
	Kind string // "good", "flaky", "poison", "panic", "slow"
}

type Dead struct {
	Job      Job
	Attempts int
	Err      error
}

type Handler func(ctx context.Context, j Job) error

type Stats struct {
	mu       sync.Mutex
	Done     int
	Attempts int
	Peak     int
	live     int
}

func (s *Stats) enter() {
	s.mu.Lock()
	s.live++
	s.Attempts++
	if s.live > s.Peak {
		s.Peak = s.live
	}
	s.mu.Unlock()
}
func (s *Stats) exit(done bool) {
	s.mu.Lock()
	s.live--
	if done {
		s.Done++
	}
	s.mu.Unlock()
}
func (s *Stats) Snapshot() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Stats{Done: s.Done, Attempts: s.Attempts, Peak: s.Peak}
}

func Process(ctx context.Context, in <-chan Job, dead chan<- Dead, workers, maxAttempts int, handle Handler, stats *Stats) error {
	for job := range in {
		for {
			stats.enter()
			err := handle(ctx, job) // a panic here unwinds Process and kills the process
			stats.exit(err == nil)
			if err == nil {
				break
			}
			time.Sleep(10 * time.Millisecond) // retry forever, at a fixed rate
		}
	}
	_ = fmt.Sprint()
	return nil
}
