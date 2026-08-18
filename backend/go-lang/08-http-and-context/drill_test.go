package drill08

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestContextKeyIsNotAString(t *testing.T) {
	ctx := WithRequestID(context.Background(), "abc")

	if got := RequestID(ctx); got != "abc" {
		t.Fatalf("RequestID = %q, want %q", got, "abc")
	}
	if got := RequestID(context.Background()); got != "" {
		t.Errorf("RequestID of a bare context = %q, want \"\"", got)
	}

	// Another package, using the obvious string key, must not be able to see or clobber it.
	polluted := context.WithValue(ctx, "requestID", "hijacked")
	if got := RequestID(polluted); got != "abc" {
		t.Errorf("RequestID = %q after another package set the string key \"requestID\" — "+
			"your key type collides with everyone else's", got)
	}
	if ctx.Value("requestID") != nil {
		t.Errorf("the value is readable with a plain string key, so any package can read or " +
			"overwrite it — use an unexported key type")
	}
}

func TestChainRunsMiddlewareInOrder(t *testing.T) {
	var order []string
	mw := func(name string) Middleware {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				order = append(order, name+" in")
				next.ServeHTTP(w, r)
				order = append(order, name+" out")
			})
		}
	}
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { order = append(order, "handler") })

	Chain(h, mw("a"), mw("b"), mw("c")).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))

	want := []string{"a in", "b in", "c in", "handler", "c out", "b out", "a out"}
	if !reflect.DeepEqual(order, want) {
		t.Errorf("order = %v\nwant   %v", order, want)
	}
}

func TestRequestIDMiddleware(t *testing.T) {
	var seen string
	h := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = RequestID(r.Context()) }),
		RequestIDMiddleware(func() string { return "generated-1" }),
	)

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Request-Id", "from-client")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if seen != "from-client" {
		t.Errorf("handler saw request id %q, want %q — the incoming header should win so a trace "+
			"survives across services", seen, "from-client")
	}
	if got := rec.Header().Get("X-Request-Id"); got != "from-client" {
		t.Errorf("response X-Request-Id = %q, want it echoed back", got)
	}

	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest("GET", "/", nil))
	if seen != "generated-1" {
		t.Errorf("with no incoming header the handler saw %q, want the generated id", seen)
	}
}

func TestObserveMiddlewareSeesTheRealStatus(t *testing.T) {
	var gotStatus, gotBytes int
	h := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTeapot)
			w.Write([]byte("short and stout"))
		}),
		ObserveMiddleware(func(status, bytes int) { gotStatus, gotBytes = status, bytes }),
	)
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))

	if gotStatus != http.StatusTeapot {
		t.Errorf("observed status %d, want 418 — http.ResponseWriter does not expose it, so you "+
			"have to wrap it", gotStatus)
	}
	if gotBytes != len("short and stout") {
		t.Errorf("observed %d bytes, want %d", gotBytes, len("short and stout"))
	}
}

func TestObserveMiddlewareDefaultsTo200(t *testing.T) {
	var gotStatus int
	h := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) }),
		ObserveMiddleware(func(status, bytes int) { gotStatus = status }),
	)
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	if gotStatus != 200 {
		t.Errorf("observed status %d for a handler that never called WriteHeader, want 200", gotStatus)
	}
}

func TestRecoverMiddleware(t *testing.T) {
	var recovered any
	h := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic("handler exploded") }),
		RecoverMiddleware(func(v any) { recovered = v }),
	)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))

	if recovered == nil {
		t.Fatalf("the panic was not recovered")
	}
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "exploded") {
		t.Errorf("the panic value leaked into the response body: %q", rec.Body.String())
	}
}

func TestFetchHonoursTheDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	slow := func(ctx context.Context) (string, error) {
		time.Sleep(2 * time.Second) // a dependency that ignores its context
		return "too late", nil
	}

	start := time.Now()
	_, err := Fetch(ctx, slow)
	elapsed := time.Since(start)

	if elapsed > 500*time.Millisecond {
		t.Errorf("Fetch took %v; it should give up when the context does", elapsed)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("err = %v, want context.DeadlineExceeded", err)
	}
}

func TestFetchReturnsPromptlyOnSuccess(t *testing.T) {
	ctx := context.Background()
	got, err := Fetch(ctx, func(context.Context) (string, error) { return "fast", nil })
	if got != "fast" || err != nil {
		t.Errorf("Fetch = %q, %v; want \"fast\", nil", got, err)
	}
}

func TestFetchAllIsConcurrentAndOrdered(t *testing.T) {
	ids := []int{1, 2, 3, 4, 5}
	fetch := func(ctx context.Context, id int) (string, error) {
		select {
		case <-time.After(80 * time.Millisecond):
			return string(rune('a' + id - 1)), nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}

	start := time.Now()
	got, err := FetchAll(context.Background(), ids, time.Second, fetch)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("FetchAll: %v", err)
	}
	if !reflect.DeepEqual(got, []string{"a", "b", "c", "d", "e"}) {
		t.Errorf("FetchAll = %v, want [a b c d e] in the order the ids were given", got)
	}
	if elapsed > 250*time.Millisecond {
		t.Errorf("FetchAll took %v for 5 x 80ms — that is sequential, not concurrent", elapsed)
	}
}

func TestFetchAllAppliesAPerCallBudget(t *testing.T) {
	fetch := func(ctx context.Context, id int) (string, error) {
		d := 10 * time.Millisecond
		if id == 3 {
			d = 5 * time.Second // one bad shard
		}
		select {
		case <-time.After(d):
			return "ok", nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}

	start := time.Now()
	_, err := FetchAll(context.Background(), []int{1, 2, 3, 4}, 60*time.Millisecond, fetch)
	elapsed := time.Since(start)

	if elapsed > 500*time.Millisecond {
		t.Errorf("FetchAll took %v; the per-call budget of 60ms was not applied", elapsed)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("err = %v, want context.DeadlineExceeded from the slow id", err)
	}
}
