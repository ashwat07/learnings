// Package drill02 — errors are values, and the value has to survive the trip.
//
//	cd backend/go-lang && go test ./02-errors/
//
// Go has no exceptions, so an error's journey from where it happened to where it is handled is
// something you write by hand. Every link in that chain can lose information, and the two ways
// to lose it are: formatting the error into a string, and returning a new one that has forgotten
// the old.
//
// The tests below are all written from the CALLER's point of view: can the caller still find out
// what actually went wrong, three layers up?
package drill02

import (
	"errors"
	"fmt"
)

// ErrNotFound is a SENTINEL: a single value callers compare against. Use one when there is
// nothing to say beyond "this specific thing happened".
var ErrNotFound = errors.New("not found")

// ValidationError is a TYPED error: it carries data the caller needs.
type ValidationError struct {
	Field  string
	Reason string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("invalid %s: %s", e.Field, e.Reason)
}

var users = map[int]string{1: "ada", 2: "grace"}

// fetch is the bottom of the stack.
func fetch(id int) (string, error) {
	if id <= 0 {
		return "", &ValidationError{Field: "id", Reason: "must be positive"}
	}
	name, ok := users[id]
	if !ok {
		return "", ErrNotFound
	}
	return name, nil
}

// LoadUser is the middle of the stack: it adds context. It currently adds context by building a
// brand new error out of the old one's text, which reads fine in a log and is useless to code.
func LoadUser(id int) (string, error) {
	name, err := fetch(id)
	if err != nil {
		return "", fmt.Errorf("load user %d: %v", id, err)
	}
	return name, nil
}

// Handler is the top of the stack: it decides what the failure MEANS.
// Return 404 for a missing user, 400 for a validation failure, 500 for anything else.
func Handler(id int) int {
	_, err := LoadUser(id)
	if err != nil {
		return 500
	}
	return 200
}

// FieldOf returns the field name from a validation failure anywhere in the chain, or "" if the
// error was not a validation failure.
func FieldOf(err error) string {
	return ""
}

// CheckAll validates every field and reports ALL the problems, not just the first one.
// A form that makes the user fix one field per round trip is a form nobody finishes.
func CheckAll(name, email string) error {
	if name == "" {
		return &ValidationError{Field: "name", Reason: "required"}
	}
	if email == "" {
		return &ValidationError{Field: "email", Reason: "required"}
	}
	return nil
}
