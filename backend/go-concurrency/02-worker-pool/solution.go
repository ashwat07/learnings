// Package drill02 — a bounded worker pool.
//
//	go test -race ./02-worker-pool/
//
// Process 500 jobs against a downstream service that ALLOWS AT MOST 8 CONCURRENT CALLS and returns
// an error if you exceed it — a rate limit, a connection pool, a licensed API.
//
// The version below starts one goroutine per job. With 500 jobs that is 500 simultaneous calls,
// which is the Go equivalent of Promise.all over an unbounded array.
package drill02

import (
	"sync"
)

// Process must call do(job) for every job, with AT MOST maxConcurrent calls in flight, and return
// the results IN THE ORIGINAL ORDER.
func Process(jobs []int, maxConcurrent int, do func(int) (int, error)) ([]int, error) {
	results := make([]int, len(jobs))
	var wg sync.WaitGroup
	var firstErr error

	for i, job := range jobs {
		wg.Add(1)
		go func(i, job int) {
			defer wg.Done()
			r, err := do(job)
			if err != nil {
				firstErr = err // also a data race — the detector will tell you
				return
			}
			results[i] = r
		}(i, job)
	}
	wg.Wait()
	return results, firstErr
}
