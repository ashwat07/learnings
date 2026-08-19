// Lab 01 — Profiling, the GC, and the knobs that matter in a container.
//
//	cd backend/go-lang && go run ./labs/01-profiling
//
// Six measured demonstrations. Everything here is in the standard library, and the last section
// leaves you a real CPU profile to open.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"runtime/debug"
	"runtime/pprof"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

func rule(s string) {
	fmt.Printf("\n\033[1m%s\033[0m\n%s\n", s, strings.Repeat("─", min(len(s), 78)))
}
func note(s string) { fmt.Printf("  \033[2m%s\033[0m\n", s) }

func table(headers []string, rows [][]string) {
	// Width in RUNES, not bytes — the separator row is drawn with a 3-byte box character, and
	// len() on it would produce negative padding. (go-lang drill 01, in miniature.)
	width := utf8.RuneCountInString
	w := make([]int, len(headers))
	for i, h := range headers {
		w[i] = width(h)
	}
	for _, r := range rows {
		for i, c := range r {
			if width(c) > w[i] {
				w[i] = width(c)
			}
		}
	}
	line := func(cells []string) string {
		var b strings.Builder
		b.WriteString("  ")
		for i, c := range cells {
			b.WriteString(c)
			b.WriteString(strings.Repeat(" ", w[i]-width(c)+2))
		}
		return strings.TrimRight(b.String(), " ")
	}
	fmt.Printf("\033[2m%s\033[0m\n", line(headers))
	sep := make([]string, len(headers))
	for i := range sep {
		sep[i] = strings.Repeat("─", w[i])
	}
	fmt.Printf("\033[2m%s\033[0m\n", line(sep))
	for _, r := range rows {
		fmt.Println(line(r))
	}
}

// Package-level, so the compiler cannot prove the size at a call site and must heap-allocate.
// Without this, escape analysis keeps the buffers on the stack, the loop becomes dead code, and
// the benchmark measures nothing at all — which is exactly the trap drill 07 is about.
var bufSize = 4096

var sink byte

// The workload: allocate a lot of short-lived garbage, and keep a little of it.
func churn(iterations int) int {
	var kept [][]byte
	total := 0
	for i := 0; i < iterations; i++ {
		b := make([]byte, 1024)
		b[0] = byte(i)
		total += len(b)
		if i%500 == 0 {
			kept = append(kept, b) // 0.2% survives — enough to promote to the old generation
		}
	}
	return total + len(kept)
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--child-churn" {
		// A child process, so GOGC and GOMEMLIMIT can be set per run.
		n, _ := strconv.Atoi(os.Args[2])
		start := time.Now()
		churn(n)
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		fmt.Printf("%d %d %d %d\n", time.Since(start).Milliseconds(), m.NumGC,
			m.PauseTotalNs/1000, m.Sys/1024/1024)
		return
	}

	rule("WHERE THE TIME AND THE MEMORY GO")
	fmt.Printf(`
  Go gives you a profiler, an allocation tracker, a GC trace and a memory limit, all in the
  standard library, all usable in production. This lab measures each one on a workload that is
  deliberately wasteful, so the numbers move.

  Runtime: %s on %s/%s, GOMAXPROCS=%d, %d CPUs available.
`, runtime.Version(), runtime.GOOS, runtime.GOARCH, runtime.GOMAXPROCS(0), runtime.NumCPU())

	// -----------------------------------------------------------------------
	rule("1. MemStats — what the GC is actually doing")
	{
		var before, after runtime.MemStats
		runtime.GC()
		runtime.ReadMemStats(&before)
		start := time.Now()
		churn(400_000)
		elapsed := time.Since(start)
		runtime.ReadMemStats(&after)

		table([]string{"measure", "value"}, [][]string{
			{"wall time", fmt.Sprintf("%v", elapsed.Round(time.Millisecond))},
			{"bytes allocated in total", fmt.Sprintf("%d MB", (after.TotalAlloc-before.TotalAlloc)/1024/1024)},
			{"heap objects allocated", fmt.Sprintf("%d", after.Mallocs-before.Mallocs)},
			{"GC cycles", fmt.Sprintf("%d", after.NumGC-before.NumGC)},
			{"total GC pause", fmt.Sprintf("%.2f ms", float64(after.PauseTotalNs-before.PauseTotalNs)/1e6)},
			{"heap in use now", fmt.Sprintf("%d MB", after.HeapInuse/1024/1024)},
			{"reserved from the OS (Sys)", fmt.Sprintf("%d MB", after.Sys/1024/1024)},
		})
		fmt.Printf(`
  Note the gap between TOTAL ALLOCATED and HEAP IN USE. Hundreds of megabytes passed through the
  allocator and a few are still live — that is a healthy allocation-heavy Go program, not a leak.
  Go's collector is generational-ish in effect (it has a small-object fast path and a
  size-segregated heap), and short-lived garbage is genuinely cheap.

  The number to watch in production is not TotalAlloc, it is PAUSE and the GC's share of CPU.
  Go's collector is CONCURRENT: it marks while your code runs and stops the world only twice per
  cycle, for tens of microseconds. If your p99 has millisecond spikes, GC pauses are almost never
  the cause in modern Go — look at the event loop of your dependencies, your locks, or your
  network. Which is exactly why you measure rather than guess.
`)
	}

	// -----------------------------------------------------------------------
	rule("2. GOGC — the single most important tuning knob, and nobody touches it")
	{
		rows := [][]string{}
		for _, gogc := range []string{"50", "100 (default)", "400", "off"} {
			env := strings.TrimSuffix(strings.Fields(gogc)[0], "")
			cmd := exec.Command(os.Args[0], "--child-churn", "400000")
			cmd.Env = append(os.Environ(), "GOGC="+env)
			out, err := cmd.Output()
			if err != nil {
				rows = append(rows, []string{"GOGC=" + gogc, "failed", "", "", ""})
				continue
			}
			f := strings.Fields(string(out))
			rows = append(rows, []string{"GOGC=" + gogc, f[0] + " ms", f[1], f[2] + " µs", f[3] + " MB"})
		}
		table([]string{"setting", "wall time", "GC cycles", "total pause", "memory from OS"}, rows)
		fmt.Printf(`
  GOGC is a percentage: collect when the heap has grown by GOGC%% since the last collection.
  GOGC=100 (the default) means "collect when the heap doubles". So it is a straight trade:

    lower GOGC   less memory, more CPU spent collecting
    higher GOGC  more memory, less CPU. GOGC=400 typically cuts GC CPU by ~4x
    GOGC=off     no automatic collection at all. Only for short-lived batch jobs.

  Read the table left to right. Going from GOGC=50 to GOGC=400 cuts the GC cycles by more than
  ten times and the total pause with them, for a couple of extra megabytes. If your service has
  memory headroom and is CPU-bound, GOGC=200-400 is often free throughput — one environment
  variable, no code change, and almost nobody tries it.

  Then look at the GOGC=off row, which is the interesting one: it is the SLOWEST. With no
  collection at all the process asks the OS for hundreds of megabytes it never reuses, and the
  page faults and cache misses cost more than the collector ever did. "Turn off the GC" is not a
  free optimisation, and neither is "allocate less" — both are hypotheses to measure.

  The catch, and it is why GOMEMLIMIT exists: GOGC is a RATIO, so a sudden spike in live data
  scales the target with it. A request that loads 2GB makes the next GC target 4GB, and the
  kernel kills you before it happens.
`)
	}

	// -----------------------------------------------------------------------
	rule("3. GOMEMLIMIT — the flag every containerised Go service should set")
	{
		before := debug.SetMemoryLimit(-1) // -1 reads without setting
		fmt.Printf("  current soft memory limit: %s\n", func() string {
			if before == 1<<63-1 {
				return "none (math.MaxInt64)"
			}
			return fmt.Sprintf("%d MB", before/1024/1024)
		}())
		fmt.Printf(`
  Go 1.19 added a SOFT memory limit: as the heap approaches it, the collector runs more
  aggressively — continuously if it has to — instead of respecting GOGC. It cannot prevent an OOM
  if your LIVE set genuinely exceeds it, but it prevents the common case, where a burst of
  garbage pushes a GOGC-driven target past the container limit.

    GOMEMLIMIT=1800MiB      or  debug.SetMemoryLimit(1800 << 20)

  The recommended production setup is the pair: GOMEMLIMIT at about 90%% of the container limit,
  and GOGC=off or a high GOGC. Then the memory limit becomes the thing that triggers collection,
  and you use the whole container instead of a fraction of it. This is the Go equivalent of
  Node's --max-old-space-size, with the important difference that it is a SOFT limit and Go will
  keep running (slowly) rather than crashing.

  And the other half, which people miss: GOMAXPROCS does NOT read your CPU quota either. A pod
  limited to 2 cores on a 64-core node starts with GOMAXPROCS=64, so the scheduler creates 64 OS
  threads for a 2-core budget and you get throttled hard. Set it explicitly, or use
  go.uber.org/automaxprocs, which reads the cgroup for you. This is the single most common
  performance bug in containerised Go.
`)
	}

	// -----------------------------------------------------------------------
	rule("4. sync.Pool — reuse, and when it is worth it")
	{
		const iterations = 200_000
		var m1, m2 runtime.MemStats

		runtime.GC()
		runtime.ReadMemStats(&m1)
		t0 := time.Now()
		for i := 0; i < iterations; i++ {
			buf := make([]byte, bufSize)
			buf[0] = byte(i)
			sink = buf[len(buf)-1]
		}
		plain := time.Since(t0)
		runtime.ReadMemStats(&m2)
		plainAlloc := (m2.TotalAlloc - m1.TotalAlloc) / 1024 / 1024
		plainGC := m2.NumGC - m1.NumGC

		pool := sync.Pool{New: func() any { b := make([]byte, bufSize); return &b }}
		runtime.GC()
		runtime.ReadMemStats(&m1)
		t0 = time.Now()
		for i := 0; i < iterations; i++ {
			p := pool.Get().(*[]byte)
			(*p)[0] = byte(i)
			sink = (*p)[len(*p)-1]
			pool.Put(p)
		}
		pooled := time.Since(t0)
		runtime.ReadMemStats(&m2)
		pooledAlloc := (m2.TotalAlloc - m1.TotalAlloc) / 1024 / 1024
		pooledGC := m2.NumGC - m1.NumGC

		table([]string{"200,000 x 4KB buffer", "time", "allocated", "GC cycles"}, [][]string{
			{"make() every time", plain.Round(time.Millisecond).String(), fmt.Sprintf("%d MB", plainAlloc), fmt.Sprintf("%d", plainGC)},
			{"sync.Pool", pooled.Round(time.Millisecond).String(), fmt.Sprintf("%d MB", pooledAlloc), fmt.Sprintf("%d", pooledGC)},
		})
		fmt.Printf(`
  Note what a Pool stores: a POINTER to the slice, not the slice. Putting a []byte in directly
  allocates, because a slice header has to be boxed into the ` + "`any`" + ` — which is the allocation
  you were trying to avoid. ` + "`go vet`" + ` warns about this (SA6002 in staticcheck).

  When a Pool is worth it: large, uniformly-sized, short-lived buffers on a hot path — encoders,
  HTTP body buffers, image scratch space. encoding/json uses one internally; so does net/http.

  When it is not: anything small, anything variable-sized (you end up pooling 1KB buffers and
  needing 1MB ones), anything you might forget to Put back. And note that the GC EMPTIES the pool
  on every cycle, so a Pool is a short-term cache, never a free list you can rely on.

  The failure mode to fear is not slowness: it is putting back a buffer someone still holds a
  slice into. That is a data race and a data-corruption bug, and ` + "`-race`" + ` will not find it
  unless the two users overlap in time during your test.
`)
	}

	// -----------------------------------------------------------------------
	rule("5. escape analysis, from the compiler's own mouth")
	{
		cmd := exec.Command("go", "build", "-gcflags=-m", "-o", os.DevNull, "./labs/01-profiling")
		out, _ := cmd.CombinedOutput()
		lines := []string{}
		for _, l := range strings.Split(string(out), "\n") {
			if strings.Contains(l, "escapes to heap") || strings.Contains(l, "moved to heap") {
				lines = append(lines, strings.TrimSpace(l))
			}
		}
		if len(lines) > 6 {
			lines = lines[:6]
		}
		for _, l := range lines {
			note(l)
		}
		if len(lines) == 0 {
			note("(no escapes reported — run `go build -gcflags=-m ./...` yourself)")
		}
		fmt.Printf(`
  Those are the compiler's actual decisions about this file. -gcflags='-m -m' explains WHY.

  This is how you check an optimisation rather than believe in it, and it pairs with drill 07's
  testing.AllocsPerRun: -m tells you what the compiler decided, AllocsPerRun tells you what it
  cost, and only the second one can be a regression test.
`)
	}

	// -----------------------------------------------------------------------
	rule("6. a real CPU profile, and the commands to read it")
	{
		f, err := os.CreateTemp("", "go-lab-cpu-*.pprof")
		if err == nil {
			_ = pprof.StartCPUProfile(f)
			churn(600_000)
			pprof.StopCPUProfile()
			_ = f.Close()

			hf, err2 := os.CreateTemp("", "go-lab-heap-*.pprof")
			if err2 == nil {
				runtime.GC()
				_ = pprof.WriteHeapProfile(hf)
				_ = hf.Close()
				note("heap profile: " + hf.Name())
			}
			note("cpu profile:  " + f.Name())
			fmt.Printf(`
  Read them:

    go tool pprof -top -nodecount=15 %s
    go tool pprof -http=:8080 %s          # flame graph in a browser

  The four profile types, and what each one answers:

    cpu     where time is spent          go tool pprof -http=: cpu.pprof
    heap    what is allocated, and what is STILL LIVE. Two different questions:
              -sample_index=alloc_objects   what allocates most often  -> GC pressure
              -sample_index=inuse_space     what is still holding memory -> leaks
    block   where goroutines wait on channels and mutexes. Off by default:
              runtime.SetBlockProfileRate(1)
    mutex   lock contention. Also off by default:
              runtime.SetMutexProfileFraction(5)

  IN A RUNNING SERVICE, one import gives you all of them over HTTP:

    import _ "net/http/pprof"
    go func() { log.Println(http.ListenAndServe("localhost:6060", nil)) }()

    go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
    go tool pprof http://localhost:6060/debug/pprof/heap
    go tool pprof http://localhost:6060/debug/pprof/goroutine     # find the leak

  Bind it to LOCALHOST, never to the public interface: those endpoints expose your source
  structure, let anyone trigger a 30-second profile, and can dump your heap. Put it on a separate
  port behind your ingress, or on a Unix socket.

  AND THE ONE PEOPLE FORGET: the execution TRACER.

    go tool trace                        # after runtime/trace.Start(f)
    go test -trace=trace.out

  pprof tells you where the CPU went. The tracer shows you goroutine scheduling, GC phases,
  syscall blocking and network waits on a timeline — which is the only tool that answers "why is
  this idle?" rather than "what is it busy with?".
`, f.Name(), f.Name())
		}
	}

	rule("the checklist for a Go service in a container")
	fmt.Print(`
  GOMAXPROCS          set from the CPU limit (automaxprocs) — the default reads the HOST's cores
  GOMEMLIMIT          ~90% of the memory limit, as a soft ceiling
  GOGC                raise it (200-400) or turn it off once GOMEMLIMIT is set
  net/http/pprof      imported, bound to localhost
  -race               in CI, on the whole suite
  -benchmem           on the benchmarks that matter, compared with benchstat
  a CPU profile       captured under real load, not on your laptop
`)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
