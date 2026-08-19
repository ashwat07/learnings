// Package drill12 — table-driven tests, fuzzing, and the bugs you do not think of.
//
//	cd backend/go-lang && go test ./12-fuzzing/
//	cd backend/go-lang && go test -fuzz=FuzzTruncate -fuzztime=20s ./12-fuzzing/
//	cd backend/go-lang && go test -cover ./12-fuzzing/
//
// Unit tests check the cases you thought of. A FUZZER generates the ones you did not, keeps the
// inputs that reach new code paths, and mutates those — so it walks into your edge cases rather
// than guessing at them. Go has one built into `go test`, it needs no dependency, and almost
// nobody uses it.
//
// The trick is that a fuzz test cannot assert a specific output for a generated input. It asserts
// PROPERTIES — things that must be true of every input:
//
//	it does not panic
//	the output is still valid UTF-8
//	len(output) <= n
//	the output is a prefix of the input
//
// Both functions below satisfy their unit tests and violate their properties.
package drill12

import (
	"strconv"
	"strings"
)

// Truncate shortens s to at most n BYTES, without splitting a UTF-8 character in half.
//
// Splitting one produces the replacement character in every consumer that reads it, corrupts a
// JSON payload, and is rejected outright by Postgres — which is how a display-only truncation
// becomes a 500 on write.
func Truncate(s string, n int) string {
	return s[:n]
}

// ParseRange parses "3-9" into (3, 9), and a bare "7" into (7, 7).
//
// Whitespace is allowed around the parts. lo must not exceed hi. Anything else is an error —
// and an error, not a panic, because this parses user input.
func ParseRange(s string) (lo, hi int, err error) {
	parts := strings.Split(s, "-")
	if len(parts) == 1 {
		n, _ := strconv.Atoi(parts[0])
		return n, n, nil
	}
	lo, _ = strconv.Atoi(parts[0])
	hi, _ = strconv.Atoi(parts[1])
	return lo, hi, nil
}
