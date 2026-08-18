package drill01

import (
	"reflect"
	"testing"
	"unsafe"
)

func TestEvensDoesNotCorruptTheInput(t *testing.T) {
	src := []int{1, 2, 3, 4, 5, 6}
	want := []int{1, 2, 3, 4, 5, 6}

	got := Evens(src)

	if !reflect.DeepEqual(got, []int{2, 4, 6}) {
		t.Errorf("Evens = %v, want [2 4 6]", got)
	}
	if !reflect.DeepEqual(src, want) {
		t.Errorf("Evens SCRIBBLED ON ITS INPUT: src is now %v, was %v", src, want)
	}
}

func TestInsertDoesNotCorruptTheInput(t *testing.T) {
	s := []int{1, 2, 4, 5}
	want := []int{1, 2, 4, 5}

	got := Insert(s, 2, 3)

	if !reflect.DeepEqual(got, []int{1, 2, 3, 4, 5}) {
		t.Errorf("Insert = %v, want [1 2 3 4 5]", got)
	}
	if !reflect.DeepEqual(s, want) {
		t.Errorf("Insert overwrote the original: s is now %v, was %v", s, want)
	}
}

// The one that catches almost everybody. head and tail share a backing array, so appending to
// head writes into tail's first element — unless head's CAPACITY was capped with a three-index
// slice expression.
func TestSplitProducesIndependentSlices(t *testing.T) {
	s := []int{1, 2, 3, 4, 5, 6}
	head, tail := Split(s, 3)

	if !reflect.DeepEqual(head, []int{1, 2, 3}) || !reflect.DeepEqual(tail, []int{4, 5, 6}) {
		t.Fatalf("Split = %v, %v; want [1 2 3], [4 5 6]", head, tail)
	}

	head = append(head, 99)
	if tail[0] != 4 {
		t.Errorf("appending to head overwrote tail: tail = %v, want [4 5 6] — head's capacity still reaches into tail", tail)
	}
}

func TestCloneSharesNothing(t *testing.T) {
	src := []int{1, 2, 3}
	c := Clone(src)

	if !reflect.DeepEqual(c, src) {
		t.Fatalf("Clone = %v, want %v", c, src)
	}
	c[0] = 99
	if src[0] != 1 {
		t.Errorf("Clone returned a view, not a copy: writing to the clone changed src to %v", src)
	}
	if len(src) > 0 && len(c) > 0 && &src[0] == &c[0] {
		t.Errorf("Clone returned a slice with the same backing array")
	}
}

// A 3-element result must not keep a 1,000,000-element array alive. We check the capacity, which
// is the observable proxy for "how much memory this slice pins".
func TestLastThreeDoesNotPinTheWholeArray(t *testing.T) {
	big := make([]int, 1_000_000)
	for i := range big {
		big[i] = i
	}

	got := LastThree(big)

	if !reflect.DeepEqual(got, []int{999997, 999998, 999999}) {
		t.Fatalf("LastThree = %v, want [999997 999998 999999]", got)
	}
	if cap(got) > 8 {
		t.Errorf("the result has cap %d — it still points into the million-element array, "+
			"which can therefore never be collected", cap(got))
	}
	if len(big) > 0 && len(got) > 0 && uintptr(unsafe.Pointer(&got[0])) == uintptr(unsafe.Pointer(&big[999997])) {
		t.Errorf("the result aliases the original backing array")
	}
}

// Not a bug to fix — a fact to internalise. append MAY return a slice with a new backing array,
// and you cannot predict which from the call site.
func TestAppendMayOrMayNotShare(t *testing.T) {
	withRoom := make([]int, 3, 10)
	shared := append(withRoom, 4)
	shared[0] = 99
	if withRoom[0] != 99 {
		t.Errorf("expected append within capacity to share the backing array")
	}

	exact := make([]int, 3, 3)
	copied := append(exact, 4)
	copied[0] = 42
	if exact[0] == 42 {
		t.Errorf("expected append past capacity to allocate a NEW array")
	}
}
