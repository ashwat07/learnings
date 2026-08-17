# Frontend security, auth & supply chain ⭐⭐⭐⭐⭐

Frontend security is a small number of mechanisms that each prevent one specific thing. This course
builds the attack in a sandbox, then the defence, then measures that the defence holds — because a
security control you have never seen fail is a control you do not understand.

```sh
./serve.sh    # then http://localhost:8080/security-and-auth/labs/01-xss/
```

> Everything here runs against the localhost-bound lab server, against payloads you supply
> yourself. `/api/reflect` is a **deliberately vulnerable** endpoint that exists so you can watch
> escaping and CSP do their jobs. It is not a pattern to copy.

---

## The threat model, in one table

| Attack | What it needs | What stops it |
|---|---|---|
| **XSS** | your app to render attacker-controlled content as code | escaping by default, sanitisation for rich text, CSP as the second line |
| **CSRF** | the browser to send your cookies on a cross-site request | `SameSite` cookies, CSRF tokens, checking `Origin` |
| **Clickjacking** | your page embeddable in their frame | `frame-ancestors` (CSP) or `X-Frame-Options` |
| **Token theft** | a token readable by JavaScript | `HttpOnly` cookies; tokens in memory, never `localStorage` |
| **Supply chain** | a dependency (or its transitive dep) to ship malicious code | lockfiles, integrity, review, minimal dependencies |
| **Data exfiltration after XSS** | a network path out | CSP `connect-src`, Trusted Types |

Two principles that organise all of it:

1. **Defence in depth.** Escaping *and* CSP *and* Trusted Types. Each assumes the others fail.
2. **Secure by default, unsafe by exception.** React escapes by default and makes the unsafe path
   spell out `dangerouslySetInnerHTML`. That naming is a security control.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [XSS & sanitization](labs/01-xss/) | What actually executes, and what stops it? | ⭐⭐⭐⭐⭐ |
| 02 | [CSP](labs/02-csp/) | How do I ship a real policy without breaking the app? | ⭐⭐⭐⭐⭐ |
| 03 | [CSRF](labs/03-csrf/) | Which defence, and what does each miss? | ⭐⭐⭐⭐ |
| 04 | [Client auth & sessions](labs/04-auth-and-sessions/) | Where does the token live, and why not there? | ⭐⭐⭐⭐⭐ |
| 05 | [Supply chain](labs/05-supply-chain/) | What am I actually shipping, and who wrote it? | ⭐⭐⭐⭐ |

## Related, already built

- The CSRF mechanism (cross-origin requests still reach your server): [cors lab 01](../cors/labs/01-same-origin-policy/)
- Cookies, `SameSite`, credentialed requests: [cors lab 04](../cors/labs/04-credentials/)
- Why `localStorage` is a bad place for a token: [browser-storage lab 01](../browser-storage/labs/01-localstorage-cost/)
- Subresource integrity and third-party scripts: [resource-hints lab 03](../resource-hints/labs/03-preload/)
