// Package drill01 — a counter incremented from many goroutines.
//
//	cd backend/go-concurrency && go test -race ./01-data-race/
//
// The version below is the canonical data race. `go test` alone may well PASS it — the increment
// is fast and the corruption is intermittent. `go test -race` catches it every time, which is the
// entire lesson: CONCURRENCY BUGS ARE NOT FOUND BY TESTS, THEY ARE FOUND BY THE RACE DETECTOR.
//
// Fix it. There are at least three correct answers and they are not equivalent — the comments in
// reference.go explain when each is right.
package drill01

// Counter is incremented concurrently by many goroutines and read at the end.
type Counter struct {
	value int
}

func New() *Counter { return &Counter{} }

func (c *Counter) Inc() {
	c.value++ // <- read, add, write. Three operations, no protection.
}

func (c *Counter) Value() int {
	return c.value
}
