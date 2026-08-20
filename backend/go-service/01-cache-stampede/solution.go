// Package drill01 — cache stampede, in a language where the cache is genuinely shared.
//
//	cd backend/go-service && go test -race ./01-cache-stampede/
//
// The JavaScript version of this drill (caching-and-queues drill 01) is about the event loop:
// two requests interleave at an await and both miss. Go's version is harder, because the cache is
// touched by real threads — so on top of the stampede you have a data race, and the naive fix for
// the race (one mutex, held across the load) creates a worse problem than the one it solved.
//
// Build a cache that is:
//
//	CORRECT      under -race, with hundreds of goroutines
//	COLLAPSING   N concurrent misses for the SAME key cause ONE load
//	CONCURRENT   misses for DIFFERENT keys do not queue behind each other
//	BOUNDED      by entry count, with LRU eviction
//	EXPIRING     by TTL
//
// The version below is what a careful person writes first. It is race-free and it is wrong: the
// mutex is held across load(), so every miss in the process serialises behind every other miss.
// One slow key makes the whole cache slow, which is the opposite of what a cache is for.
package drill01

import (
	"context"
	"sync"
	"time"
)

type Stats struct {
	Hits   int64
	Misses int64
	Loads  int64 // how many times load() was actually called
}

type entry struct {
	value     string
	expiresAt time.Time
}

type Cache struct {
	mu       sync.Mutex
	items    map[string]entry
	capacity int
	ttl      time.Duration
	load     func(ctx context.Context, key string) (string, error)

	hits, misses, loads int64
}

func New(capacity int, ttl time.Duration, load func(ctx context.Context, key string) (string, error)) *Cache {
	return &Cache{
		items:    make(map[string]entry, capacity),
		capacity: capacity,
		ttl:      ttl,
		load:     load,
	}
}

func (c *Cache) Get(ctx context.Context, key string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock() // <- held across the load. Every miss in the process now waits here.

	if e, ok := c.items[key]; ok && time.Now().Before(e.expiresAt) {
		c.hits++
		return e.value, nil
	}
	c.misses++
	c.loads++

	v, err := c.load(ctx, key)
	if err != nil {
		return "", err
	}
	c.items[key] = entry{value: v, expiresAt: time.Now().Add(c.ttl)}
	return v, nil
}

func (c *Cache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

func (c *Cache) Stats() Stats {
	c.mu.Lock()
	defer c.mu.Unlock()
	return Stats{Hits: c.hits, Misses: c.misses, Loads: c.loads}
}
