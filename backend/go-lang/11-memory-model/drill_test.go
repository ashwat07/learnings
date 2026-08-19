package drill11

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestConnectOpensExactlyOnce(t *testing.T) {
	var opened atomic.Int32
	open := func() *Conn {
		opened.Add(1)
		time.Sleep(time.Millisecond) // opening a connection is not instant, which is the whole problem
		return &Conn{ID: 1}
	}

	var wg sync.WaitGroup
	results := make([]*Conn, 100)
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); results[i] = Connect(open) }(i)
	}
	wg.Wait()

	if n := opened.Load(); n != 1 {
		t.Errorf("open() was called %d times, want 1 — 100 goroutines opened %d connections", n, n)
	}
	if ConnCount() != 1 {
		t.Errorf("ConnCount = %d, want 1", ConnCount())
	}
	for i, c := range results {
		if c == nil || c != results[0] {
			t.Fatalf("caller %d got a different connection", i)
		}
	}
}

func TestConfigSwapIsAtomic(t *testing.T) {
	SetConfig(&Config{Timeout: 3000, Retries: 3, Tag: "a"})

	stop := make(chan struct{})
	var torn atomic.Int32
	var wg sync.WaitGroup

	// Readers: a Config must always be internally consistent.
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				c := GetConfig()
				if c == nil {
					torn.Add(1)
					continue
				}
				// Every config we ever publish has Timeout == Retries * 1000 and a matching tag.
				if c.Timeout != c.Retries*1000 {
					torn.Add(1)
				}
			}
		}()
	}

	// One writer, swapping configs as fast as it can.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 1; i <= 2000; i++ {
			r := i%5 + 1
			SetConfig(&Config{Timeout: r * 1000, Retries: r, Tag: "cfg"})
		}
	}()

	time.Sleep(150 * time.Millisecond)
	close(stop)
	wg.Wait()

	if n := torn.Load(); n > 0 {
		t.Errorf("%d readers saw an inconsistent config", n)
	}
}

func TestRegistryAllowsConcurrentReaders(t *testing.T) {
	r := NewRegistry()
	for i := 0; i < 100; i++ {
		r.Store(string(rune('a'+i%26)), i)
	}

	var live, peak atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				func() {
					n := live.Add(1)
					defer live.Add(-1)
					for {
						p := peak.Load()
						if n <= p || peak.CompareAndSwap(p, n) {
							break
						}
					}
					r.Lookup("a")
					time.Sleep(time.Millisecond) // stand in for real work inside the read
				}()
			}
		}()
	}
	wg.Wait()

	if peak.Load() < 4 {
		t.Errorf("peak concurrent readers was %d of 8 — reads are serialised against each other. "+
			"A read-heavy map wants an RWMutex (or an atomic pointer to an immutable map).", peak.Load())
	}
}

func TestRegistryIsStillCorrectUnderWrites(t *testing.T) {
	r := NewRegistry()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				r.Store("k", i*100+j)
				r.Lookup("k")
			}
		}(i)
	}
	wg.Wait()
	if _, ok := r.Lookup("k"); !ok {
		t.Errorf("the key vanished")
	}
}

func TestSignalWakesTheWaiterAndDoesNotSpin(t *testing.T) {
	s := NewSignal()
	done := make(chan struct{})

	go func() { s.Wait(); close(done) }()

	time.Sleep(20 * time.Millisecond)
	s.Done()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Wait() never returned — nothing requires a plain bool write to become visible " +
			"to another goroutine, ever")
	}

	// A second Wait, after it is already done, must return immediately.
	returned := make(chan struct{})
	go func() { s.Wait(); close(returned) }()
	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("Wait() on an already-signalled Signal blocked")
	}

	// And Done() twice must not panic (closing a closed channel does).
	s.Done()
	s.Done()
}

func TestManyWaitersAllWake(t *testing.T) {
	s := NewSignal()
	var woke atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); s.Wait(); woke.Add(1) }()
	}
	time.Sleep(20 * time.Millisecond)
	s.Done()

	waited := make(chan struct{})
	go func() { wg.Wait(); close(waited) }()
	select {
	case <-waited:
	case <-time.After(2 * time.Second):
		t.Fatalf("only %d of 50 waiters woke", woke.Load())
	}
}
