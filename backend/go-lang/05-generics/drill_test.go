package drill05

import (
	"reflect"
	"sort"
	"strconv"
	"testing"
)

// Named types with a numeric underlying type. If Number is written as `int | float64` these do
// not satisfy it, and the package will not compile — which is the point of the test.
type Celsius float64
type UserID int

func TestMapChangesTheElementType(t *testing.T) {
	got := Map([]int{1, 2, 3}, strconv.Itoa)
	if !reflect.DeepEqual(got, []string{"1", "2", "3"}) {
		t.Errorf("Map = %#v, want []string{\"1\",\"2\",\"3\"}", got)
	}
	if got := Map([]string{"a", "bb"}, func(s string) int { return len(s) }); !reflect.DeepEqual(got, []int{1, 2}) {
		t.Errorf("Map = %#v, want []int{1,2}", got)
	}
}

func TestFilter(t *testing.T) {
	got := Filter([]int{1, 2, 3, 4, 5, 6}, func(n int) bool { return n%2 == 0 })
	if !reflect.DeepEqual(got, []int{2, 4, 6}) {
		t.Errorf("Filter = %v, want [2 4 6]", got)
	}
}

func TestReduceAccumulatesIntoADifferentType(t *testing.T) {
	got := Reduce([]int{1, 2, 3}, "", func(acc string, n int) string { return acc + strconv.Itoa(n) })
	if got != "123" {
		t.Errorf("Reduce = %q, want %q", got, "123")
	}
	if got := Reduce([]string{"a", "b"}, 0, func(acc int, s string) int { return acc + len(s) }); got != 2 {
		t.Errorf("Reduce = %d, want 2", got)
	}
}

// The `~` test. Without `~int | ~float64`, none of this compiles.
func TestNumericConstraintAcceptsNamedTypes(t *testing.T) {
	if got := Sum([]int{1, 2, 3}); got != 6 {
		t.Errorf("Sum ints = %d, want 6", got)
	}
	if got := Sum([]float64{1.5, 2.5}); got != 4 {
		t.Errorf("Sum floats = %v, want 4", got)
	}
	if got := Sum([]Celsius{20.5, 1.5}); got != 22 {
		t.Errorf("Sum Celsius = %v, want 22 — the constraint needs ~ to accept a named type", got)
	}
	if got := Sum([]UserID{1, 2}); got != 3 {
		t.Errorf("Sum UserID = %v, want 3", got)
	}
}

// MaxOf must widen to strings too — which means Number is the wrong constraint for it.
func TestMaxOfWorksForAnythingOrdered(t *testing.T) {
	if got := MaxOf([]int{3, 9, 2}); got != 9 {
		t.Errorf("MaxOf ints = %d, want 9", got)
	}
	if got := MaxOf([]string{"pear", "apple", "quince"}); got != "quince" {
		t.Errorf("MaxOf strings = %q, want %q", got, "quince")
	}
	if got := MaxOf([]Celsius{}); got != 0 {
		t.Errorf("MaxOf of an empty slice = %v, want the zero value", got)
	}
}

func TestKeys(t *testing.T) {
	got := Keys(map[string]int{"a": 1, "b": 2, "c": 3})
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"a", "b", "c"}) {
		t.Errorf("Keys = %v, want [a b c]", got)
	}
	if got := Keys(map[UserID]bool{7: true}); !reflect.DeepEqual(got, []UserID{7}) {
		t.Errorf("Keys = %v, want [7]", got)
	}
}

func TestSet(t *testing.T) {
	s := NewSet(1, 2, 2, 3)
	if s.Len() != 3 {
		t.Errorf("Len = %d, want 3 (duplicates collapse)", s.Len())
	}
	if !s.Has(2) || s.Has(99) {
		t.Errorf("Has is wrong: Has(2)=%v Has(99)=%v", s.Has(2), s.Has(99))
	}
	s.Add(4)
	if !s.Has(4) || s.Len() != 4 {
		t.Errorf("Add did not work: Len=%d", s.Len())
	}

	u := NewSet("a", "b").Union(NewSet("b", "c"))
	if u.Len() != 3 || !u.Has("a") || !u.Has("c") {
		t.Errorf("Union = %d items, want 3 covering a,b,c", u.Len())
	}

	// A zero-value Set must be usable, or every caller needs a constructor.
	var zero Set[string]
	zero.Add("x")
	if !zero.Has("x") {
		t.Errorf("the zero value of Set is not usable — Add on a nil map panics unless you handle it")
	}
}

func TestPtrAndCoalesce(t *testing.T) {
	p := Ptr("hello")
	if p == nil || *p != "hello" {
		t.Errorf("Ptr did not return a pointer to the value")
	}
	if n := Ptr(42); n == nil || *n != 42 {
		t.Errorf("Ptr[int] did not work")
	}

	if got := Coalesce("", "", "third", "fourth"); got != "third" {
		t.Errorf("Coalesce = %q, want %q", got, "third")
	}
	if got := Coalesce(0, 0, 7); got != 7 {
		t.Errorf("Coalesce = %d, want 7", got)
	}
	if got := Coalesce[string](); got != "" {
		t.Errorf("Coalesce of nothing = %q, want the zero value", got)
	}
}
