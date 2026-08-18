// Package drill01 — slices: the part of Go that looks like a list and is not one.
//
//	cd backend/go-lang && go test ./01-slices-and-aliasing/
//
// A slice is three words: a POINTER to a backing array, a LENGTH, and a CAPACITY. It is passed by
// value, so the header is copied — but the pointer inside it is not, and that is where every bug
// in this drill comes from. Two slices can share memory, and neither one can tell.
//
// Every function below has a plausible implementation that passes a casual test and silently
// corrupts the caller's data. Some of them are already written that way. Fix them.
package drill01

// Evens returns the even numbers from src.
//
// The implementation below is a well-known Go trick — reuse src's backing array to avoid an
// allocation — and it is correct ONLY when the caller has agreed to give up src. Here it has not.
func Evens(src []int) []int {
	out := src[:0]
	for _, v := range src {
		if v%2 == 0 {
			out = append(out, v)
		}
	}
	return out
}

// Insert returns a new slice with v inserted at index i.
func Insert(s []int, i int, v int) []int {
	out := append(s[:i], v)
	return append(out, s[i:]...)
}

// Split returns the first n elements and the rest, as two slices that the caller will append to
// INDEPENDENTLY. Appending to the first must never overwrite the second.
func Split(s []int, n int) (head, tail []int) {
	return s[:n], s[n:]
}

// Clone returns a copy that shares nothing with src.
func Clone(src []int) []int {
	return src
}

// LastThree returns the final three elements of a large slice, in a way that lets the rest of the
// large slice be garbage collected. Returning s[len(s)-3:] keeps a pointer into the ORIGINAL
// backing array, so a 3-element slice can pin a million-element array in memory forever.
func LastThree(s []int) []int {
	return s[len(s)-3:]
}
