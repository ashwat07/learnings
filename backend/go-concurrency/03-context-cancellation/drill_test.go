package drill03

import (
	"context"
	"runtime"
	"testing"
	"time"
)

func TestReturnsAllResults(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	out, err := FetchAll(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) != 3 {
		t.Fatalf("got %d results, want 3", len(out))
	}
}

// The three backends take 60, 80 and 70ms. Run concurrently that is ~80ms; run sequentially it is
// ~210ms and cannot fit in a 150ms deadline.
func TestRunsConcurrently(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	start := time.Now()
	out, err := FetchAll(ctx)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("did not finish within the deadline (%v): %v — are the fetches sequential?", elapsed, err)
	}
	if len(out) != 3 {
		t.Fatalf("got %d results, want 3", len(out))
	}
	if elapsed > 140*time.Millisecond {
		t.Fatalf("took %v — that is sequential, not concurrent", elapsed)
	}
}

// The caller gives up after 20ms. FetchAll must notice.
func TestHonoursCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := FetchAll(ctx)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("returned successfully after the context was cancelled — the caller is gone")
	}
	if elapsed > 60*time.Millisecond {
		t.Fatalf("took %v to notice cancellation — ctx is not being passed down", elapsed)
	}
}

// A goroutine that can never exit is a leak, and Go will not collect it.
func TestNoGoroutineLeak(t *testing.T) {
	runtime.GC()
	before := runtime.NumGoroutine()

	for i := 0; i < 20; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Millisecond)
		_, _ = FetchAll(ctx)
		cancel()
	}

	// Give anything still winding down a chance to finish.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		runtime.GC()
		if runtime.NumGoroutine() <= before+2 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("leaked goroutines: %d before, %d after — something is blocked on a channel nobody reads",
		before, runtime.NumGoroutine())
}
