// Package drill08 — net/http and context: the two things every Go service is made of.
//
//	cd backend/go-lang && go test ./08-http-and-context/
//
// Go's http.Handler is one method, and everything else — routing, middleware, request-scoped
// data, timeouts, cancellation — is composition on top of it. There is no framework here, which
// means there is nothing to hide behind either.
//
// context.Context is the other half. It is not a bag for optional parameters; it is a
// CANCELLATION TREE that happens to also carry a few request-scoped values. Getting the
// difference right is most of what "idiomatic Go service code" means.
package drill08

import (
	"context"
	"net/http"
	"time"
)

// ---------------------------------------------------------------------------
// Request-scoped values.

// RequestIDKey is how the request id is stored in the context.
//
// A plain string key is a collision waiting to happen: every package that does
// ctx.Value("id") is reading and writing the SAME slot, including packages you did not write.
// The fix is a private type nobody else can construct.
const RequestIDKey = "requestID"

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, RequestIDKey, id)
}

// RequestID returns the id, or "" if there is none.
func RequestID(ctx context.Context) string {
	v := ctx.Value(RequestIDKey)
	s, _ := v.(string)
	return s
}

// ---------------------------------------------------------------------------
// Middleware.

// Middleware wraps a handler. This type — and the fact that http.Handler is a single method —
// is the entire "framework".
type Middleware func(http.Handler) http.Handler

// Chain composes middleware so that Chain(h, a, b, c) runs a, then b, then c, then h.
func Chain(h http.Handler, mw ...Middleware) http.Handler {
	return h
}

// Recorder captures the status code and byte count of a response, which http.ResponseWriter
// does not expose. Every access log and every metrics middleware needs this.
type Recorder struct {
	http.ResponseWriter
	Status int
	Bytes  int
}

func (r *Recorder) WriteHeader(code int) {
	r.ResponseWriter.WriteHeader(code)
}

// RequestIDMiddleware puts the X-Request-Id header (or a generated id) into the context and
// echoes it back on the response.
func RequestIDMiddleware(newID func() string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
		})
	}
}

// ObserveMiddleware records the status of every response into observe.
func ObserveMiddleware(observe func(status int, bytes int)) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
			observe(200, 0)
		})
	}
}

// RecoverMiddleware turns a panic in a handler into a 500 instead of a dead connection.
func RecoverMiddleware(onPanic func(any)) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
		})
	}
}

// ---------------------------------------------------------------------------
// Cancellation.

// Fetch calls slow(ctx) and must respect the context: if the deadline passes or the caller
// cancels, return promptly with the context's error rather than waiting for slow to finish.
func Fetch(ctx context.Context, slow func(context.Context) (string, error)) (string, error) {
	return slow(ctx)
}

// FetchAll fetches every id CONCURRENTLY, with a per-call budget of `each`. One slow id must not
// consume the whole caller's deadline, and results must come back in the order the ids were
// given.
func FetchAll(ctx context.Context, ids []int, each time.Duration, fetch func(context.Context, int) (string, error)) ([]string, error) {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		v, err := fetch(ctx, id)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}
