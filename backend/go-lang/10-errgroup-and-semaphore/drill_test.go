package drill10

import (
	"context"
	"errors"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

var errBoom = errors.New("boom")

func TestGroupRunsConcurrentlyAndReturnsNil(t *testing.T) {
	g, _ := NewGroup(context.Background())
	var done atomic.Int32

	start := time.Now()
	for i := 0; i < 10; i++ {
		g.Go(func() error {
			time.Sleep(60 * time.Millisecond)
			done.Add(1)
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		t.Fatalf("Wait = %v, want nil", err)
	}
	if elapsed := time.Since(start); elapsed > 250*time.Millisecond {
		t.Errorf("10 x 60ms took %v — that is sequential", elapsed)
	}
	if done.Load() != 10 {
		t.Errorf("%d of 10 ran", done.Load())
	}
}

func TestGroupReturnsTheFirstError(t *testing.T) {
	g, _ := NewGroup(context.Background())
	g.Go(func() error { time.Sleep(10 * time.Millisecond); return errBoom })
	g.Go(func() error { time.Sleep(80 * time.Millisecond); return errors.New("later") })
	g.Go(func() error { return nil })

	err := g.Wait()
	if !errors.Is(err, errBoom) {
		t.Errorf("Wait = %v, want the FIRST error (%v)", err, errBoom)
	}
}

// The half a WaitGroup cannot do: when one task fails, the others should stop.
func TestGroupCancelsTheContextOnFirstError(t *testing.T) {
	g, ctx := NewGroup(context.Background())
	var cancelled atomic.Int32

	g.Go(func() error { time.Sleep(20 * time.Millisecond); return errBoom })
	for i := 0; i < 4; i++ {
		g.Go(func() error {
			select {
			case <-ctx.Done():
				cancelled.Add(1)
				return ctx.Err()
			case <-time.After(3 * time.Second):
				return nil
			}
		})
	}

	start := time.Now()
	if err := g.Wait(); !errors.Is(err, errBoom) {
		t.Errorf("Wait = %v, want %v", err, errBoom)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("Wait took %v — the other tasks were never told to stop", elapsed)
	}
	if cancelled.Load() != 4 {
		t.Errorf("%d of 4 siblings saw the cancellation", cancelled.Load())
	}
}

func TestGroupSetLimit(t *testing.T) {
	g, _ := NewGroup(context.Background())
	g.SetLimit(3)

	var live, peak atomic.Int32
	for i := 0; i < 30; i++ {
		g.Go(func() error {
			n := live.Add(1)
			for {
				p := peak.Load()
				if n <= p || peak.CompareAndSwap(p, n) {
					break
				}
			}
			time.Sleep(10 * time.Millisecond)
			live.Add(-1)
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		t.Fatal(err)
	}
	if peak.Load() > 3 {
		t.Errorf("peak concurrency %d, limit was 3", peak.Load())
	}
	if peak.Load() < 2 {
		t.Errorf("peak concurrency only %d — SetLimit made it serial", peak.Load())
	}
}

// A panic in a goroutine kills the WHOLE PROCESS — no recover anywhere else can stop it. A fan-out
// helper that runs caller-supplied functions has to handle that, or one bad row takes down the
// service.
func TestGroupTurnsAPanicIntoAnError(t *testing.T) {
	g, _ := NewGroup(context.Background())
	g.Go(func() error { panic("task exploded") })
	g.Go(func() error { return nil })

	err := g.Wait()
	if err == nil {
		t.Fatal("Wait = nil; the panic was swallowed or the process should already be dead")
	}
	if got := err.Error(); got == "" || !contains(got, "exploded") {
		t.Errorf("err = %q, want it to mention the panic value", got)
	}
}

func TestGroupLeavesNoGoroutines(t *testing.T) {
	runtime.GC()
	before := runtime.NumGoroutine()

	for i := 0; i < 20; i++ {
		g, _ := NewGroup(context.Background())
		g.SetLimit(4)
		for j := 0; j < 20; j++ {
			g.Go(func() error { time.Sleep(time.Millisecond); return nil })
		}
		_ = g.Wait()
	}

	time.Sleep(100 * time.Millisecond)
	runtime.GC()
	if after := runtime.NumGoroutine(); after > before+5 {
		t.Errorf("goroutines %d -> %d; Wait() returned before its workers finished", before, after)
	}
}

// ---------------------------------------------------------------------------

func TestSemaphoreBoundsWeight(t *testing.T) {
	s := NewSemaphore(100)
	ctx := context.Background()

	var inFlight, peak atomic.Int64
	done := make(chan struct{})
	for i := 0; i < 20; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			if err := s.Acquire(ctx, 30); err != nil {
				return
			}
			n := inFlight.Add(30)
			for {
				p := peak.Load()
				if n <= p || peak.CompareAndSwap(p, n) {
					break
				}
			}
			time.Sleep(10 * time.Millisecond)
			inFlight.Add(-30)
			s.Release(30)
		}()
	}
	for i := 0; i < 20; i++ {
		<-done
	}
	if peak.Load() > 100 {
		t.Errorf("peak weight in flight was %d, capacity is 100", peak.Load())
	}
	if peak.Load() < 90 {
		t.Errorf("peak weight only reached %d of 100 — it is not using the capacity", peak.Load())
	}
}

func TestSemaphoreHonoursContext(t *testing.T) {
	s := NewSemaphore(1)
	if err := s.Acquire(context.Background(), 1); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	start := time.Now()
	err := s.Acquire(ctx, 1)
	elapsed := time.Since(start)

	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("Acquire = %v, want context.DeadlineExceeded — a semaphore that ignores its "+
			"context is a hang with extra steps", err)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("Acquire waited %v past its deadline", elapsed)
	}

	// And it must not have taken the unit on its way out.
	s.Release(1)
	if !s.TryAcquire(1) {
		t.Errorf("the timed-out Acquire consumed a unit it never got")
	}
}

// A big waiter must not starve behind an endless queue of small ones.
func TestSemaphoreIsFIFO(t *testing.T) {
	s := NewSemaphore(10)
	ctx := context.Background()
	if err := s.Acquire(ctx, 10); err != nil {
		t.Fatal(err)
	}

	order := make(chan string, 2)
	go func() { _ = s.Acquire(ctx, 10); order <- "big" }()
	time.Sleep(30 * time.Millisecond) // the big one is queued first
	go func() { _ = s.Acquire(ctx, 1); order <- "small" }()
	time.Sleep(30 * time.Millisecond)

	s.Release(10)

	select {
	case first := <-order:
		if first != "big" {
			t.Errorf("%q was served first; the big waiter was queued first and must not be "+
				"jumped by a smaller one, or it never runs at all", first)
		}
	case <-time.After(time.Second):
		t.Fatal("nobody was served")
	}
}

func TestTryAcquireNeverBlocks(t *testing.T) {
	s := NewSemaphore(2)
	if !s.TryAcquire(2) {
		t.Fatal("TryAcquire(2) on an empty semaphore of 2 failed")
	}
	if s.TryAcquire(1) {
		t.Errorf("TryAcquire succeeded with no capacity left")
	}
	s.Release(2)
	if !s.TryAcquire(1) {
		t.Errorf("TryAcquire failed after a release")
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
