package drill02

import (
	"errors"
	"strings"
	"testing"
)

func TestSentinelSurvivesWrapping(t *testing.T) {
	_, err := LoadUser(99)
	if err == nil {
		t.Fatal("expected an error for a missing user")
	}
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("errors.Is(err, ErrNotFound) = false; the sentinel did not survive the trip.\n"+
			"  got: %v\n  (%%v formats the error into a string and throws the value away)", err)
	}
}

func TestContextIsStillAdded(t *testing.T) {
	_, err := LoadUser(99)
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "99") {
		t.Errorf("the error message lost the id: %q — wrapping should ADD context, not replace it", err)
	}
}

func TestTypedErrorSurvivesWrapping(t *testing.T) {
	_, err := LoadUser(-1)
	if err == nil {
		t.Fatal("expected a validation error")
	}
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("errors.As could not find the *ValidationError in %v", err)
	}
	if ve.Field != "id" {
		t.Errorf("Field = %q, want %q", ve.Field, "id")
	}
}

func TestHandlerMapsErrorsToStatusCodes(t *testing.T) {
	for _, tc := range []struct {
		name string
		id   int
		want int
	}{
		{"found", 1, 200},
		{"missing", 99, 404},
		{"invalid", -1, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := Handler(tc.id); got != tc.want {
				t.Errorf("Handler(%d) = %d, want %d", tc.id, got, tc.want)
			}
		})
	}
}

func TestFieldOfDigsThroughTheChain(t *testing.T) {
	_, err := LoadUser(-5)
	if got := FieldOf(err); got != "id" {
		t.Errorf("FieldOf = %q, want %q", got, "id")
	}
	if got := FieldOf(ErrNotFound); got != "" {
		t.Errorf("FieldOf(ErrNotFound) = %q, want \"\"", got)
	}
	if got := FieldOf(nil); got != "" {
		t.Errorf("FieldOf(nil) = %q, want \"\"", got)
	}
}

func TestCheckAllReportsEveryProblem(t *testing.T) {
	err := CheckAll("", "")
	if err == nil {
		t.Fatal("expected errors for both empty fields")
	}

	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("errors.As found no *ValidationError in %v", err)
	}

	msg := err.Error()
	if !strings.Contains(msg, "name") || !strings.Contains(msg, "email") {
		t.Errorf("only some problems were reported: %q — the caller has to submit twice", msg)
	}

	if err := CheckAll("ada", "ada@example.com"); err != nil {
		t.Errorf("CheckAll on valid input returned %v", err)
	}
}

// A wrapped error must not accidentally match an unrelated sentinel.
func TestIsDoesNotOverMatch(t *testing.T) {
	other := errors.New("something else")
	_, err := LoadUser(99)
	if errors.Is(err, other) {
		t.Errorf("errors.Is matched an unrelated sentinel")
	}
}
