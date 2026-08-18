// Package drill03 — the typed nil: Go's most expensive gotcha.
//
//	cd backend/go-lang && go test ./03-nil-interface/
//
// An interface value is TWO words: a type and a pointer. It is nil only when BOTH are nil. So a
// nil *MyError stored in an error interface is an interface holding (*MyError, nil) — which is
// not nil, compares != nil, and sends every `if err != nil` down the failure path on success.
//
// This is not trivia. It has caused real outages, it is invisible in review, and the compiler
// will not say a word.
package drill03

import "fmt"

type NotFoundError struct{ ID int }

func (e *NotFoundError) Error() string { return fmt.Sprintf("id %d not found", e.ID) }

var store = map[int]string{1: "ada"}

// Lookup returns the name for id, or an error.
//
// The bug is the declared return type of the local variable, not the return statement.
func Lookup(id int) (string, error) {
	var err *NotFoundError // <- concrete pointer type
	name, ok := store[id]
	if !ok {
		err = &NotFoundError{ID: id}
	}
	return name, err
}

// Process is the caller. It must not report a failure that did not happen.
func Process(id int) string {
	name, err := Lookup(id)
	if err != nil {
		return "error: " + err.Error()
	}
	return "ok: " + name
}

// FirstError returns the first non-nil error in errs, or nil.
// It must not be fooled by a typed nil that a careless caller put in the slice.
func FirstError(errs []error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}

// IsReallyNil reports whether err is nil in the way a caller MEANS it — no error happened —
// rather than in the way `== nil` answers it.
func IsReallyNil(err error) bool {
	return err == nil
}
