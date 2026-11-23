/* Public Polymarket Strait of Hormuz signal — pure, dependency-free math.
   No authentication, wallet or trading API. Probability != evidence of causation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrudeEdgeHormuz = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const EVENT_SLUG = 'strait-of-hormuz-traffic-returns-to-normal-byptptpt';
  const EVENT_URL = `https://polymarket.com/event/${EVENT_SLUG}`;
  const GAMMA_URL = `https://gamma-api.polymarket.com/events/slug/${EVENT_SLUG}`;
  // Intentionally explicit fixed calendar horizons: do not treat these cumulative
  // "by date" YES contracts as mutually exclusive outcomes or sum their prices.
  const HORIZONS = [
    { iso: '2027-01-31', weight: 0.40, label: 'Jan 31, 2027' },
    { iso: '2027-03-31', weight: 0.30, label: 'Mar 31, 2027' },
    { iso: '2027-06-30', weight: 0.20, label: 'Jun 30, 2027' },
    { iso: '2027-12-31', weight: 0.10, label: 'Dec 31, 2027' }
  ];
  const finite = v => {
    if (v == null || typeof v === 'boolean' || String(v).trim() === '') return NaN;
    const n = Number(v); return Number.isFinite(n) ? n : NaN;
  };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const decodeArray = raw => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string') return null;
    try { const value = JSON.parse(raw); return Array.isArray(value) ? value : null; }
    catch { return null; }
  };
  // Match the *stated calendar deadline*, rejecting a different explicit year.
  // A loose prefix such as "January 31" must never select "January 31, 2026"
  // as the January 2027 contract, even if the event contains mixed years.
  const deadline = market => {
    const search = [market.groupItemTitle, market.question, market.slug]
      .filter(v => typeof v === 'string').join(' ');
    for (const h of HORIZONS) {
      const d = new Date(`${h.iso}T00:00:00Z`);
      const longMonth = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
      const shortMonth = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const day = d.getUTCDate();
      const year = String(d.getUTCFullYear());
      const regex = new RegExp(`\\b(?:${longMonth}|${shortMonth})\\.?\\s+${day}(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi');
      for (const match of search.matchAll(regex)) {
        if (!match[1] || match[1] === year) return h.iso;
      }
    }
    // If explicit wording mentions a different year, refuse to infer the
    // intended contract from a potentially unrelated exchange expiry date.
    if (/\b(?:20\d{2})\b/.test(search)) return null;
    const end = String(market.endDate || market.endDateIso || '');
    const matching = HORIZONS.find(h => end.startsWith(h.iso));
    return matching ? matching.iso : null;
  };
  const probability = market => {
    const outcomes = decodeArray(market.outcomes);
    const yes = outcomes?.findIndex(x => String(x).toLowerCase().trim() === 'yes');
    if (yes == null || yes < 0 || outcomes?.length !== 2) return null;
    const bid = finite(market.bestBid), ask = finite(market.bestAsk);
    // Prefer genuine two-sided YES quotes, when the snapshot contains them.
    if (bid > 0 && ask < 1 && ask >= bid && ask - bid <= 0.30) {
      return { p: (bid + ask) / 2, basis: 'YES bid/ask midpoint' };
    }
    // Gamma outcomePrices are indicative, not proof of executable liquidity.
    const prices = decodeArray(market.outcomePrices);
    const p = prices?.length === 2 ? finite(prices[yes]) : NaN;
    if (p > 0 && p < 1) return { p, basis: 'indicative YES outcome price' };
    return null;
  };
  function readEvent(event, now = Date.now()) {
    if (!event || event.slug !== EVENT_SLUG || !Array.isArray(event.markets)) throw new Error('Polymarket event identity or markets are invalid.');
    if (!String(event.title || '').toLowerCase().includes('hormuz')) throw new Error('Polymarket event title does not match Hormuz.');
    if (event.closed === true || event.archived === true) throw new Error('The Hormuz event has closed.');
    const selected = new Map();
    for (const market of event.markets) {
      if (!market || market.active === false || market.closed === true || market.archived === true || market.resolved === true) continue;
      const iso = deadline(market);
      if (!iso || Date.parse(`${iso}T23:59:59Z`) <= now) continue;
      const quote = probability(market);
      if (!quote || !market.id) continue;
      // Explicitly prefer the market with a real bid/ask over an indicative price.
      const entry = { ...quote, iso, id: String(market.id), label: HORIZONS.find(h => h.iso === iso).label };
      const prior = selected.get(iso);
      if (!prior || (prior.basis !== 'YES bid/ask midpoint' && entry.basis === 'YES bid/ask midpoint')) selected.set(iso, entry);
    }
    // Require at least two independently priced deadlines for a composite.
    if (selected.size < 2) throw new Error('Fewer than two valid active Hormuz deadlines are available.');
    const markets = HORIZONS.filter(h => selected.has(h.iso)).map(h => ({ ...selected.get(h.iso), weight: h.weight }));
    const w = markets.reduce((sum, m) => sum + m.weight, 0);
    const composite = markets.reduce((sum, m) => sum + m.weight * m.p, 0) / w;
    const identity = `${String(event.id || event.slug)}:${markets.map(m => `${m.iso}:${m.id}`).join('|')}`;
    return { markets, composite, identity };
  }
  function makeSignal(composite, baseline = NaN) {
    if (!(Number.isFinite(composite) && composite >= 0 && composite <= 1)) throw new Error('Invalid composite probability');
    const delta = Number.isFinite(baseline) ? composite - baseline : NaN;
    const level = (1 - 2 * composite);
    const trend = Number.isFinite(delta) ? clamp(-delta / 0.05, -1, 1) : 0;
    // Explicit *experimental* geopolitical oil-risk heuristic, not a fitted model.
    // +1 = bullish oil-risk skew, -1 = bearish oil-risk skew.
    const score = clamp(0.25 * level + 0.75 * trend, -1, 1);
    return { score, delta, level, trend };
  }
  function quoteTilt(score, notional, baseOffsetBps) {
    if (!Number.isFinite(score) || !Number.isFinite(notional) || !Number.isFinite(baseOffsetBps)) throw new Error('Missing signal or order settings');
    const b = clamp(score, -1, 1);
    return {
      bidOffsetBps: baseOffsetBps + Math.max(0, -b) * 3,
      askOffsetBps: baseOffsetBps + Math.max(0, b) * 3,
      bidNotional: notional * (1 + 0.6 * b),
      askNotional: notional * (1 - 0.6 * b)
    };
  }
  return { EVENT_SLUG, EVENT_URL, GAMMA_URL, HORIZONS, readEvent, makeSignal, quoteTilt };
});
