package drill06

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func marshal(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func TestFieldNamesAreLowerCamel(t *testing.T) {
	got := marshal(t, Product{ID: 1, Name: "x", CreatedAt: time.Unix(0, 0).UTC()})
	for _, want := range []string{`"id"`, `"name"`, `"createdAt"`} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in %s — Go exports capitalised, JSON APIs do not", want, got)
		}
	}
	if strings.Contains(got, `"ID"`) || strings.Contains(got, `"Name"`) {
		t.Errorf("Go field names leaked into the JSON: %s", got)
	}
}

func TestInternalIsNeverSerialised(t *testing.T) {
	got := marshal(t, Product{Internal: "secret", CreatedAt: time.Unix(0, 0).UTC()})
	if strings.Contains(got, "secret") || strings.Contains(strings.ToLower(got), "internal") {
		t.Errorf("Internal leaked into the JSON: %s", got)
	}
}

func TestOptionalFieldIsOmittedWhenEmpty(t *testing.T) {
	got := marshal(t, Product{CreatedAt: time.Unix(0, 0).UTC()})
	if strings.Contains(got, "description") {
		t.Errorf("empty Description should be absent, got %s", got)
	}
	got = marshal(t, Product{Description: "hi", CreatedAt: time.Unix(0, 0).UTC()})
	if !strings.Contains(got, `"description":"hi"`) {
		t.Errorf("non-empty Description missing from %s", got)
	}
}

func TestMoneyIsAStringWithTwoDecimals(t *testing.T) {
	got := marshal(t, Product{Price: 1234, CreatedAt: time.Unix(0, 0).UTC()})
	if !strings.Contains(got, `"price":"12.34"`) {
		t.Errorf(`want "price":"12.34" in %s`, got)
	}
	got = marshal(t, Product{Price: 5, CreatedAt: time.Unix(0, 0).UTC()})
	if !strings.Contains(got, `"price":"0.05"`) {
		t.Errorf(`want "price":"0.05" in %s`, got)
	}

	var p Product
	if err := json.Unmarshal([]byte(`{"price":"99.99"}`), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.Price != 9999 {
		t.Errorf("Price = %d cents, want 9999", p.Price)
	}
}

// Absent, null, and zero are three different things, and an API that cannot tell them apart
// cannot express "clear this field".
func TestDiscountDistinguishesAbsentNullAndZero(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string // "absent", "null", or the number
	}{
		{"absent", `{}`, "absent"},
		{"explicit null", `{"discount":null}`, "absent"},
		{"zero", `{"discount":0}`, "0"},
		{"value", `{"discount":15}`, "15"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var p Product
			if err := json.Unmarshal([]byte(tc.input), &p); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			got := "absent"
			if p.Discount != nil {
				got = string(rune('0' + *p.Discount%10))
				if *p.Discount == 15 {
					got = "15"
				}
			}
			if got != tc.want {
				t.Errorf("Discount from %s = %s, want %s — a non-pointer int cannot tell 0 from missing",
					tc.input, got, tc.want)
			}
		})
	}
}

func TestEmptySliceIsNotNull(t *testing.T) {
	p := Product{CreatedAt: time.Unix(0, 0).UTC()}
	Normalise(&p)
	got := marshal(t, p)
	if strings.Contains(got, `"tags":null`) {
		t.Errorf(`got "tags":null — a nil slice marshals to null, and clients have to null-check: %s`, got)
	}
	if !strings.Contains(got, `"tags":[]`) {
		t.Errorf(`want "tags":[] in %s`, got)
	}
}

func TestTimestampIsRFC3339UTC(t *testing.T) {
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Skip("no tzdata")
	}
	p := Product{CreatedAt: time.Date(2026, 3, 4, 12, 0, 0, 0, tokyo)}
	Normalise(&p)
	got := marshal(t, p)
	if !strings.Contains(got, `"createdAt":"2026-03-04T03:00:00Z"`) {
		t.Errorf("want the UTC instant in RFC3339, got %s", got)
	}
}

func TestStockAcceptsANumberOrAString(t *testing.T) {
	for _, in := range []string{`{"stock":7}`, `{"stock":"7"}`} {
		var p Product
		if err := json.Unmarshal([]byte(in), &p); err != nil {
			t.Fatalf("unmarshal %s: %v", in, err)
		}
		if p.Stock != 7 {
			t.Errorf("Stock from %s = %d, want 7", in, p.Stock)
		}
	}
}

func TestSameInstantIgnoresLocationAndMonotonic(t *testing.T) {
	now := time.Now() // carries a monotonic reading
	roundTripped, _ := time.Parse(time.RFC3339Nano, now.Format(time.RFC3339Nano))

	if !SameInstant(now, roundTripped) {
		t.Errorf("a time and its own RFC3339Nano round trip are not the same instant.\n" +
			"  time.Now() carries a monotonic clock reading; parsing does not. == compares it.")
	}

	utc := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	nyc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tzdata")
	}
	same := time.Date(2026, 1, 1, 7, 0, 0, 0, nyc)
	if !SameInstant(utc, same) {
		t.Errorf("the same instant in two locations should compare equal")
	}
	if SameInstant(utc, utc.Add(time.Nanosecond)) {
		t.Errorf("different instants should not compare equal")
	}
}

func TestParseFlexible(t *testing.T) {
	want := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
	for _, in := range []string{"2026-03-04T05:06:07Z", "2026-03-04T05:06:07.000000000Z", "1772600767"} {
		got, err := ParseFlexible(in)
		if err != nil {
			t.Errorf("ParseFlexible(%q): %v", in, err)
			continue
		}
		if !got.Equal(want) {
			t.Errorf("ParseFlexible(%q) = %v, want %v", in, got, want)
		}
		if got.Location() != time.UTC {
			t.Errorf("ParseFlexible(%q) returned location %v, want UTC", in, got.Location())
		}
	}
	if _, err := ParseFlexible("not a time"); err == nil {
		t.Errorf("ParseFlexible on garbage returned no error")
	}
}

func TestStrictDecodeRejectsUnknownFields(t *testing.T) {
	var p Product
	if err := StrictDecode([]byte(`{"name":"ok"}`), &p); err != nil {
		t.Errorf("valid input rejected: %v", err)
	}
	err := StrictDecode([]byte(`{"nmae":"typo"}`), &p)
	if err == nil {
		t.Errorf("a misspelled field was silently ignored — the client thinks it set a name and it did not")
	}
}
