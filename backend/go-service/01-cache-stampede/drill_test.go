package drill01

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestGetReturnsTheLoadedValue(t *testing.T) {
	c := New(100, time.Minute, func(ctx context.Context, key string) (string, error) {
		return "value-for-" + key, nil
	})
	got, err := c.Get(context.Background(), "a")
	if err != nil || got != "value-for-a" {
		t.Fatalf("Get = %q, %v", got, err)
	}
	if got, _ = c.Get(context.Background(), "a"); got != "value-for-a" {
		t.Errorf("second Get = %q", got)
	}
	if s := c.Stats(); s.Loads != 1 || s.Hits != 1 {
		t.Errorf("stats = %+v, want 1 load and 1 hit", s)
	}
}

// The stampede: 500 goroutines want the same cold key at the same instant.
func TestConcurrentMissesCollapseToOneLoad(t *testing.T) {
	var loads atomic.Int64
	c := New(100, time.Minute, func(ctx context.Context, key string) (string, error) {
		loads.Add(1)
		time.Sleep(50 * time.Millisecond) // a real origin: a query, an API call
		return "loaded", nil
	})

	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make([]string, 500)
	for i := 0; i < 500; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			v, err := c.Get(context.Background(), "hot")
			if err != nil {
				t.Errorf("goroutine %d: %v", i, err)
				return
			}
			results[i] = v
		}(i)
	}
	close(start)
	wg.Wait()

	if n := loads.Load(); n != 1 {
		t.Errorf("load() was called %d times for 500 concurrent misses of one key, want 1 — "+
			"that is %d origin requests you did not need, arriving all at once", n, n)
	}
	for i, v := range results {
		if v != "loaded" {
			t.Fatalf("goroutine %d got %q", i, v)
		}
	}
}

// THE one the naive fix fails. Eight different cold keys, each taking 50ms. With a mutex held
// across the load they run one after another: 400ms. They should overlap: ~50ms.
func TestMissesForDifferentKeysDoNotQueue(t *testing.T) {
	c := New(100, time.Minute, func(ctx context.Context, key string) (string, error) {
		time.Sleep(50 * time.Millisecond)
		return key, nil
	})

	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, err := c.Get(context.Background(), fmt.Sprintf("key-%d", i)); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	elapsed := time.Since(start)

	if elapsed > 200*time.Millisecond {
		t.Errorf("8 independent 50ms loads took %v — they serialised. A lock held across the "+
			"load turns one slow key into a slow cache, for everybody.", elapsed)
	}
}

func TestTTLExpires(t *testing.T) {
	var loads atomic.Int64
	c := New(100, 60*time.Millisecond, func(ctx context.Context, key string) (string, error) {
		loads.Add(1)
		return fmt.Sprintf("v%d", loads.Load()), nil
	})

	first, _ := c.Get(context.Background(), "a")
	second, _ := c.Get(context.Background(), "a")
	if first != second {
		t.Fatalf("the value changed inside the TTL: %q then %q", first, second)
	}
	time.Sleep(120 * time.Millisecond)
	third, _ := c.Get(context.Background(), "a")
	if third == first {
		t.Errorf("still serving %q after the TTL expired", third)
	}
	if loads.Load() != 2 {
		t.Errorf("load() called %d times, want 2", loads.Load())
	}
}

// An unbounded map keyed by something unbounded is not a cache, it is a memory leak with a
// hit rate.
func TestCacheIsBoundedAndEvictsLRU(t *testing.T) {
	c := New(100, time.Minute, func(ctx context.Context, key string) (string, error) { return key, nil })

	for i := 0; i < 10000; i++ {
		if _, err := c.Get(context.Background(), fmt.Sprintf("k%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if n := c.Len(); n > 100 {
		t.Fatalf("Len = %d after 10,000 distinct keys, capacity was 100", n)
	}

	// LRU, not random: touch an old key repeatedly, add pressure, and it should survive.
	c2 := New(10, time.Minute, func(ctx context.Context, key string) (string, error) { return key, nil })
	for i := 0; i < 10; i++ {
		c2.Get(context.Background(), fmt.Sprintf("k%d", i))
	}
	before := c2.Stats().Loads
	for i := 0; i < 5; i++ {
		c2.Get(context.Background(), "k0")                    // keep k0 hot
		c2.Get(context.Background(), fmt.Sprintf("new%d", i)) // evict something
	}
	c2.Get(context.Background(), "k0")
	if c2.Stats().Loads > before+5 {
		t.Errorf("k0 was evicted despite being the most recently used key (%d extra loads) — "+
			"that is eviction by insertion order, not by use", c2.Stats().Loads-before-5)
	}
}

var errOrigin = errors.New("origin unavailable")

func TestAFailedLoadIsNotCachedAndDoesNotPoison(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	var loads atomic.Int64
	c := New(100, time.Minute, func(ctx context.Context, key string) (string, error) {
		loads.Add(1)
		if fail.Load() {
			return "", errOrigin
		}
		return "recovered", nil
	})

	var wg sync.WaitGroup
	errs := make([]error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); _, errs[i] = c.Get(context.Background(), "a") }(i)
	}
	wg.Wait()

	for i, err := range errs {
		if !errors.Is(err, errOrigin) {
			t.Fatalf("waiter %d got %v, want the origin error — a failure must reach every waiter, "+
				"not just the one that made the call", i, err)
		}
	}

	fail.Store(false)
	got, err := c.Get(context.Background(), "a")
	if err != nil || got != "recovered" {
		t.Errorf("after the origin recovered, Get = %q, %v — a cached rejection poisons the key", got, err)
	}
}

// A caller that gives up must not take the shared load down with it.
func TestACancelledWaiterDoesNotCancelTheLoadForOthers(t *testing.T) {
	var loads atomic.Int64
	release := make(chan struct{})
	c := New(100, time.Minute, func(ctx context.Context, key string) (string, error) {
		loads.Add(1)
		<-release
		return "loaded", nil
	})

	patientDone := make(chan error, 1)
	go func() { _, err := c.Get(context.Background(), "a"); patientDone <- err }()
	time.Sleep(20 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	impatient := make(chan error, 1)
	go func() { _, err := c.Get(ctx, "a"); impatient <- err }()

	select {
	case err := <-impatient:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("the impatient caller got %v, want context.DeadlineExceeded", err)
		}
	case <-time.After(time.Second):
		t.Fatal("the impatient caller ignored its own deadline")
	}

	close(release)
	select {
	case err := <-patientDone:
		if err != nil {
			t.Errorf("the patient caller got %v — one caller giving up cancelled the shared load", err)
		}
	case <-time.After(time.Second):
		t.Fatal("the patient caller never finished")
	}
	if loads.Load() != 1 {
		t.Errorf("load() called %d times, want 1", loads.Load())
	}
}

func TestNoGoroutineLeak(t *testing.T) {
	runtime.GC()
	before := runtime.NumGoroutine()

	for round := 0; round < 20; round++ {
		c := New(50, time.Minute, func(ctx context.Context, key string) (string, error) {
			time.Sleep(time.Millisecond)
			return key, nil
		})
		var wg sync.WaitGroup
		for i := 0; i < 50; i++ {
			wg.Add(1)
			go func(i int) { defer wg.Done(); c.Get(context.Background(), fmt.Sprintf("k%d", i%5)) }(i)
		}
		wg.Wait()
	}

	time.Sleep(150 * time.Millisecond)
	runtime.GC()
	if after := runtime.NumGoroutine(); after > before+5 {
		t.Errorf("goroutines %d -> %d", before, after)
	}
}

func BenchmarkHit(b *testing.B) {
	c := New(1000, time.Minute, func(ctx context.Context, key string) (string, error) { return key, nil })
	c.Get(context.Background(), "hot")
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			c.Get(context.Background(), "hot")
		}
	})
}
