// Package drill03 — cancellation.
//
//	go test -race ./03-context-cancellation/
//
// FetchAll queries three slow backends and returns their results. The caller may give up — a
// request times out, a user navigates away — and when it does, every goroutine you started must
// stop and every resource must be released.
//
// The version below ignores ctx entirely. It "works": it returns the right answers. It also keeps
// working after nobody is listening, which is how a service under load ends up with ten thousand
// goroutines doing work for requests that were abandoned a minute ago.
package drill03

import (
	"context"
	"time"
)

// Fetch simulates a backend call. It takes `d` and does NOT know about cancellation — you must
// handle that around it.
func Fetch(ctx context.Context, name string, d time.Duration) (string, error) {
	select {
	case <-time.After(d):
		return name + ":ok", nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// FetchAll must:
//   - run the three fetches CONCURRENTLY (sequentially it cannot meet the deadline)
//   - return as soon as the context is cancelled, with ctx.Err()
//   - leave NO goroutine running once it returns
func FetchAll(ctx context.Context) ([]string, error) {
	var out []string
	for _, b := range []struct {
		name string
		d    time.Duration
	}{{"users", 60 * time.Millisecond}, {"orders", 80 * time.Millisecond}, {"prefs", 70 * time.Millisecond}} {
		// Sequential, and it never checks whether the caller is still there.
		r, err := Fetch(context.Background(), b.name, b.d)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}
