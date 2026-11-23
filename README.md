# CrudeEdge v1.5 — WTI + 10Y Dual-Pencil Quant Notebook

A shareable, English-language **GitHub Pages** paper-trading terminal with a genuinely hand-drawn graph-paper UI, animated price pencil and live-changing formula values. It uses read-only **public Hyperliquid `xyz:CL` WTI and `para:10Y` Treasury-yield perpetual** market data **and live-read public Polymarket Strait of Hormuz probabilities** to adjust a hypothetical two-sided virtual quoting strategy. No user account, wallet, key, backend, real order or installation is required.

**The Hormuz probability feed and live `para:10Y` nominal-yield movements both enter the virtual WTI quote formula** (not merely display widgets). This is a standalone browser educational simulator, **not** the original Python ML engine and **not** a validated trading strategy.

**[Open the PaperTradeWTI dashboard](https://leendertvang-dot.github.io/PaperTradeWTI/)** (live site requires a successful GitHub Pages deployment).

![CrudeEdge paper-trading dashboard mock preview](assets/dashboard-preview.webp)

*Illustrative preview with synthetic test prices, **not** a current market quote.*

## What's new in v1.5

- **Two time-aligned colored pencil curves** on the same graph: red for WTI (`xyz:CL`, left USD axis), blue for the 10-year nominal Treasury yield (`para:10Y`, right % axis).
- **One-second chart redraw**, with historical 1-minute candle closes immediately loaded for each market, then genuine live WebSocket quote updates. The drawing can refresh every second even if the market hasn't printed a new price; it never invents a tick.
- **Pointer hover and keyboard focus** show timestamp, WTI price and 10Y yield at the nearest plotted observation. Each series uses its own units and axis.
- **Mirrored mathematical notebook panel:** a symbolic formula in Greek letters, the definition of every factor, directly below it the live numeric substitution and the final paper bid, ask and notional. The displayed arithmetic uses the same calculation as the quote engine.
- **Interest rates truly influence quotes:** changes in `para:10Y` generate a bounded negative-direction yield signal, blended with the Hormuz signal, driving *both quote offsets and target notional*. The rate weight slider defaults to 20% and is adjustable 0–40% before starting paper trading. A 5 bp 10Y move is the exploratory full-scale reference, not a fitted statistical coefficient.
- **Transparent live input board:** best bid, ask, spread, order-book imbalance, Hormuz probability, ΔP, Hormuz score, 10Y yield, Δyield in bp, interest signal, blend weight, combined signal, local descriptive correlation, inventory, quote offsets and target notionals.
- **Read-only safety remains:** no private keys, no exchange order calls. On stale or missing **WTI, Hormuz or 10Y** feed, paper trading will not start or will pause.

The preview shows **synthetic mock-feed test values**, not current prices or evidence of investment performance.

### Scientific research, interpretation and the default 20% blend

1. Huang, W., Mollick, A. V., and Nguyen, K. H. (2017), *Dynamic responses and tail-dependence among commodities, the US real interest rate and the dollar*, **Empirical Economics** 53, 959–997. [Publication and abstract](https://ideas.repec.org/a/spr/empeco/v53y2017i3d10.1007_s00181-016-1165-6.html). Their oil vs **real interest rate** correlation changes from approximately **−0.089** in an earlier subsample to **−0.462** in a later subsample.
2. Arora, V., and Tanner, M. (2013), *Do oil prices respond to real interest rates?*, **Energy Economics** 36, 546–555. [Publisher abstract](https://www.sciencedirect.com/science/article/abs/pii/S0140988312002757). They find the oil-price response to real-rate surprises depends on maturity, sample period and real-rate definition.
3. Kilian, L. (2013), *The High-Frequency Response of Energy Prices to Monetary Policy: Understanding the Empirical Evidence*, **Federal Reserve Bank of New York Staff Report 598**. [Research summary](https://www.newyorkfed.org/research/staff_reports/sr598.html). Shows why monetary-policy announcements and high-frequency energy responses require careful event identification.

**These studies examine real rates, macro shocks and/or longer historical windows—not the one-second correlation between a Hyperliquid nominal 10Y perpetual and a WTI perpetual.** They support examining a rates signal, **not a scientifically estimated 20% weight**. The default weight **0.20**, 5-bp response scale and negative direction are explicitly labeled **experimental modeling assumptions**. A local paired-change correlation is displayed only when enough genuine updates exist; it is descriptive and is **not** used as a fitted coefficient. A forward-looking calibration would need robust out-of-sample validation on synchronized historical tick data, regime controls and trading-cost simulation.

### Exact live quote formula

`P = Σ(wᵢ × pᵢ)/Σwᵢ` for active Hormuz deadline markets. With `ΔP` the change over up to 15 minutes:

```text
s_H = clip(0.25 × (1 − 2P) + 0.75 × clip(−ΔP / 0.05), −1, 1)
Δy_bp = 100 × (y_now − y_first)          # 10Y quotes in percentage points
s_R = clip(−Δy_bp / 5, −1, 1)
s = (1 − w_R) × s_H + w_R × s_R         # default w_R = 0.20
bid_offset_bps = d0 + 3 × max(0, −s)
ask_offset_bps = d0 + 3 × max(0, +s)
paper_bid = best_WTI_bid × (1 − bid_offset_bps / 10000)
paper_ask = best_WTI_ask × (1 + ask_offset_bps / 10000)
bid_target_USD = base_notional × (1 + 0.6 × s)
ask_target_USD = base_notional × (1 − 0.6 × s)
```

The posted virtual quantity is further limited by virtual cash/inventory constraints. The formulas shown on the dashboard substitute **actual currently received values** and agree with these operations. The 10Y instrument is an **imperfect nominal-yield proxy**, not a direct measure of the **real** 10Y Treasury yield; exchange prices may differ from reference rates.

## Update existing repository `leendertvang-dot/PaperTradeWTI`

Use **GitHub Desktop** for replacing the project safely. In particular, dragging the extracted directories into GitHub's web upload form may flatten the `.github` hierarchy.

1. In GitHub Desktop, select **File → Clone repository**, then choose `leendertvang-dot/PaperTradeWTI` and clone it (skip cloning if you already have it locally).
2. Download and extract the v1.5 ZIP. In Windows Explorer, open the extracted folder and **copy all contents**, including `.github`, `assets`, `scripts`, and `tests`, into your locally cloned `PaperTradeWTI` directory. Replace existing files; **do not delete** the local hidden `.git` folder.
3. In GitHub Desktop, inspect the Changes tab, enter commit summary `CrudeEdge v1.5 WTI and 10Y dual pencil`, click **Commit to main**, then **Push origin**.
4. Visit [Actions](https://github.com/leendertvang-dot/PaperTradeWTI/actions) and verify both **Validate safe public paper trading app** and **Deploy public dashboard with Hormuz market snapshots** finish green. In Settings → Pages, keep Source set to **GitHub Actions**.
5. Visit [the public dashboard](https://leendertvang-dot.github.io/PaperTradeWTI/). If the browser retains old CSS, use Ctrl+F5 to reload.

The update does not upload anyone's browser-local paper positions. No GitHub repository secrets are necessary.

## Features

- Clear **Start Paper Trading** and **Pause Trading** controls; live **WTI, 10Y yield and Polymarket** feeds are all required to start.
- Live WTI (`xyz:CL`) top-of-book, price, spread and public market snapshot.
- Historical one-minute candle **closes** are shown as red WTI and blue 10Y hand-drawn-style lines, each with its own live pencil; new WebSocket quotes update the lines and a one-second timer redraws them. Public Info candles seed both traces.
- Fully simulated trades with a $10,000 initial virtual balance, virtual P&L/equity, position limits, hypothetical maker fees, trade history and CSV export.
- Session data saved **only in the visitor's browser** via `localStorage` (never uploaded).
- A dedicated **Hormuz Risk Signal** dashboard: four deadline probabilities, weighted composite YES probability, 15-minute observed change, oil-risk score and live virtual order skew.
- Transparent strategy monitor; **only** the new documented Hormuz-plus-yield paper strategy runs in-browser; original Python online RLS/ML and Brent/macroeconomic pipelines are **not** running.
- Responsive, static, no-build hosting; can be published on GitHub Pages.

## Deploy to GitHub Pages (easy)

1. Create a **new public repository** on GitHub (for example, `crudeedge-paper-trading`).
2. Unzip the release and upload **all its contents**, including the **hidden `.github` folder**, `assets`, `scripts` and `tests`, directly to the repository root. **Do not upload the ZIP as a single file. Never upload the original source ZIP.** Commit the files to the `main` branch.
3. In the repository, open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions** (not “Deploy from a branch”).
4. Open the **Actions** tab. If GitHub requests permission to enable workflows, enable them. Select **Deploy public dashboard with Hormuz market snapshots** and choose **Run workflow** on `main` to create the initial site/snapshot. (A push to `main` will usually trigger it automatically.)
5. After the workflow succeeds, your link is `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`. The scheduled workflow refreshes the public Polymarket snapshot every ~10 minutes (GitHub scheduling is best effort). No private keys or repository secrets are needed.

Visitors can inspect charts and start independent virtual sessions. Hyperliquid is browser-live. Polymarket is queried directly when browser CORS permits, or via the included scheduled **same-origin GitHub Pages snapshot** when direct requests are blocked. Users never need a Polymarket account. A shared GitHub Pages URL does **not** share a user's saved trades between visitors.

## Run locally

Serve the folder using an HTTP server (opening `index.html` directly via `file://` may fail security/CORS restrictions):

```bash
python scripts/fetch_hormuz_snapshot.py  # optional but recommended for local CORS fallback
python -m http.server 8000
```

Open http://localhost:8000/ in the browser. Requires an internet connection and browser access to Hyperliquid. No Python package installation, build step or backend service is required.

## Market data (public / read-only)

The app sends read-only requests only to **public market-data endpoints**:

| Source | Endpoint | Purpose |
| --- | --- | --- |
| Hyperliquid Info API | `POST https://api.hyperliquid.xyz/info` | `metaAndAssetCtxs` with `dex: "xyz"`; `candleSnapshot` for `xyz:CL` and `para:10Y` |
| Hyperliquid public WebSocket | `wss://api.hyperliquid.xyz/ws` | Subscribe to `l2Book`/`trades` for `xyz:CL`, `l2Book` for `para:10Y`, `allMids` for `xyz` |
| Hyperliquid 10Y reference | `POST https://api.hyperliquid.xyz/info` | Public `l2Book` for `para:10Y` and public `candleSnapshot` history; **actual rates input into WTI paper quote strategy** |
| Polymarket Gamma API | `GET https://gamma-api.polymarket.com/events/slug/strait-of-hormuz-traffic-returns-to-normal-byptptpt` | Browser-direct public read when CORS permits; read YES prices |
| GitHub Pages same-origin snapshot | `GET ./data/hormuz-snapshot.json` | Automatic fallback, generated from the **same Gamma event** by a public GitHub Actions cron job (approximately every 10 minutes, potentially delayed) |

The **public** WTI perpetual identifier is `xyz:CL` (Trade[XYZ], HIP-3), not native front-month NYMEX crude futures. Actual access and data depend on Hyperliquid service availability, market listing, browser network rules and rate limits. If the feed drops or goes stale, the simulator automatically pauses. A disconnected page never invents fake live market prices.

Docs: [Hyperliquid API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint), [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions), [Polymarket event](https://polymarket.com/event/strait-of-hormuz-traffic-returns-to-normal-byptptpt), [Polymarket public market discovery](https://docs.polymarket.com/market-data/discover-markets). All data requests are **read-only**. Public Gamma browser CORS can vary by network and region. The bundled GitHub Actions workflow fetches and publishes the same public event as a timestamped, sanitized JSON file on your own GitHub Pages domain—**no third-party CORS proxy or hard-coded odds**. The fallback must be newer than 45 minutes; otherwise trading stays disabled, rather than inventing odds.

## Actual Hormuz market input and formula

The app looks up **this exact Polymarket event slug only**: [Strait of Hormuz traffic returns to normal by...?](https://polymarket.com/event/strait-of-hormuz-traffic-returns-to-normal-byptptpt). It does **not** use unrelated "Will WTI hit $100?" contracts. It selects the active, future-dated YES markets for these explicit deadlines:

| Cumulative YES deadline | Model weight |
| --- | ---: |
| January 31, 2027 | 40% |
| March 31, 2027 | 30% |
| June 30, 2027 | 20% |
| December 31, 2027 | 10% |

Weights renormalize when a deadline is unavailable; **at least two validated active deadline markets** must be available or the strategy is disabled. These are four *cumulative* events; their implied probabilities are **not summed to 100%** and should not be confused with four exclusive outcomes. For each deadline, prefer the midpoint of a plausible two-sided YES bid/ask; if unavailable, use an *indicative* Gamma YES outcome price and disclose that fact in the UI. This is **not** a guarantee of tradeable prices or quote age.

Let \(p_i\) be the probability from market \(i\), and let \(w_i\) be its weight. The experimental browser-only strategy computes:

```text
P      = SUM(w_i * p_i) / SUM(w_i)        // composite probability [0, 1]
deltaP = P(now) - P(oldest sample in the last 15 min)
trend  = clamp(-deltaP / 0.05, -1, 1)    // first sample: trend = 0
score  = clamp(0.25*(1 - 2*P) + 0.75*trend, -1, 1)

bid_notional = user_notional * (1 + 0.60*score)
ask_notional = user_notional * (1 - 0.60*score)
bid_offset_bps = user_offset_bps + 3*max(0, -score)
ask_offset_bps = user_offset_bps + 3*max(0,  score)

paper_bid = live_hyperliquid_best_bid * (1 - bid_offset_bps / 10000)
paper_ask = live_hyperliquid_best_ask * (1 + ask_offset_bps / 10000)
```

So falling odds of normalization yield a **positive** oil-risk score: the virtual bid becomes relatively larger/more competitive while the virtual ask becomes relatively smaller/further away. Rising odds do the opposite. **This logic is a transparent research heuristic, not a statistical forecast, empirically validated coefficient set or investment recommendation.** It may respond to stale, illiquid or already-priced-in Polymarket information. Price direction is not guaranteed.

The browser checks Polymarket about every 30 seconds. It tries public Gamma directly first, then automatically loads a **same-origin, GitHub Actions-generated snapshot** when browser CORS disallows Gamma. The GitHub workflow requests the real public market approximately every 10 minutes and republishes the static site. The dashboard clearly labels “LIVE SNAPSHOT” versus “GITHUB SNAPSHOT” with the source timestamp. The first sample produces a level-only signal; later samples also use observed probability change, capped at 15 minutes of browser memory. **No persisted historical baseline, backtest or fabricated odds.** The simulator refuses new activity if a direct Polymarket feed is older than two minutes, a GitHub source snapshot is older than 45 minutes, a browser check is older than two minutes, or the Hyperliquid book is older than 30 seconds. An unavailable feed disables Start and pauses ongoing simulation. The risk signal does **not** send orders to Polymarket or Hyperliquid.

### Rates add-on clarification

The standalone Hormuz equations above describe the **Hormuz-only component** `s_H`. In **v1.5**, all quote and target-notional calculations instead use the **blended** score `s = (1−w_R)s_H + w_R s_R` from the earlier section. A rate increase can therefore directly decrease the oil-side quote score even when the Hormuz probability remains unchanged.

## Virtual fill simulation

When the user clicks **Start Paper Trading**, the app posts **hypothetical** two-sided virtual quotes with the above sizes and offsets, subject to user-configured maximum absolute inventory and a simplified cash assumption. A paper fill is recorded only when a fresh public Hyperliquid aggressive trade **timestamped after the displayed virtual quote became active** crosses that quote with available quantity. Older trades cannot retroactively fill new quotes. There is a 2.2-second minimum interval between fills and a **hypothetical fee of 2 basis points (0.02%)** per fill. The portfolio is marked at the available public WTI price.

**Limitations:** Exchange orders are **never** submitted. Estimated touch/trade-through fills omit order queue priority, latency, actual maker eligibility, slippage, hidden liquidity, funding, margin and liquidation, mark/settlement details and trading-specific fee schedules. The original package's online RLS ML, market-flow execution and macro model are not running. A static website is not a reliable historical trading-performance test.

## Security / safe to share

- Built **from scratch**, not by copying all files from the original uploaded ZIP.
- This package does **not** contain `.env`, backups, private key material, wallet addresses, personal trading logs, `.venv`, history files or saved ML state.
- There is **no exchange execution endpoint**, wallet connection, cryptographic signing, transaction approval, private backend or credential field in this project.
- The app has a restrictive Content Security Policy; browser connections are restricted to same-origin GitHub Pages, Hyperliquid public Info/WebSocket and Polymarket public Gamma endpoints.
- `.gitignore` blocks accidental addition of common credential file types if you add other files later.
- No tracking/analytics or external code dependencies.

**Important:** A public dashboard can never protect credentials that you manually insert into its JavaScript later. If you have ever uploaded the **original** ZIP or `.env` to any public repository, remove the data from **git history** and **rotate those credentials**; merely deleting them in the latest commit is insufficient.

## Files

```
index.html                      English-language dashboard and controls
styles.css                      Responsive handwritten graph-paper UI
app.js                          One-second dual-rate/WTI chart, hover and read-only virtual fills
rates-model.js                  Experimental 10Y yield signal, blend and local correlation
hormuz-signal.js                Auditable pure probability/model formula
scripts/fetch_hormuz_snapshot.py Public event-to-JSON fetch (GitHub Actions)
scripts/build_site.py           Publish-only allowlisted website artifact
.github/workflows/pages.yml     Pages deploy and 10-minute snapshot refresh
assets/favicon.svg              Icon
assets/dashboard-preview.webp    GitHub preview screenshot (synthetic/mock prices)
.github/workflows/validate.yml  GitHub Actions validation on push / PR
.nojekyll                       GitHub Pages compatibility
.gitignore                      Blocks common credentials and local artifacts
tests/hormuz_signal.test.cjs    Hormuz formula/unit tests with mocked market data
tests/rates_model.test.cjs      Rates signal, blend and correlation unit tests
tests/security_checks.py        Strict public file/secret/route audit
tests/test_snapshot.py          Offline tests for success, network failure and wrong-market protection
README.md                       Deployment, explanation and risk disclosure
AUDIT_REPORT.md                 Final release security and functional audit
LICENSE                         MIT license
```

## Test before publishing

Run the dependency-free tests from this folder (Node 22 and Python 3):

```bash
node --check app.js
node --check rates-model.js
node --test tests/hormuz_signal.test.cjs tests/rates_model.test.cjs
python tests/security_checks.py
python -m unittest discover -s tests -p "test_*.py"
```

The `.github/workflows/validate.yml` CI runs these tests on push and pull request. The separate `pages.yml` pipeline fetches the live public Polymarket event and deploys the static site. **If Polymarket cannot be reached, the dashboard still deploys, but its snapshot contains no odds and paper trading stays disabled** until a valid source is available; its `scripts/` contain **no account credentials**. The signal test uses synthetic prices, not real orders. Browser connectivity depends on Hyperliquid, public Gamma availability, the GitHub Pages deployment/schedule and regional/network access; passing unit tests cannot guarantee all live providers are reachable. If the event becomes inactive or the deadlines/slug change, the paper strategy deliberately fails closed until reviewed.


## License

MIT license. This is an educational trading simulation, not investment advice. CrudeEdge is not affiliated with Hyperliquid, Polymarket, Trade[XYZ], or NYMEX.

## Release audit (v1.5 · November 23, 2026)

The distributable archive contains only the files listed above and no original `.env`, wallet, local history, database or account exports. The read-only Hyperliquid and Polymarket API URLs are retained. Static checks and offline model/snapshot tests exercise the public data boundary. A mock-browser smoke test additionally exercised dual pencil tracing, per-second redraw, hover for both data series, rate-driven quote changes, Start/Pause, synthetic fills, reset and mobile layout. GitHub workflow builds only an explicit list of deployable static files.

**Testing boundary:** The external Hyperliquid and Polymarket APIs were not reachable from the audit runtime, so an end-to-end live-market or real GitHub Pages deployment could not be certified here. Simulated/test fills are not proof of market-maker performance. Prior user private credentials must still be rotated if they were ever uploaded elsewhere.
