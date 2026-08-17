# Multi-device & constrained environments ⭐⭐⭐⭐

Your app runs on a 4K desktop with a mouse, a phone with a thumb, a tablet with a stylus, a laptop
with a trackpad and a keyboard, a TV three metres away with a five-button remote, and a car
dashboard. Most of the difficulty is not layout — it is **input**, **focus** and **capability**.

```sh
./serve.sh    # then http://localhost:8080/multi-device/labs/01-input-modalities/
```

---

## The four axes

| Axis | Ranges from | to |
|---|---|---|
| **input** | precise pointer + keyboard | a five-button remote, or voice |
| **viewport** | 320 CSS px | 4K, and a TV where 1920px is viewed from 3m |
| **capability** | 16-core desktop | a £70 Android, or a TV chipset from 2018 |
| **network** | fibre | congested 4G, or a hotel wifi captive portal |

You cannot detect the device. You can detect **capabilities**, and you should design for the ranges
rather than for a list of devices you happen to own.

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Input modalities](labs/01-input-modalities/) | Hover, tap, keyboard, remote — one UI for all of them | ⭐⭐⭐⭐⭐ |
| 02 | [Viewports & containers](labs/02-viewports-and-containers/) | Beyond breakpoints: container queries, safe areas, units | ⭐⭐⭐⭐ |
| 03 | [TV & the 10-foot UI](labs/03-tv-and-10-foot/) | Spatial navigation, overscan, and a very slow CPU | ⭐⭐⭐⭐⭐ |
| 04 | [Adaptive delivery](labs/04-adaptive-delivery/) | Ship less to the devices that can take less | ⭐⭐⭐⭐ |

Related: [accessibility labs 02 and 05](../accessibility/) (focus and target size are the same
problem seen from a different angle) and
[web-vitals-and-react-perf](../web-vitals-and-react-perf/) (the p75 device is not your laptop).

## The one principle

> **Detect capabilities, never devices.**

User-agent sniffing has been wrong for twenty years and is getting worse: a "mobile" UA may be a
tablet with a keyboard, a desktop UA may be a touchscreen laptop, and a TV may report anything at
all. `@media (hover: hover)`, `(pointer: coarse)`, `matchMedia`, `navigator.connection` and a
measured frame rate all tell you something true.
