package drill12

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// The table-driven test: one slice, one loop, one subtest per case. Go's convention, and worth
// following for the reason that shows up when something breaks — `go test -run
// TestTruncate/multibyte_boundary` runs exactly one case, and the failure names itself.
func TestTruncate(t *testing.T) {
	tests := []struct {
		name string
		in   string
		n    int
		want string
	}{
		{"shorter than the limit", "hi", 10, "hi"},
		{"exactly the limit", "hello", 5, "hello"},
		{"plain ascii", "hello world", 5, "hello"},
		{"zero", "hello", 0, ""},
		{"empty input", "", 5, ""},
		{"negative n", "hello", -1, ""},
		{"multibyte boundary", "héllo", 2, "h"}, // é is 2 bytes: cutting at 2 would split it
		{"emoji boundary", "a🎉b", 3, "a"},       // 🎉 is 4 bytes
		{"whole emoji fits", "a🎉b", 5, "a🎉"},
		{"all multibyte", "日本語", 4, "日"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Truncate(tt.in, tt.n); got != tt.want {
				t.Errorf("Truncate(%q, %d) = %q, want %q", tt.in, tt.n, got, tt.want)
			}
		})
	}
}

func TestParseRange(t *testing.T) {
	ok := []struct {
		in     string
		lo, hi int
	}{
		{"3-9", 3, 9},
		{"7", 7, 7},
		{" 4 - 6 ", 4, 6},
		{"0-0", 0, 0},
	}
	for _, tt := range ok {
		t.Run(tt.in, func(t *testing.T) {
			lo, hi, err := ParseRange(tt.in)
			if err != nil {
				t.Fatalf("ParseRange(%q): %v", tt.in, err)
			}
			if lo != tt.lo || hi != tt.hi {
				t.Errorf("ParseRange(%q) = %d, %d; want %d, %d", tt.in, lo, hi, tt.lo, tt.hi)
			}
		})
	}

	bad := []string{"", "-", "abc", "3-", "-9", "3-9-12", "9-3", "3-abc", "   "}
	for _, in := range bad {
		t.Run("rejects "+in, func(t *testing.T) {
			if _, _, err := ParseRange(in); err == nil {
				t.Errorf("ParseRange(%q) returned no error", in)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// The fuzz tests. Run them:
//
//	go test -fuzz=FuzzTruncate -fuzztime=20s ./12-fuzzing/
//
// A failing input is written to testdata/fuzz/FuzzTruncate/ and becomes part of the normal test
// run from then on — so the regression test writes itself, and `go test` alone reproduces it
// forever after.

func FuzzTruncate(f *testing.F) {
	// The seed corpus. Fuzzing mutates these, so seeds that already reach interesting code paths
	// are worth far more than random ones.
	f.Add("hello", 3)
	f.Add("héllo", 2)
	f.Add("日本語", 4)
	f.Add("", 0)
	f.Add("a🎉b", 3)

	f.Fuzz(func(t *testing.T, s string, n int) {
		got := Truncate(s, n)

		// PROPERTY 1: never longer than the limit.
		if n >= 0 && len(got) > n {
			t.Fatalf("Truncate(%q, %d) = %q: %d bytes, limit was %d", s, n, got, len(got), n)
		}
		// PROPERTY 2: never longer than the input.
		if len(got) > len(s) {
			t.Fatalf("Truncate(%q, %d) = %q: longer than the input", s, n, got)
		}
		// PROPERTY 3: a prefix of the input, not a rearrangement of it.
		if !strings.HasPrefix(s, got) {
			t.Fatalf("Truncate(%q, %d) = %q: not a prefix", s, n, got)
		}
		// PROPERTY 4: valid UTF-8 in, valid UTF-8 out. This is the one that catches the real bug.
		if utf8.ValidString(s) && !utf8.ValidString(got) {
			t.Fatalf("Truncate(%q, %d) = %q: split a multi-byte character in half", s, n, got)
		}
	})
}

func FuzzParseRange(f *testing.F) {
	f.Add("3-9")
	f.Add("7")
	f.Add(" 4 - 6 ")
	f.Add("-")
	f.Add("9-3")

	f.Fuzz(func(t *testing.T, s string) {
		lo, hi, err := ParseRange(s) // PROPERTY 1: it never panics, whatever it is given
		if err != nil {
			return
		}
		// PROPERTY 2: a successful parse always returns a usable range.
		if lo > hi {
			t.Fatalf("ParseRange(%q) succeeded with lo=%d > hi=%d", s, lo, hi)
		}
	})
}

// The crashers a twenty-second fuzz run finds, kept as ordinary test cases so `go test` alone
// fails without anyone having to remember to fuzz. In a real project these arrive automatically
// as files under testdata/fuzz/ — this is what they would contain.
func TestTheCasesFuzzingFinds(t *testing.T) {
	t.Run("Truncate: n larger than the string", func(t *testing.T) {
		defer mustNotPanic(t, `Truncate("ab", 5)`)
		if got := Truncate("ab", 5); got != "ab" {
			t.Errorf("= %q, want %q", got, "ab")
		}
	})
	t.Run("Truncate: negative n", func(t *testing.T) {
		defer mustNotPanic(t, `Truncate("ab", -1)`)
		if got := Truncate("ab", -1); got != "" {
			t.Errorf("= %q, want %q", got, "")
		}
	})
	t.Run("Truncate: cutting a rune in half", func(t *testing.T) {
		got := Truncate("é", 1)
		if !utf8.ValidString(got) {
			t.Errorf("= %q (% x): invalid UTF-8", got, got)
		}
	})
	t.Run("ParseRange: empty string", func(t *testing.T) {
		defer mustNotPanic(t, `ParseRange("")`)
		if _, _, err := ParseRange(""); err == nil {
			t.Errorf("no error")
		}
	})
	t.Run("ParseRange: reversed range", func(t *testing.T) {
		if lo, hi, err := ParseRange("9-3"); err == nil {
			t.Errorf("accepted a reversed range as %d..%d", lo, hi)
		}
	})
	t.Run("ParseRange: garbage parses as zero", func(t *testing.T) {
		if lo, hi, err := ParseRange("abc"); err == nil {
			t.Errorf("parsed %q as %d..%d — a discarded Atoi error is a silent zero", "abc", lo, hi)
		}
	})
}

func mustNotPanic(t *testing.T, what string) {
	t.Helper()
	if r := recover(); r != nil {
		t.Fatalf("%s panicked: %v", what, r)
	}
}
