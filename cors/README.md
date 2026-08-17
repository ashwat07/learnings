# CORS, preflight & credentials ⭐⭐⭐⭐⭐

CORS is not a security feature that protects your server. It is a mechanism by which a server
**opts out** of a browser restriction that exists to protect *users*. Almost every wrong mental
model about CORS comes from getting that sentence backwards.

```sh
./serve.sh    # then http://localhost:8080/cors/labs/01-same-origin-policy/
```

The lab server gives you three origins from one process:

| Origin | Role |
|---|---|
| `http://localhost:8080` | where the labs are served — the "page origin" |
| `http://localhost:8081` | the API on another origin |
| `http://127.0.0.1:8080` | a third origin (different host, same server) |

---

## The model

**Same-origin policy (SOP)** is the rule: a document from origin A may not *read* responses from
origin B. Origin = scheme + host + port; all three must match.

**CORS** is the escape hatch: origin B can attach headers saying "this specific origin may read
this specific response".

Four facts, in the order that fixes the most misunderstandings:

1. **The request usually still happens.** The browser sends it, the server processes it, the
   response comes back — and then the browser refuses to hand it to your JavaScript. If your API
   deleted a row, it's still deleted. CORS is a read restriction, not a firewall.
2. **The server does not enforce anything. The browser does.** `curl` ignores CORS entirely.
   Anyone can call your API from a script; CORS only governs what a *page in a browser* is allowed
   to read on a user's behalf.
3. **Preflight is a separate request** — an `OPTIONS` with no body, sent *before* the real one,
   asking permission for the method and headers you plan to use. If it fails, the real request is
   never sent.
4. **Credentials change all the rules.** With `credentials: 'include'`, wildcards stop being legal
   — for the origin, the headers, and the methods — and you must echo an exact origin plus
   `Access-Control-Allow-Credentials: true`.

### The headers

| Response header | Set on | Means |
|---|---|---|
| `Access-Control-Allow-Origin` | both | who may read this. `*` or one exact origin — never a list |
| `Access-Control-Allow-Methods` | preflight | which methods are permitted |
| `Access-Control-Allow-Headers` | preflight | which *request* headers the page may set |
| `Access-Control-Max-Age` | preflight | how long to cache this permission |
| `Access-Control-Allow-Credentials` | both | cookies/TLS certs may be sent and the response read |
| `Access-Control-Expose-Headers` | actual | which *response* headers JS may read (default: 7 safelisted ones) |
| `Vary: Origin` | both | mandatory whenever `ACAO` is not literally `*` |

### The decision tree

```
cross-origin fetch
  ├─ mode: 'no-cors'?  → opaque response: status 0, no headers, no body. Useful for <img>, caching
  │                       in a service worker, and almost nothing else.
  └─ mode: 'cors' (default)
       ├─ "simple" request?  (GET/HEAD/POST + safelisted headers + safelisted Content-Type)
       │     → send it; check ACAO on the response
       └─ otherwise
             → send OPTIONS preflight
                  ├─ preflight must be 2xx, with ACAO + ACAM + ACAH covering what you asked
                  └─ then send the real request, and check ACAO again on THAT response
```

---

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Same-origin policy](labs/01-same-origin-policy/) | What is actually blocked, and what isn't? | ⭐⭐⭐⭐⭐ |
| 02 | [Simple vs preflighted](labs/02-simple-vs-preflight/) | What makes the browser send an OPTIONS? | ⭐⭐⭐⭐⭐ |
| 03 | [Debug a preflight failure](labs/03-debugging-preflight/) | Eight broken configurations, diagnosed from the error alone | ⭐⭐⭐⭐⭐ |
| 04 | [Credentials](labs/04-credentials/) | Cookies cross-origin, and why `*` stops working | ⭐⭐⭐⭐⭐ |
| 05 | [Response headers & opaque](labs/05-response-headers/) | Why can't I read `X-Total-Count`? What is an opaque response? | ⭐⭐⭐⭐ |
| 06 | [Build a CORS diagnoser](labs/06-cors-toolkit/) | Turn all of it into a tool and a config you can defend | ⭐⭐⭐⭐⭐ |

## Reading the error message

Chrome's CORS errors are unusually good — they name the exact missing header. Learn to map them:

| Message fragment | What it means | Fix |
|---|---|---|
| `No 'Access-Control-Allow-Origin' header is present` | The response had no ACAO at all | Add it to the **actual** response (and check the preflight separately) |
| `Response to preflight request doesn't pass access control check` | The OPTIONS response was the problem | Look at the OPTIONS, not the GET |
| `Method PATCH is not allowed by Access-Control-Allow-Methods` | ACAM missing or too narrow | Add the method |
| `Request header field x-token is not allowed by Access-Control-Allow-Headers` | ACAH missing or too narrow | Add the header name |
| `The value of the 'Access-Control-Allow-Origin' header ... must not be the wildcard '*' when the request's credentials mode is 'include'` | `*` + credentials | Echo the exact origin + `Vary: Origin` |
| `Redirect is not allowed for a preflight request` | Your OPTIONS got a 30x | Don't redirect OPTIONS (common with `http→https` or trailing-slash rules) |
| `It does not have HTTP ok status` | Preflight returned 4xx/5xx | Auth middleware is rejecting the OPTIONS — exclude it |

**Network panel note:** enable the `Type` column and look for the `preflight` row. In Chrome you
may need *"Show CORS preflight requests"* — the failing request is often invisible until you do.
