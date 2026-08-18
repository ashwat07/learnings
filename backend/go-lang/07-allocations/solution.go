// Package drill07 — allocations, escape analysis, and a test that counts them.
//
//	cd backend/go-lang && go test ./07-allocations/
//	cd backend/go-lang && go test -bench . -benchmem ./07-allocations/
//	cd backend/go-lang && go build -gcflags='-m' ./07-allocations/ 2>&1 | grep escapes
//
// Go's garbage collector is fast and concurrent, and the cheapest way to keep it that way is to
// give it less to collect. Every heap allocation costs three times: the allocation itself, the
// GC's work to trace it, and the cache miss when you follow the pointer.
//
// testing.AllocsPerRun gives you an EXACT COUNT, not a percentage on a flame graph. That makes
// this the rare kind of performance work you can write a unit test for — and a test that says
// "this function allocates at most once" is a test that stays true.
//
// Every function below has a budget it currently blows. Fix them without changing behaviour.
package drill07

import "strconv"

type Item struct {
	ID    int
	Value int
}

// JoinWith concatenates parts separated by sep. Budget: 2 allocations, whatever len(parts) is.
func JoinWith(parts []string, sep string) string {
	s := ""
	for i, p := range parts {
		if i > 0 {
			s += sep
		}
		s += p
	}
	return s
}

// Collect returns 0..n-1. Budget: 1 allocation.
func Collect(n int) []int {
	var s []int
	for i := 0; i < n; i++ {
		s = append(s, i)
	}
	return s
}

// SumOfDigits adds up the decimal digits of n. Budget: 0 allocations.
func SumOfDigits(n int) int {
	total := 0
	for _, c := range strconv.Itoa(n) {
		total += int(c - '0')
	}
	return total
}

// Index builds an id -> item lookup. Budget: 6 allocations for 500 items.
func Index(items []Item) map[int]Item {
	m := map[int]Item{}
	for _, it := range items {
		m[it.ID] = it
	}
	return m
}
