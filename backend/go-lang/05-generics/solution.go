// Package drill05 — generics: type parameters, constraints, and when they beat an interface.
//
//	cd backend/go-lang && go test ./05-generics/
//
// Go had one answer to "write this once for many types" for a decade: interfaces, plus
// reflection when interfaces were not enough. Generics are a third answer, and the useful skill
// is knowing which of the three a given problem wants.
//
//	interface    the caller's types provide BEHAVIOUR you call (io.Writer, sort.Interface)
//	generic      the caller's types are DATA you move around without caring what they are
//	reflection   you genuinely do not know the shape until runtime (encoding/json) — and you pay
//	             for it in speed, in safety, and in every reader's patience
//
// Everything below is the second case. The interesting part is the CONSTRAINTS.
package drill05

// Number should accept int, float64, and any type whose UNDERLYING type is one of those —
// including a named type like `type Celsius float64`, which is how anyone models a unit.
type Number interface {
	int | float64
}

// Map applies fn to every element. Note it has TWO type parameters: the input and output types
// are independent, which is the whole reason this cannot be written with interface{}.
func Map[T any, U any](s []T, fn func(T) U) []U {
	return nil
}

func Filter[T any](s []T, keep func(T) bool) []T {
	return nil
}

func Reduce[T any, A any](s []T, init A, fn func(A, T) A) A {
	var zero A
	return zero
}

// Sum adds up any numeric slice.
func Sum[T Number](s []T) T {
	var total T
	return total
}

// MaxOf returns the largest element, and the zero value for an empty slice.
// It should work for anything ORDERED — numbers and strings — which is a wider constraint than
// Number and narrower than comparable.
func MaxOf[T Number](s []T) T {
	var zero T
	return zero
}

// Keys returns a map's keys. The key type is constrained by the language itself: map keys must
// be comparable, so T must be too.
func Keys[K comparable, V any](m map[K]V) []K {
	return nil
}

// Set is a generic set. Reference implementations of this in pre-generics Go used
// map[interface{}]struct{} and lost all type safety at the boundary.
type Set[T comparable] struct {
	items map[T]struct{}
}

func NewSet[T comparable](items ...T) *Set[T] { return &Set[T]{} }

func (s *Set[T]) Add(v T)                 {}
func (s *Set[T]) Has(v T) bool            { return false }
func (s *Set[T]) Len() int                { return 0 }
func (s *Set[T]) Union(o *Set[T]) *Set[T] { return nil }

// Ptr returns a pointer to v. Trivial, and one of the most-used generic helpers in real Go: it
// is how you get a *string for an optional JSON field or an SDK's config struct without
// declaring a throwaway variable on every line.
func Ptr[T any](v T) *T {
	return nil
}

// Coalesce returns the first non-zero value, or the zero value if there is none.
func Coalesce[T comparable](vals ...T) T {
	var zero T
	return zero
}
