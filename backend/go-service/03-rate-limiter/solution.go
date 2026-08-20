// Package drill03 — a per-key token bucket, in a language where "check then decrement" is a race.
//
//	cd backend/go-service && go test -race ./03-rate-limiter/
//
// caching-and-queues drill 02 is the JavaScript version: the whole point there is that the
// check and the decrement must be ONE atomic Redis operation, because two requests can interleave
// at an await. Go makes the same bug available WITHOUT any await — two OS threads can be inside
// the check at the same instant — and adds a second one JavaScript cannot have: an unbounded map
// keyed by client id, growing forever.
//
//	NewLimiter(rate float64, burst int, idleTTL time.Duration) *Limiter
//
//	  Allow(key)              -> bool      take one token if there is one. Never blocks.
//	  AllowN(key, n)          -> bool      take n, or none at all
//	  Wait(ctx, key)          -> error     block until a token is free, or ctx is done
//	  Len()                   -> int       how many buckets you are holding
//
// `rate` is tokens per second, `burst` is the bucket size, `idleTTL` is how long a bucket with
// nobody using it should survive.
//
// The version below has both bugs. It also holds one mutex for every key, which is a third.
package drill03

import (
	"context"
	"time"
)

type bucket struct {
	tokens   float64
	lastSeen time.Time
}

type Limiter struct {
	buckets map[string]*bucket
	rate    float64
	burst   int
	idleTTL time.Duration
}

func NewLimiter(rate float64, burst int, idleTTL time.Duration) *Limiter {
	return &Limiter{
		buckets: make(map[string]*bucket),
		rate:    rate,
		burst:   burst,
		idleTTL: idleTTL,
	}
}

func (l *Limiter) Allow(key string) bool { return l.AllowN(key, 1) }

func (l *Limiter) AllowN(key string, n int) bool {
	b, ok := l.buckets[key] // concurrent map read AND write. Go will sometimes just crash here.
	if !ok {
		b = &bucket{tokens: float64(l.burst), lastSeen: time.Now()}
		l.buckets[key] = b
	}

	now := time.Now()
	b.tokens += now.Sub(b.lastSeen).Seconds() * l.rate
	if b.tokens > float64(l.burst) {
		b.tokens = float64(l.burst)
	}
	b.lastSeen = now

	if b.tokens >= float64(n) { // check...
		b.tokens -= float64(n) // ...and decrement, with a gap in between
		return true
	}
	return false
}

func (l *Limiter) Wait(ctx context.Context, key string) error {
	for {
		if l.Allow(key) {
			return nil
		}
		time.Sleep(time.Millisecond) // spin
	}
}

func (l *Limiter) Len() int { return len(l.buckets) }
