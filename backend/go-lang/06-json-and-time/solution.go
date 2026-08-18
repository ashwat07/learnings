// Package drill06 — encoding/json and time: the two standard-library packages that leak into
// every API you will ever ship.
//
//	cd backend/go-lang && go test ./06-json-and-time/
//
// JSON in Go is reflection over struct tags, and the defaults are almost never what an API
// contract wants: a missing field and a zero field look identical, omitempty drops legitimate
// zeros, a nil slice becomes null, and a float64 will happily mangle your money.
//
// time.Time carries a monotonic reading that survives comparison but not serialisation, which is
// why == on two "equal" timestamps returns false.
package drill06

import (
	"encoding/json"
	"time"
)

// Money is an amount in CENTS. Never a float: 0.1 + 0.2 != 0.3 in binary floating point, and an
// invoice that is off by a cent is a support ticket.
//
// It must marshal as a JSON STRING with two decimals ("12.34") and unmarshal back exactly.
type Money int64

// Product is what goes over the wire.
type Product struct {
	ID   int
	Name string
	// Description is genuinely optional: absent from the JSON entirely when empty.
	Description string
	// Price must serialise via Money's rules.
	Price Money
	// Discount distinguishes THREE states: absent, explicit null, and a real value including 0.
	Discount *int
	// Tags must serialise as [] when empty, never null — a client doing tags.map() should not
	// have to null-check.
	Tags []string
	// Internal must never be serialised.
	Internal string
	// CreatedAt must be RFC3339 in UTC.
	CreatedAt time.Time
	// Stock arrives from clients as either a number or a numeric string; both must parse.
	// (The `,string` tag is not enough here. Find out why before you reach for it.)
	Stock int
}

func (m Money) MarshalJSON() ([]byte, error) {
	return json.Marshal(int64(m))
}

func (m *Money) UnmarshalJSON(b []byte) error {
	var n int64
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	*m = Money(n)
	return nil
}

// Normalise prepares a Product for serialisation: UTC timestamps, no nil slices.
func Normalise(p *Product) {}

// SameInstant reports whether two times refer to the same moment, regardless of location and of
// whether either one has a monotonic reading attached.
func SameInstant(a, b time.Time) bool {
	return a == b
}

// ParseFlexible parses a timestamp that may arrive as RFC3339, RFC3339 with nanoseconds, or a
// Unix seconds integer. Always return UTC.
func ParseFlexible(s string) (time.Time, error) {
	return time.Parse(time.RFC3339, s)
}

// StrictDecode rejects unknown fields, so a client typo is an error instead of silently ignored
// data. This is the single highest-value two lines in most Go HTTP handlers.
func StrictDecode(data []byte, v any) error {
	return json.Unmarshal(data, v)
}
