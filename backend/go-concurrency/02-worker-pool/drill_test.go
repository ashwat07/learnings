package drill02

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// downstream refuses more than `limit` concurrent callers — a rate limit, a connection pool, a
// licensed API. This is what makes unbounded concurrency a correctness bug, not just a rude one.
func downstream(limit int32) (func(int) (int, error), *int32) {
	var inFlight, peak int32
	fn := func(job int) (int, error) {
		n := atomic.AddInt32(&inFlight, 1)
		defer atomic.AddInt32(&inFlight, -1)
		for {
			p := atomic.LoadInt32(&peak)
			if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
				break
			}
		}
		if n > limit {
			return 0, errors.New("429 too many concurrent requests")
		}
		time.Sleep(time.Millisecond)
		return job * 2, nil
	}
	return fn, &peak
}

func TestRespectsConcurrencyLimit(t *testing.T) {
	jobs := make([]int, 500)
	for i := range jobs {
		jobs[i] = i
	}
	do, peak := downstream(8)

	results, err := Process(jobs, 8, do)
	if err != nil {
		t.Fatalf("downstream rejected a call: %v (peak concurrency %d, limit 8)", err, atomic.LoadInt32(peak))
	}
	if p := atomic.LoadInt32(peak); p > 8 {
		t.Fatalf("peak concurrency was %d, limit is 8", p)
	}
	for i, r := range results {
		if r != i*2 {
			t.Fatalf("result[%d] = %d, want %d — results are out of order or missing", i, r, i*2)
		}
	}
}

func TestPropagatesError(t *testing.T) {
	sentinel := errors.New("boom")
	do := func(job int) (int, error) {
		if job == 42 {
			return 0, sentinel
		}
		return job, nil
	}
	jobs := make([]int, 100)
	for i := range jobs {
		jobs[i] = i
	}
	if _, err := Process(jobs, 4, do); !errors.Is(err, sentinel) {
		t.Fatalf("got %v, want the sentinel error", err)
	}
}

// A pool that starts a goroutine per job does not "use" its limit — this makes that visible.
func TestDoesNotStartAGoroutinePerJob(t *testing.T) {
	jobs := make([]int, 200)
	do, peak := downstream(1000) // permissive, so we measure rather than error
	_, _ = Process(jobs, 4, do)
	if p := atomic.LoadInt32(peak); p > 4 {
		t.Fatalf("peak concurrency %d with maxConcurrent=4 — the limit is not being applied", p)
	}
}
