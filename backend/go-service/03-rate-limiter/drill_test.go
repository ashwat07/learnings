package drill03

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestBurstThenRefusal(t *testing.T) {
	l := NewLimiter(10, 5, time.Minute) // 10/s, bucket of 5
	for i := 0; i < 5; i++ {
		if !l.Allow("a") {
			t.Fatalf("request %d of the burst was refused", i+1)
		}
	}
	if l.Allow("a") {
		t.Errorf("the 6th request was allowed with an empty bucket")
	}
}

func TestItRefillsAtTheStatedRate(t *testing.T) {
	l := NewLimiter(100, 2, time.Minute) // 100/s => a token every 10ms
	l.Allow("a")
	l.Allow("a")
	if l.Allow("a") {
		t.Fatal("bucket should be empty")
	}
	time.Sleep(60 * time.Millisecond) // ~6 tokens' worth, capped at the burst of 2
	allowed := 0
	for i := 0; i < 5; i++ {
		if l.Allow("a") {
			allowed++
		}
	}
	if allowed != 2 {
		t.Errorf("after 60ms at 100/s with burst 2, %d requests were allowed; want exactly 2 — "+
			"the bucket must refill AND must not exceed the burst", allowed)
	}
}

func TestKeysAreIndependent(t *testing.T) {
	l := NewLimiter(10, 3, time.Minute)
	for i := 0; i < 3; i++ {
		l.Allow("noisy")
	}
	if l.Allow("noisy") {
		t.Fatal("the noisy key should be exhausted")
	}
	for i := 0; i < 3; i++ {
		if !l.Allow("quiet") {
			t.Errorf("a different key was refused because another one was over its limit")
			break
		}
	}
}

// THE one. 500 goroutines, one key, a bucket of 20. Exactly 20 may pass.
func TestExactlyBurstPassesUnderConcurrency(t *testing.T) {
	const burst = 20
	l := NewLimiter(0.001, burst, time.Minute) // effectively no refill during the test

	var allowed atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 500; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if l.Allow("hot") {
				allowed.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()

	if got := allowed.Load(); got != burst {
		t.Errorf("%d requests passed a limit of %d. Check-then-decrement is not atomic: two "+
			"goroutines both see a token and both take it. In Redis this is why the check and the "+
			"decrement have to be one Lua script; here it is why they have to be inside one lock.",
			got, burst)
	}
}

func TestAllowNIsAllOrNothing(t *testing.T) {
	l := NewLimiter(0.001, 10, time.Minute)
	if !l.AllowN("a", 8) {
		t.Fatal("AllowN(8) on a bucket of 10 was refused")
	}
	if l.AllowN("a", 5) {
		t.Error("AllowN(5) succeeded with only 2 tokens left")
	}
	if !l.AllowN("a", 2) {
		t.Error("AllowN(2) was refused with exactly 2 tokens left — and the failed AllowN(5) " +
			"must not have consumed anything")
	}
}

// An unbounded map keyed by client id is a memory leak with a hit rate. Every scraper, every
// health check, every one-request-and-gone bot gets a permanent entry.
func TestIdleBucketsAreEvicted(t *testing.T) {
	l := NewLimiter(10, 5, 80*time.Millisecond)

	for i := 0; i < 20000; i++ {
		l.Allow(fmt.Sprintf("ip-%d", i))
	}
	if n := l.Len(); n < 1000 {
		t.Fatalf("Len = %d immediately after 20,000 distinct keys — buckets are not being kept at all", n)
	}

	// Keep one key hot while the rest go idle.
	deadline := time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(deadline) {
		l.Allow("hot")
		time.Sleep(5 * time.Millisecond)
	}

	if n := l.Len(); n > 100 {
		t.Errorf("still holding %d buckets after the idle TTL expired — 20,000 one-request clients "+
			"is 20,000 permanent map entries, and nothing removes them", n)
	}
	if !l.Allow("hot") && l.Len() == 0 {
		t.Errorf("the hot key was evicted too")
	}
}

// waitWithin runs Wait in a goroutine so a limiter that never returns FAILS the test instead of
// hanging it. Any test of a blocking call needs this shape.
func waitWithin(t *testing.T, l *Limiter, ctx context.Context, key string, budget time.Duration) (error, time.Duration) {
	t.Helper()
	type res struct {
		err     error
		elapsed time.Duration
	}
	ch := make(chan res, 1)
	start := time.Now()
	go func() { err := l.Wait(ctx, key); ch <- res{err, time.Since(start)} }()
	select {
	case r := <-ch:
		return r.err, r.elapsed
	case <-time.After(budget):
		t.Fatalf("Wait did not return within %v — it is spinning, and it is ignoring its context", budget)
		return nil, 0
	}
}

func TestWaitBlocksThenProceeds(t *testing.T) {
	l := NewLimiter(50, 1, time.Minute) // one token every 20ms
	if err, _ := waitWithin(t, l, context.Background(), "a", time.Second); err != nil {
		t.Fatalf("first Wait: %v", err)
	}
	err, waited := waitWithin(t, l, context.Background(), "a", time.Second)
	if err != nil {
		t.Fatalf("second Wait: %v", err)
	}
	if waited < 10*time.Millisecond {
		t.Errorf("Wait returned after %v with an empty bucket — it did not wait", waited)
	}
	if waited > 200*time.Millisecond {
		t.Errorf("Wait took %v for a 20ms refill", waited)
	}
}

func TestWaitHonoursContext(t *testing.T) {
	l := NewLimiter(0.001, 1, time.Minute) // one token, then effectively never
	waitWithin(t, l, context.Background(), "a", time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	err, elapsed := waitWithin(t, l, ctx, "a", 2*time.Second)

	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("Wait = %v, want context.DeadlineExceeded — a limiter that ignores its context "+
			"turns a rate limit into a hang", err)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("Wait ignored its deadline for %v", elapsed)
	}
}

// A limiter must not hold its lock while a caller waits, or one throttled key blocks every other
// key in the process — the same mistake as holding a cache lock across a load (drill 01).
func TestWaitingOnOneKeyDoesNotBlockAnother(t *testing.T) {
	l := NewLimiter(4, 1, time.Minute) // one token every 250ms
	l.Allow("slow")

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
		defer cancel()
		l.Wait(ctx, "slow")
	}()
	time.Sleep(30 * time.Millisecond)

	start := time.Now()
	if !l.Allow("other") {
		t.Fatal("a fresh key was refused")
	}
	if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
		t.Errorf("Allow on an unrelated key took %v while another key was waiting", elapsed)
	}
}

func TestConcurrentMixedTrafficIsRaceFree(t *testing.T) {
	l := NewLimiter(1000, 50, 50*time.Millisecond)
	var wg sync.WaitGroup
	for i := 0; i < 60; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				switch j % 3 {
				case 0:
					l.Allow(fmt.Sprintf("k%d", j%20))
				case 1:
					l.AllowN(fmt.Sprintf("k%d", j%20), 2)
				default:
					l.Len()
				}
			}
		}(i)
	}
	wg.Wait()
}

func BenchmarkAllowHotKey(b *testing.B) {
	l := NewLimiter(1e9, 1e6, time.Minute)
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			l.Allow("hot")
		}
	})
}
