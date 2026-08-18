// Package drill04 — defer, panic and recover: cleanup order, and the one place recover works.
//
//	cd backend/go-lang && go test ./04-defer-panic-recover/
//
// defer looks like "finally" and behaves differently in three ways that matter: its arguments
// are evaluated NOW, it runs at function exit rather than block exit, and it can change a NAMED
// return value after the return statement has already chosen one.
//
// recover only does anything when called DIRECTLY by a deferred function of the panicking
// goroutine. Not one frame further down, not in a goroutine you started.
package drill04

import (
	"errors"
	"fmt"
)

// Closer records when it was closed, so the tests can check the ORDER.
type Closer struct {
	Name   string
	closed *[]string
}

func (c Closer) Close() { *c.closed = append(*c.closed, c.Name) }

// CloseOrder opens three resources and must close them in the correct order.
func CloseOrder() []string {
	var closed []string
	a := Closer{"a", &closed}
	b := Closer{"b", &closed}
	c := Closer{"c", &closed}
	a.Close()
	b.Close()
	c.Close()
	return closed
}

// SafeDivide returns a/b, and turns the runtime panic on b == 0 into an error.
//
// This is the shape you want at a BOUNDARY — an HTTP handler, a worker loop, a plugin call —
// where one bad request must not take the process down.
func SafeDivide(a, b int) (result int, err error) {
	return a / b, nil
}

// LogValue must report the value x had when the defer statement RAN, not when the function
// returned. This is the difference people get wrong in both directions.
func LogValue() (logged int) {
	x := 1
	defer func() { logged = x }()
	x = 2
	return 0
}

// SumWithCleanup processes n items, opening and closing a resource for each one. All n resources
// must be closed BEFORE the function returns — not all at the end.
//
// `defer` inside a loop is a resource leak with a long fuse: in a loop over 100,000 rows you hold
// 100,000 open file handles until the function finally exits.
func SumWithCleanup(n int, open func(int) func()) int {
	total := 0
	for i := 0; i < n; i++ {
		release := open(i)
		defer release()
		total += i
	}
	return total
}

// Guard runs fn and converts any panic into an error, INCLUDING a panic with a non-error value
// (panic("boom") and panic(42) are both legal).
func Guard(fn func()) (err error) {
	fn()
	return nil
}

var ErrExpected = errors.New("expected failure")

// Retry calls fn up to attempts times. fn may panic; a panic counts as a failure and must not
// escape. Return the last error if every attempt failed.
func Retry(attempts int, fn func(attempt int) error) error {
	var last error
	for i := 0; i < attempts; i++ {
		last = fn(i)
		if last == nil {
			return nil
		}
	}
	return fmt.Errorf("all %d attempts failed: %w", attempts, last)
}
