package drill02

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

var errTransient = errors.New("upstream unavailable")
var errPoison = errors.New("cannot parse payload")

// A handler with all five behaviours, and a per-job attempt counter so retries are observable.
func makeHandler() (Handler, func(int) int) {
	var mu sync.Mutex
	attempts := map[int]int{}
	h := func(ctx context.Context, j Job) error {
		mu.Lock()
		attempts[j.ID]++
		n := attempts[j.ID]
		mu.Unlock()

		switch j.Kind {
		case "poison":
			return errPoison
		case "flaky":
			if n < 3 {
				return errTransient
			}
			return nil
		case "panic":
			panic(fmt.Sprintf("handler exploded on job %d", j.ID))
		case "slow":
			select {
			case <-time.After(60 * time.Millisecond):
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		default:
			time.Sleep(5 * time.Millisecond)
			return nil
		}
	}
	return h, func(id int) int { mu.Lock(); defer mu.Unlock(); return attempts[id] }
}

func feed(jobs []Job) <-chan Job {
	in := make(chan Job, len(jobs))
	for _, j := range jobs {
		in <- j
	}
	close(in)
	return in
}

func TestGoodJobsAllComplete(t *testing.T) {
	var jobs []Job
	for i := 1; i <= 40; i++ {
		jobs = append(jobs, Job{ID: i, Kind: "good"})
	}
	h, _ := makeHandler()
	dead := make(chan Dead, 100)
	stats := &Stats{}

	if err := Process(context.Background(), feed(jobs), dead, 8, 4, h, stats); err != nil {
		t.Fatalf("Process: %v", err)
	}
	close(dead)

	s := stats.Snapshot()
	if s.Done != 40 {
		t.Errorf("%d of 40 jobs done", s.Done)
	}
	if n := len(dead); n != 0 {
		t.Errorf("%d jobs dead-lettered with no failures in the batch", n)
	}
}

func TestItActuallyUsesTheWorkers(t *testing.T) {
	var jobs []Job
	for i := 1; i <= 40; i++ {
		jobs = append(jobs, Job{ID: i, Kind: "good"})
	}
	h, _ := makeHandler()
	stats := &Stats{}
	start := time.Now()
	Process(context.Background(), feed(jobs), make(chan Dead, 100), 8, 4, h, stats)
	elapsed := time.Since(start)

	s := stats.Snapshot()
	if s.Peak > 8 {
		t.Errorf("peak concurrency %d, limit was 8 — an unbounded pool is a connection-pool "+
			"exhaustion waiting for a busy afternoon", s.Peak)
	}
	if s.Peak < 4 {
		t.Errorf("peak concurrency only %d of 8 — the workers are not being used", s.Peak)
	}
	if elapsed > 150*time.Millisecond {
		t.Errorf("40 x 5ms jobs across 8 workers took %v — that is sequential", elapsed)
	}
}

// The head-of-line block: three jobs that can never succeed must not stop the other nine.
func TestPoisonJobsGoToTheDLQAndDoNotBlockTheQueue(t *testing.T) {
	var jobs []Job
	for i := 1; i <= 3; i++ {
		jobs = append(jobs, Job{ID: i, Kind: "poison"})
	}
	for i := 4; i <= 12; i++ {
		jobs = append(jobs, Job{ID: i, Kind: "good"})
	}
	h, attemptsFor := makeHandler()
	dead := make(chan Dead, 100)
	stats := &Stats{}

	done := make(chan error, 1)
	go func() { done <- Process(context.Background(), feed(jobs), dead, 4, 4, h, stats) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Process: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Process never returned — a job that always fails is being retried forever, and " +
			"the nine good jobs behind it will never run")
	}
	close(dead)

	if s := stats.Snapshot(); s.Done != 9 {
		t.Errorf("%d of the 9 good jobs completed", s.Done)
	}
	if n := len(dead); n != 3 {
		t.Errorf("%d jobs in the DLQ, want 3", n)
	}
	for d := range dead {
		if d.Err == nil {
			t.Errorf("job %d was dead-lettered with no error recorded — nobody can debug that", d.Job.ID)
		}
		if d.Attempts < 1 || d.Attempts > 4 {
			t.Errorf("job %d recorded %d attempts, maxAttempts was 4", d.Job.ID, d.Attempts)
		}
	}
	for id := 1; id <= 3; id++ {
		if n := attemptsFor(id); n > 4 {
			t.Errorf("poison job %d was attempted %d times, maxAttempts was 4", id, n)
		}
	}
}

func TestFlakyJobsSucceedOnRetry(t *testing.T) {
	jobs := []Job{{ID: 1, Kind: "flaky"}, {ID: 2, Kind: "flaky"}, {ID: 3, Kind: "good"}}
	h, attemptsFor := makeHandler()
	dead := make(chan Dead, 10)
	stats := &Stats{}
	Process(context.Background(), feed(jobs), dead, 2, 5, h, stats)
	close(dead)

	if s := stats.Snapshot(); s.Done != 3 {
		t.Errorf("%d of 3 done — a job that fails twice then works must eventually work", s.Done)
	}
	if len(dead) != 0 {
		t.Errorf("%d flaky jobs were dead-lettered", len(dead))
	}
	if n := attemptsFor(1); n != 3 {
		t.Errorf("job 1 took %d attempts, want 3", n)
	}
}

// A panic in a goroutine takes down the PROCESS. No recover anywhere else can stop it, so a
// worker that runs caller-supplied handlers must recover at its own top.
func TestAPanickingHandlerDoesNotKillTheProcess(t *testing.T) {
	jobs := []Job{{ID: 1, Kind: "panic"}, {ID: 2, Kind: "good"}, {ID: 3, Kind: "good"}}
	h, _ := makeHandler()
	dead := make(chan Dead, 10)
	stats := &Stats{}

	done := make(chan error, 1)
	go func() { done <- Process(context.Background(), feed(jobs), dead, 2, 2, h, stats) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Process never returned")
	}
	close(dead)

	if s := stats.Snapshot(); s.Done != 2 {
		t.Errorf("%d of the 2 good jobs completed", s.Done)
	}
	found := false
	for d := range dead {
		if d.Job.ID == 1 {
			found = true
			if d.Err == nil {
				t.Errorf("the panicking job reached the DLQ with no error")
			}
		}
	}
	if !found {
		t.Errorf("the panicking job did not reach the DLQ")
	}
}

// Graceful drain: SIGTERM arrives, in-flight work finishes, no new work starts.
func TestCancellationDrainsInFlightWorkAndStops(t *testing.T) {
	var jobs []Job
	for i := 1; i <= 200; i++ {
		jobs = append(jobs, Job{ID: i, Kind: "slow"}) // 60ms each
	}
	h, _ := makeHandler()
	stats := &Stats{}
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan error, 1)
	go func() { done <- Process(ctx, feed(jobs), make(chan Dead, 500), 4, 2, h, stats) }()

	time.Sleep(120 * time.Millisecond)
	before := stats.Snapshot().Done
	cancel()

	start := time.Now()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Process ignored the cancellation — your pod is being SIGKILLed right about now")
	}
	elapsed := time.Since(start)

	after := stats.Snapshot()
	if elapsed > 500*time.Millisecond {
		t.Errorf("took %v to stop after cancel", elapsed)
	}
	// In-flight jobs should have been allowed to finish, so a few more complete after cancel...
	if after.Done < before {
		t.Errorf("completed count went backwards")
	}
	// ...but it must not have worked through all 200.
	if after.Done > 60 {
		t.Errorf("%d of 200 jobs completed after cancellation — that is not draining, that is "+
			"ignoring the signal", after.Done)
	}
}

func TestRetriesBackOffAndAreJittered(t *testing.T) {
	var mu sync.Mutex
	var times []time.Time
	h := func(ctx context.Context, j Job) error {
		mu.Lock()
		times = append(times, time.Now())
		mu.Unlock()
		return errPoison
	}
	var jobs []Job
	for i := 1; i <= 12; i++ {
		jobs = append(jobs, Job{ID: i, Kind: "poison"})
	}
	Process(context.Background(), feed(jobs), make(chan Dead, 50), 4, 4, h, &Stats{})

	mu.Lock()
	defer mu.Unlock()
	if len(times) < 40 {
		t.Fatalf("only %d attempts for 12 jobs x 4 attempts", len(times))
	}
	// Attempts must not all land in the same instant.
	span := times[len(times)-1].Sub(times[0])
	if span < 30*time.Millisecond {
		t.Errorf("48 attempts spanned only %v — there is no backoff, and a broken dependency is "+
			"getting hammered as fast as your CPU allows", span)
	}
}

func TestNoGoroutineLeak(t *testing.T) {
	runtime.GC()
	before := runtime.NumGoroutine()

	for round := 0; round < 15; round++ {
		var jobs []Job
		for i := 1; i <= 30; i++ {
			kind := "good"
			if i%7 == 0 {
				kind = "poison"
			}
			jobs = append(jobs, Job{ID: i, Kind: kind})
		}
		h, _ := makeHandler()
		Process(context.Background(), feed(jobs), make(chan Dead, 50), 6, 2, h, &Stats{})
	}

	time.Sleep(200 * time.Millisecond)
	runtime.GC()
	if after := runtime.NumGoroutine(); after > before+5 {
		t.Errorf("goroutines %d -> %d — Process returned before its workers did", before, after)
	}
}

// An unbuffered dead-letter channel with nobody reading it must not deadlock the pool.
func TestABlockedDLQDoesNotDeadlockTheWholePool(t *testing.T) {
	var jobs []Job
	for i := 1; i <= 6; i++ {
		jobs = append(jobs, Job{ID: i, Kind: "poison"})
	}
	h, _ := makeHandler()
	dead := make(chan Dead) // unbuffered, and nobody is reading
	stats := &Stats{}

	consumed := &atomic.Int64{}
	stop := make(chan struct{})
	go func() {
		for {
			select {
			case <-dead:
				consumed.Add(1)
			case <-stop:
				return
			}
		}
	}()

	done := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() { done <- Process(ctx, feed(jobs), dead, 3, 2, h, stats) }()
	select {
	case <-done:
	case <-time.After(4 * time.Second):
		close(stop)
		t.Fatal("Process deadlocked sending to the dead-letter channel")
	}
	close(stop)
	if consumed.Load() == 0 {
		t.Errorf("nothing reached the DLQ")
	}
}
