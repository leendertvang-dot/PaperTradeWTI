/* CrudeEdge rates add-on: pure, transparent research heuristic.
 * 10Y (para:10Y) is a nominal-yield tracking perpetual; the literature on REAL
 * rates does not identify an intrasecond nominal-yield coefficient. Do not
 * interpret the user-selected blend as a peer-reviewed empirical estimate.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CrudeEdgeRates = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_WEIGHT = 0.4;
  const DEFAULT_WEIGHT = 0.2;
  const RATE_5BP_SCALE = 5;
  const WINDOW_MS = 15 * 60 * 1000;
  const clip = (n, a, b) => Math.max(a, Math.min(b, n));

  function rateSignal(observations, now = Date.now()) {
    if (!Array.isArray(observations) || !observations.length) return { deltaBps: NaN, score: NaN };
    const valid = observations.filter(x => Number.isFinite(x.t) && Number.isFinite(x.v) && x.v > 0 && x.t <= now + 1000 && now - x.t <= WINDOW_MS);
    if (!valid.length) return { deltaBps: NaN, score: NaN };
    const first = valid[0];
    const last = valid[valid.length - 1];
    // Contract price is quoted as yield in PERCENT. 0.01 percentage point = 1 bp.
    const deltaBps = (last.v - first.v) * 100;
    return { deltaBps, score: clip(-deltaBps / RATE_5BP_SCALE, -1, 1) };
  }

  function blendScores(hormuzScore, yieldScore, weight = DEFAULT_WEIGHT) {
    if (![hormuzScore, yieldScore, weight].every(Number.isFinite) || weight < 0 || weight > MAX_WEIGHT) return NaN;
    return clip((1 - weight) * clip(hormuzScore, -1, 1) + weight * clip(yieldScore, -1, 1), -1, 1);
  }

  // Local observational Pearson correlation of 1-second changes in oil PRICE
  // and 10Y NOMINAL-YIELD quote; descriptive, not a predictive coefficient.
  function observedCorrelation(samples) {
    if (!Array.isArray(samples) || samples.length < 32) return NaN;
    const diffs = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (![a.oil, b.oil, a.yield, b.yield].every(Number.isFinite) || a.oil <= 0 || b.oil <= 0) continue;
      // Exclude stale carries on BOTH series. Require a genuine new input on each.
      if (a.oilAt === b.oilAt || a.yieldAt === b.yieldAt) continue;
      diffs.push([(b.oil - a.oil) / a.oil, (b.yield - a.yield) * 100]);
    }
    if (diffs.length < 30) return NaN;
    const mx = diffs.reduce((s, x) => s + x[0], 0) / diffs.length;
    const my = diffs.reduce((s, x) => s + x[1], 0) / diffs.length;
    let cov = 0, vx = 0, vy = 0;
    for (const [x, y] of diffs) { cov += (x - mx) * (y - my); vx += (x - mx) ** 2; vy += (y - my) ** 2; }
    return vx > 0 && vy > 0 ? clip(cov / Math.sqrt(vx * vy), -1, 1) : NaN;
  }
  return Object.freeze({ MAX_WEIGHT, DEFAULT_WEIGHT, RATE_5BP_SCALE, WINDOW_MS, rateSignal, blendScores, observedCorrelation });
});
