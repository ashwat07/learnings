package drill07

import (
	"strings"
	"testing"
)

// Sinks. Without these the compiler can prove the results are unused, keep them on the stack,
// and report zero allocations for code that allocates plenty in real use. Every allocation
// benchmark needs one, and forgetting it is how people "prove" their optimisation worked.
var (
	sinkString string
	sinkInts   []int
	sinkInt    int
	sinkMap    map[int]Item
)

func items(n int) []Item {
	out := make([]Item, n)
	for i := range out {
		out[i] = Item{ID: i, Value: i * 3}
	}
	return out
}

func budget(t *testing.T, name string, max float64, fn func()) {
	t.Helper()
	got := testing.AllocsPerRun(100, fn)
	if got > max {
		t.Errorf("%s allocates %.0f times per call, budget is %.0f", name, got, max)
	}
}

func TestJoinWith(t *testing.T) {
	parts := []string{"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"}
	want := strings.Join(parts, ", ")
	if got := JoinWith(parts, ", "); got != want {
		t.Fatalf("JoinWith = %q, want %q", got, want)
	}
	if got := JoinWith(nil, ","); got != "" {
		t.Errorf("JoinWith(nil) = %q, want \"\"", got)
	}
	if got := JoinWith([]string{"only"}, ","); got != "only" {
		t.Errorf("JoinWith of one element = %q", got)
	}
	budget(t, "JoinWith", 2, func() { sinkString = JoinWith(parts, ", ") })
}

func TestCollect(t *testing.T) {
	got := Collect(5)
	if len(got) != 5 || got[0] != 0 || got[4] != 4 {
		t.Fatalf("Collect(5) = %v", got)
	}
	budget(t, "Collect(1000)", 1, func() { sinkInts = Collect(1000) })
}

func TestSumOfDigits(t *testing.T) {
	for _, tc := range []struct{ in, want int }{{0, 0}, {7, 7}, {987654321, 45}, {1000000, 1}} {
		if got := SumOfDigits(tc.in); got != tc.want {
			t.Errorf("SumOfDigits(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
	budget(t, "SumOfDigits", 0, func() { sinkInt = SumOfDigits(987654321) })
}

func TestIndex(t *testing.T) {
	m := Index(items(4))
	if len(m) != 4 || m[2].Value != 6 {
		t.Fatalf("Index = %v", m)
	}
	in := items(500)
	budget(t, "Index(500)", 6, func() { sinkMap = Index(in) })
}

// Run these with -benchmem to see bytes as well as counts:
//
//	go test -bench . -benchmem ./07-allocations/
func BenchmarkJoinWith(b *testing.B) {
	parts := []string{"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		sinkString = JoinWith(parts, ", ")
	}
}

func BenchmarkCollect(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		sinkInts = Collect(1000)
	}
}

func BenchmarkIndex(b *testing.B) {
	in := items(500)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sinkMap = Index(in)
	}
}
