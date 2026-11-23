# CrudeEdge v1.5 — GitHub Pages release audit

**Date:** November 23, 2026. This audit covers only the **new clean source archive**, not the user's existing public Git history or the original private code archive.

## Local checks completed

| Check | Result | Scope |
| --- | --- | --- |
| JS syntax and formula unit tests | PASS | `node --check`, Hormuz and 10Y rate models |
| Python data snapshot tests | PASS | Wrong market/network failures publish no fabricated probabilities |
| Security source allowlist | PASS | New `rates-model.js` and test included; no `.env`, signing routine, hard-coded private keys or exchange order endpoint |
| Chart behavior | PASS (mock browser) | WTI red + rate blue; independent axes, 1-second redraw, hover with time and two prices, moving pencils |
| Live quote impact | PASS (mock browser) | A genuine rate-book change alters blended score and virtual quote while WTI and Hormuz are held fixed |
| Paper trading | PASS (mock browser) | Start, local fill, Pause, reset, stored account operations |
| Responsive layout | PASS (mock browser) | Desktop/mobile visual checks and mobile horizontal overflow check |
| Deployment structure | PASS (local) | `.github/workflows`, `scripts`, `tests`, `assets` are preserved; public artifact is explicitly allowlisted |

## Scientific boundary

The live nominal 10Y rate input uses an exploratory **20% weight** (user-adjustable 0–40%) against an 80% Hormuz score and a 5 bp normalizing scale. **These are not empirically fitted weights**. Literature correlations such as −0.089 or −0.462 refer to **real rates in historical samples** and must not be used as instant trading coefficients for a nominal-rate perpetual. Citations and interpretive limitations are in `README.md`.

## Operational boundary

- The dashboard is redrawn every second **but an actual market quote is only updated when a genuine new observation arrives**. Historical data are authentic in production; mock test screenshots are not live quotes.
- Historical tick and order-book access, browser CORS, public Polymarket availability and GitHub scheduled deploys were **not validated end-to-end against production feeds here**. If a required feed is unavailable or stale, trading cannot start or pauses.
- `para:10Y` is a tradable yield-linked perpetual on Hyperliquid, not the published official Treasury yield; instrument basis, bid/ask spreads and off-hours trading can differ.
- All orders/fills are virtual. This is neither a validated trading strategy nor an accurate exchange execution or latency simulator.
- This clean archive does not certify the safety of old commits in the user's GitHub repository. Rotate any secrets ever published.
