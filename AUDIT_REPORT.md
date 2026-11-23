# CrudeEdge v1.2 — Public Release Security & Functional Audit

**Date:** November 23, 2026  
**Scope:** the files in the public `CrudeEdge_Final_Audited_GitHub_Ready_v1_2.zip` package, not the original private Python source archive or any previous Git history.

## Checks performed

| Area | Result | Evidence and boundary |
| --- | --- | --- |
| Public artifact allowlist | PASS | GitHub Pages copies only `index.html`, CSS, two JS files, favicon, `.nojekyll` and its generated public market snapshot. |
| Credential/static secret check | PASS | Packaged source has no `.env`, saved wallet, private-key files, local trading history, signed-transaction code or known private-key format. `tests/security_checks.py` covers common patterns. |
| Live order isolation | PASS | No Hyperliquid `/exchange` requests, key signing, wallet connector or order-submission path; all order logic is browser-local simulation. |
| Correct Polymarket event | PASS (offline) | Exact Hormuz event slug; at least two active, future 2027 contracts; rejects wrong-year contracts, invalid event identity and empty markets. |
| Signal integration | PASS (offline) | Composite probability and 15-minute delta affect both virtual quote sizes and price offsets; deterministic Node.js unit tests. |
| GitHub outage behavior | PASS (offline) | Snapshot fetch code produces a safe, empty unavailable marker if the public API is down so the dashboard can deploy but trading does not start from fake odds. |
| Simulated order flow | PASS (mock browser) | Start, virtual bid/ask, new trade-triggered paper fill, old-trade rejection, pause, reset and desktop/mobile layout exercised with synthetic feed responses. |
| Package integrity | PASS | Tested archive CRC and a clean extraction; no private source files copied into release. |

## Limits of this audit

External API access was not available in the build environment. These checks **do not certify** live Hyperliquid order-book connectivity, browser CORS behavior against the actual Polymarket API, a real GitHub Pages deployment, statistical alpha, or realistic exchange execution. The fallback Polymarket snapshot is scheduled roughly every 10 minutes on GitHub Actions, but schedules may be delayed. Invalid or stale data disable paper trading. No real money trades are possible through this release.

If the original private repository or `.env` has ever been publicly shared, **rotate credentials and remove them from all remote Git history**. This archive cannot invalidate previously exposed secrets.
