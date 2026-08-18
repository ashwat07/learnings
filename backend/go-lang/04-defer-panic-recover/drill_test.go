package drill04

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

// Deferred calls run LIFO. The idiom `defer f.Close()` right after opening is what makes this
// correct by construction: the thing opened last is closed first, which is what you need when
// resource c was built out of b.
func TestClosersRunInReverseOrder(t *testing.T) {
	got := CloseOrder()
	want := []string{"c", "b", "a"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("close order = %v, want %v (defer is LIFO: last opened, first closed)", got, want)
	}
}

func TestSafeDivide(t *testing.T) {
	if got, err := SafeDivide(10, 2); got != 5 || err != nil {
		t.Errorf("SafeDivide(10, 2) = %d, %v; want 5, nil", got, err)
	}

	got, err := SafeDivide(1, 0)
	if err == nil {
		t.Fatal("SafeDivide(1, 0) did not return an error — did the panic escape?")
	}
	if got != 0 {
		t.Errorf("result = %d on the error path, want the zero value", got)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "zero") {
		t.Errorf("err = %q; it should say something about division by zero", err)
	}
}

// A deferred CLOSURE sees the variable's final value. A deferred CALL evaluates its arguments
// immediately. Both are useful; confusing them is a bug.
func TestDeferArgumentsVsClosures(t *testing.T) {
	if got := LogValue(); got != 2 {
		t.Errorf("LogValue = %d, want 2 — a deferred closure reads x when it RUNS, at function exit", got)
	}
}

func TestCleanupHappensBeforeReturn(t *testing.T) {
	var open, closed int
	opener := func(int) func() {
		open++
		return func() { closed++ }
	}

	total := SumWithCleanup(100, opener)

	if total != 4950 {
		t.Errorf("total = %d, want 4950", total)
	}
	if open != 100 {
		t.Fatalf("opened %d resources, want 100", open)
	}
	if closed != 100 {
		t.Errorf("closed %d of %d resources by the time the function returned — "+
			"a defer inside a loop holds every one of them open until the function exits", closed, open)
	}
}

func TestSumWithCleanupClosesEachBeforeTheNextOpens(t *testing.T) {
	var live, peak int
	opener := func(int) func() {
		live++
		if live > peak {
			peak = live
		}
		return func() { live-- }
	}

	SumWithCleanup(1000, opener)

	if peak > 1 {
		t.Errorf("peak concurrently-open resources = %d, want 1 — with 1,000 rows that is "+
			"1,000 open file handles, and your process has a limit", peak)
	}
}

func TestGuardCatchesEveryKindOfPanic(t *testing.T) {
	cases := []struct {
		name  string
		fn    func()
		match string
	}{
		{"no panic", func() {}, ""},
		{"panic with a string", func() { panic("boom") }, "boom"},
		{"panic with an int", func() { panic(42) }, "42"},
		{"panic with an error", func() { panic(errors.New("wrapped")) }, "wrapped"},
		{"runtime panic", func() { var m map[string]int; m["x"] = 1 }, "map"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := Guard(tc.fn)
			if tc.match == "" {
				if err != nil {
					t.Errorf("Guard returned %v for a function that did not panic", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("Guard returned nil; the panic escaped")
			}
			if !strings.Contains(err.Error(), tc.match) {
				t.Errorf("err = %q, want it to contain %q", err, tc.match)
			}
		})
	}
}

func TestGuardPreservesTheOriginalError(t *testing.T) {
	err := Guard(func() { panic(ErrExpected) })
	if !errors.Is(err, ErrExpected) {
		t.Errorf("errors.Is(err, ErrExpected) = false; a panic carrying an error should stay "+
			"inspectable. got %v", err)
	}
}

func TestRetrySurvivesAPanickingAttempt(t *testing.T) {
	calls := 0
	err := Retry(3, func(attempt int) error {
		calls++
		if attempt < 2 {
			panic("attempt exploded")
		}
		return nil
	})
	if err != nil {
		t.Errorf("Retry = %v, want nil — the third attempt succeeded", err)
	}
	if calls != 3 {
		t.Errorf("fn called %d times, want 3", calls)
	}
}

func TestRetryReportsTheLastFailure(t *testing.T) {
	err := Retry(2, func(int) error { return ErrExpected })
	if !errors.Is(err, ErrExpected) {
		t.Errorf("Retry did not wrap the last error: %v", err)
	}
}
