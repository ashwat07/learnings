package drill03

import (
	"errors"
	"reflect"
	"testing"
)

func TestLookupSuccessReturnsNilError(t *testing.T) {
	name, err := Lookup(1)
	if name != "ada" {
		t.Errorf("name = %q, want %q", name, "ada")
	}
	if err != nil {
		t.Errorf("err != nil on the SUCCESS path.\n"+
			"  err = %v (type %T)\n"+
			"  This is the typed-nil trap: the interface holds a type and a nil pointer,\n"+
			"  so it is not equal to nil even though nothing went wrong.", err, err)
	}
}

func TestLookupFailureReturnsAUsableError(t *testing.T) {
	_, err := Lookup(42)
	if err == nil {
		t.Fatal("expected an error for a missing id")
	}
	var nf *NotFoundError
	if !errors.As(err, &nf) || nf.ID != 42 {
		t.Errorf("errors.As did not recover a *NotFoundError{ID:42} from %v", err)
	}
}

func TestProcessDoesNotInventFailures(t *testing.T) {
	if got := Process(1); got != "ok: ada" {
		t.Errorf("Process(1) = %q, want %q", got, "ok: ada")
	}
	if got := Process(42); got != "error: id 42 not found" {
		t.Errorf("Process(42) = %q, want %q", got, "error: id 42 not found")
	}
}

func TestFirstErrorIgnoresTypedNils(t *testing.T) {
	var typedNil *NotFoundError
	real := errors.New("a real problem")

	got := FirstError([]error{nil, typedNil, real})
	if got != real {
		t.Errorf("FirstError = %v, want the real error.\n"+
			"  A (*NotFoundError)(nil) in an []error is not == nil, so a plain check picks it up\n"+
			"  and the caller gets an error whose Error() method will panic on a nil receiver.", got)
	}

	if got := FirstError([]error{nil, typedNil}); got != nil {
		t.Errorf("FirstError with only nils = %v (type %T), want nil", got, got)
	}
}

func TestIsReallyNil(t *testing.T) {
	var typedNil *NotFoundError
	var iface error = typedNil

	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"untyped nil", nil, true},
		{"typed nil pointer in an interface", iface, true},
		{"a real error", errors.New("x"), false},
		{"a non-nil typed error", &NotFoundError{ID: 1}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsReallyNil(tc.err); got != tc.want {
				t.Errorf("IsReallyNil(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// The mechanism, spelled out. Not a bug to fix — read it if a test above surprised you.
func TestTheMechanism(t *testing.T) {
	var p *NotFoundError
	var i error = p

	if p != nil {
		t.Error("the pointer itself IS nil")
	}
	if i == nil {
		t.Error("but the interface holding it is NOT nil — it holds (type=*NotFoundError, value=nil)")
	}
	if reflect.TypeOf(i) == nil {
		t.Error("the interface has a dynamic type, which is exactly why it is not nil")
	}
}
