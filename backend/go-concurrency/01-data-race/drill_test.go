package drill01

import (
	"sync"
	"testing"
)

// TestConcurrentIncrement fails under `go test -race` for the starting code, and — often but not
// always — produces a wrong total even without the flag. "Often but not always" is why you must
// run the detector rather than trusting a green suite.
func TestConcurrentIncrement(t *testing.T) {
	const goroutines, perGoroutine = 100, 1000

	c := New()
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				c.Inc()
			}
		}()
	}
	wg.Wait()

	if got, want := c.Value(), goroutines*perGoroutine; got != want {
		t.Fatalf("lost updates: got %d, want %d (%d increments vanished)", got, want, want-got)
	}
}

// TestConcurrentReadWhileWriting exists because a racy READ is also a race, and it is the half
// people forget when they add a mutex to Inc() and leave Value() bare.
func TestConcurrentReadWhileWriting(t *testing.T) {
	c := New()
	done := make(chan struct{})

	go func() {
		for i := 0; i < 100000; i++ {
			c.Inc()
		}
		close(done)
	}()

	for {
		select {
		case <-done:
			return
		default:
			_ = c.Value()
		}
	}
}
