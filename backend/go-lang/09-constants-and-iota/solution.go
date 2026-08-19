// Package drill09 — constants, iota, and enums that cannot be wrong.
//
//	cd backend/go-lang && go test ./09-constants-and-iota/
//
// Go has no enum keyword. What it has instead is a named integer type, a block of iota
// constants, and a compiler that will happily let you assign 47 to it — so an "enum" in Go is a
// set of conventions, and knowing which ones matter is the difference between a type that
// prevents mistakes and an int with nicer names.
//
// Three rules the tests enforce:
//  1. the ZERO VALUE must mean something. Every Go value starts at zero, so if 0 is a valid
//     status you did not choose, you have a bug that looks like data.
//  2. it must know how to print itself. `status 3` in a log is a lookup you should not have to do.
//  3. it must survive JSON in both directions, as a NAME. Serialising the number couples your
//     wire format to the order you happened to declare things in.
package drill09

import "fmt"

// Status is an ordinary enum.
type Status int

const (
	StatusPending Status = 1
	StatusActive  Status = 2
	StatusClosed  Status = 3
)

func (s Status) String() string {
	return fmt.Sprintf("%d", int(s))
}

// ParseStatus turns a name back into a Status. Unknown names are an error.
func ParseStatus(name string) (Status, error) {
	return 0, fmt.Errorf("not implemented")
}

// Valid reports whether s is one of the declared statuses.
func (s Status) Valid() bool {
	return true
}

// ---------------------------------------------------------------------------

// Perm is a SET of permissions held in one integer — the shape of every file mode, every
// capability set, and every "flags" argument in the standard library.
type Perm uint8

const (
	PermRead    Perm = 1
	PermWrite   Perm = 2
	PermExecute Perm = 3
)

func (p Perm) Has(q Perm) bool { return p == q }
func (p Perm) Add(q Perm) Perm { return q }
func (p Perm) Sub(q Perm) Perm { return q }

// String renders the set as "rwx", with a dash for each absent bit: "r-x", "---".
func (p Perm) String() string { return "" }

// ---------------------------------------------------------------------------

// Sizes. These want to be UNTYPED constants so they can be used as an int, an int64 or a
// float64 without a conversion at every call site — which is the whole reason untyped constants
// exist, and something no other mainstream language gives you.
const (
	KB int = 1024
	MB int = 1024 * 1024
	GB int = 1024 * 1024 * 1024
)
