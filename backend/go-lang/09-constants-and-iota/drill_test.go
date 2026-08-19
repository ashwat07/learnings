package drill09

import (
	"encoding/json"
	"testing"
)

func TestZeroValueIsMeaningful(t *testing.T) {
	var s Status // this is what an unset struct field, a fresh map value, and a failed decode give you

	if s.String() != "unknown" {
		t.Errorf("the zero Status prints as %q, want %q — a value nobody chose must be "+
			"distinguishable from one somebody did", s.String(), "unknown")
	}
	if s.Valid() {
		t.Errorf("the zero Status reports itself as valid, so a struct that was never populated " +
			"passes validation")
	}
}

func TestStatusStrings(t *testing.T) {
	for _, tc := range []struct {
		s    Status
		want string
	}{
		{StatusPending, "pending"},
		{StatusActive, "active"},
		{StatusClosed, "closed"},
		{Status(99), "Status(99)"},
	} {
		if got := tc.s.String(); got != tc.want {
			t.Errorf("Status(%d).String() = %q, want %q", int(tc.s), got, tc.want)
		}
	}
}

func TestStatusRoundTripsThroughItsName(t *testing.T) {
	for _, s := range []Status{StatusPending, StatusActive, StatusClosed} {
		got, err := ParseStatus(s.String())
		if err != nil {
			t.Errorf("ParseStatus(%q): %v", s.String(), err)
			continue
		}
		if got != s {
			t.Errorf("ParseStatus(%q) = %v, want %v", s.String(), got, s)
		}
	}
	if _, err := ParseStatus("nonsense"); err == nil {
		t.Errorf("ParseStatus(\"nonsense\") returned no error")
	}
}

func TestStatusValid(t *testing.T) {
	for _, s := range []Status{StatusPending, StatusActive, StatusClosed} {
		if !s.Valid() {
			t.Errorf("%v should be valid", s)
		}
	}
	for _, s := range []Status{Status(0), Status(-1), Status(47)} {
		if s.Valid() {
			t.Errorf("Status(%d) should not be valid", int(s))
		}
	}
}

func TestStatusJSONUsesTheName(t *testing.T) {
	b, err := json.Marshal(struct{ S Status }{StatusActive})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != `{"S":"active"}` {
		t.Errorf("marshalled to %s, want {\"S\":\"active\"} — serialising the NUMBER couples your "+
			"wire format to declaration order, so inserting a constant silently rewrites history", b)
	}

	var back struct{ S Status }
	if err := json.Unmarshal([]byte(`{"S":"closed"}`), &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back.S != StatusClosed {
		t.Errorf("unmarshalled to %v, want %v", back.S, StatusClosed)
	}

	if err := json.Unmarshal([]byte(`{"S":"banana"}`), &back); err == nil {
		t.Errorf("an unknown status decoded without an error")
	}
}

func TestPermIsABitSet(t *testing.T) {
	rw := PermRead.Add(PermWrite)

	if !rw.Has(PermRead) || !rw.Has(PermWrite) {
		t.Fatalf("read|write = %d, but Has() cannot see its members — these are BITS, not values", uint8(rw))
	}
	if rw.Has(PermExecute) {
		t.Errorf("read|write reports that it has execute")
	}
	if got := rw.Sub(PermWrite); got != PermRead {
		t.Errorf("(read|write) - write = %d, want %d", uint8(got), uint8(PermRead))
	}

	// Each constant must be a distinct POWER OF TWO, or none of the above can work.
	for _, p := range []Perm{PermRead, PermWrite, PermExecute} {
		if uint8(p)&(uint8(p)-1) != 0 {
			t.Errorf("Perm(%d) is not a power of two, so it overlaps another flag", uint8(p))
		}
	}
	all := PermRead.Add(PermWrite).Add(PermExecute)
	if uint8(all) != 7 {
		t.Errorf("read|write|execute = %d, want 7", uint8(all))
	}
}

func TestPermString(t *testing.T) {
	for _, tc := range []struct {
		p    Perm
		want string
	}{
		{0, "---"},
		{PermRead, "r--"},
		{PermRead.Add(PermExecute), "r-x"},
		{PermRead.Add(PermWrite).Add(PermExecute), "rwx"},
		{PermWrite, "-w-"},
	} {
		if got := tc.p.String(); got != tc.want {
			t.Errorf("Perm(%d).String() = %q, want %q", uint8(tc.p), got, tc.want)
		}
	}
}

// Untyped constants adapt to their context. A `const KB int = 1024` does not: it is an int, and
// every use as a float64 or an int64 needs a conversion.
func TestSizesAreUntyped(t *testing.T) {
	var asInt64 int64 = GB
	var asFloat float64 = MB
	var asUint uint = KB

	if asInt64 != 1073741824 || asFloat != 1048576 || asUint != 1024 {
		t.Errorf("got %d, %v, %d", asInt64, asFloat, asUint)
	}

	// The payoff: no conversions at the call site.
	if ratio := float64(asInt64) / MB; ratio != 1024 {
		t.Errorf("GB/MB = %v, want 1024", ratio)
	}
}
