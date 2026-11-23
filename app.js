/* CrudeEdge — public, browser-only paper trading dashboard.
 * This file is deliberately read-only against Hyperliquid. It contains NO wallet,
 * NO private keys, NO signing code, NO /exchange API calls and NO live-order path.
 */
(() => {
  'use strict';
  const MARKET = 'xyz:CL';
  const DEX = 'xyz';
  const INFO_URL = 'https://api.hyperliquid.xyz/info';
  const WS_URL = 'wss://api.hyperliquid.xyz/ws';
  const STORAGE_KEY = 'crudeedge-public-paper-v1';
  const HORMUZ = window.CrudeEdgeHormuz;
  const POLY_STALE_MS = 120000; // Direct Gamma polling freshness.
  const POLY_GITHUB_STALE_MS = 45 * 60000; // GitHub Action schedule can be delayed.
  const POLY_POLL_MS = 30000;
  if (!HORMUZ) throw new Error('Hormuz signal module failed to load. Trading is disabled.');
  const STARTING_CASH = 10000;
  const MAX_TRADES = 500;
  const $ = (id) => document.getElementById(id);
  const fmt = (n, dp = 2) => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—';
  const dollars = (n) => `${n < 0 ? '-' : ''}$${fmt(Math.abs(n))}`;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const nnum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
  const utc = (time) => new Date(time).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false });
  const initialPaper = () => ({ cash: STARTING_CASH, position: 0, avgEntry: 0, realized: 0, fees: 0, fills: [], equityPoints: [{ t: Date.now(), v: STARTING_CASH }] });
  const s = {
    ws: null, reconnectId: null, reconnectAttempts: 0, running: false, connected: false, lastFeed: 0, lastBook: 0,
    price: NaN, prevDay: NaN, bestBid: NaN, bestAsk: NaN, orderbook: [[], []],
    quoteBid: NaN, quoteAsk: NaN, quoteQtyBid: 0, quoteQtyAsk: 0, quoteActivatedAt: 0,
    currentCandle: [], candles: [], interval: '5m', midHistory: [], seenTrades: new Set(), lastFillAt: 0,
    paper: initialPaper(), settings: { notional: 200, offset: 0, maxPosition: 5 },
    poly: { ready: false, lastSuccess: 0, error: '', markets: [], composite: NaN,
      score: NaN, delta: NaN, identity: '', observations: [], source: '', mode: '', sourceAt: 0 }
  };
  let toastTimer;

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3900);
  }
  function loadPaper() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored || stored.version !== 1) return;
      const p = stored.paper;
      if (!p || ![p.cash, p.position, p.avgEntry, p.realized, p.fees].every(Number.isFinite) || !Array.isArray(p.fills)) return;
      if (p.fills.length > MAX_TRADES || Math.abs(p.position) > 1000 || p.cash < -1e8 || p.cash > 1e8) return;
      s.paper = { ...initialPaper(), ...p, fills: p.fills.slice(-MAX_TRADES), equityPoints: (Array.isArray(p.equityPoints) ? p.equityPoints : []).filter(x => Number.isFinite(x?.v) && Number.isFinite(x?.t)).slice(-250) };
      if (!s.paper.equityPoints.length) s.paper.equityPoints = [{ t: Date.now(), v: STARTING_CASH }];
      if (stored.settings) {
        s.settings.notional = clamp(nnum(stored.settings.notional) || 200, 10, 10000);
        s.settings.offset = clamp(nnum(stored.settings.offset) || 0, 0, 50);
        s.settings.maxPosition = clamp(nnum(stored.settings.maxPosition) || 5, .1, 100);
      }
      $('trade-size').value = s.settings.notional;
      $('quote-offset').value = s.settings.offset;
      $('max-position').value = s.settings.maxPosition;
    } catch { /* Storage is optional. */ }
  }
  function savePaper() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, paper: s.paper, settings: s.settings })); }
    catch { /* Private-browsing or quota limit; the active session still works. */ }
  }
  function bookMid() {
    return Number.isFinite(s.bestBid) && Number.isFinite(s.bestAsk) && s.bestAsk >= s.bestBid ? (s.bestBid + s.bestAsk) / 2 : NaN;
  }
  function mark() { return Number.isFinite(s.price) && s.price > 0 ? s.price : NaN; }
  function equity() { return s.paper.cash + s.paper.position * (mark() || s.paper.avgEntry || 0); }
  function totalPnl() { return equity() - STARTING_CASH; }
  function unrealized() { return s.paper.position * ((mark() || s.paper.avgEntry || 0) - s.paper.avgEntry); }
  function setConnection(status, details = '') {
    const badge = $('feed-status');
    badge.className = 'status-pill ' + (status === 'LIVE' ? '' : status === 'RECONNECTING' ? 'offline' : 'error');
    badge.innerHTML = `<i></i> ${status}`;
    if (details) $('last-update').textContent = details;
  }
  function marketReady() {
    return s.connected && Date.now() - s.lastBook < 30000 && Number.isFinite(s.bestBid) &&
      Number.isFinite(s.bestAsk) && Number.isFinite(mark()) && s.bestBid > 0 && s.bestAsk >= s.bestBid;
  }
  function polyReady() {
    const maxAge = s.poly.mode === 'github' ? POLY_GITHUB_STALE_MS : POLY_STALE_MS;
    return s.poly.ready && Number.isFinite(s.poly.score) &&
      Date.now() - s.poly.lastSuccess < POLY_STALE_MS &&
      s.poly.sourceAt > 0 && Date.now() - s.poly.sourceAt >= -60000 &&
      Date.now() - s.poly.sourceAt < maxAge;
  }
  function readyToTrade() { return marketReady() && polyReady(); }
  function updateStartAvailability() {
    $('start-btn').disabled = !readyToTrade();
    const waiting = !marketReady() ? 'Waiting for live Hyperliquid WTI book' :
      !polyReady() ? 'Waiting for live Polymarket Hormuz snapshot' : 'Both market feeds ready · paper trades only';
    $('start-requirement').textContent = s.running ? 'Simulated orders only · no wallet or private keys' : waiting;
  }
  function setRunning(running) {
    s.running = running;
    $('start-btn').classList.toggle('hidden', running);
    $('stop-btn').classList.toggle('hidden', !running);
    updateStartAvailability();
    $('engine-status').textContent = running ? 'RUNNING · PAPER' : 'STANDBY';
    $('engine-status').classList.toggle('running', running);
    $('engine-indicator').innerHTML = running ? '<span>●</span> ACTIVE' : '<span>●</span> IDLE';
    $('engine-indicator').classList.toggle('running', running);
    ['trade-size', 'quote-offset', 'max-position', 'chart-interval'].forEach(id => { if (id !== 'chart-interval') $(id).disabled = running; });
    computeQuotes();
  }
  function validateSettings() {
    const notional = nnum($('trade-size').value), offset = nnum($('quote-offset').value), maxPosition = nnum($('max-position').value);
    if (![notional, offset, maxPosition].every(Number.isFinite) || notional < 10 || notional > 10000 || offset < 0 || offset > 50 || maxPosition < .1 || maxPosition > 100) {
      toast('Invalid settings. Check the allowed ranges.'); return false;
    }
    s.settings = { notional, offset, maxPosition }; savePaper(); return true;
  }
  function computeQuotes() {
    const prior = [s.quoteBid, s.quoteAsk, s.quoteQtyBid, s.quoteQtyAsk];
    s.quoteBid = NaN; s.quoteAsk = NaN; s.quoteQtyBid = 0; s.quoteQtyAsk = 0;
    if (s.running && readyToTrade()) {
      const { notional, offset, maxPosition } = s.settings;
      // The live Polymarket score is a DIRECT INPUT to both quoting price and size.
      // Score > 0: bigger/more aggressive bid, smaller/wider ask (bullish oil-risk bias).
      // Score < 0: smaller/wider bid, bigger/more aggressive ask.
      const tilt = HORMUZ.quoteTilt(s.poly.score, notional, offset);
      const bid = s.bestBid * (1 - tilt.bidOffsetBps / 10000);
      const ask = s.bestAsk * (1 + tilt.askOffsetBps / 10000);
      const bidSize = tilt.bidNotional / bid, askSize = tilt.askNotional / ask;
      // A simplified virtual cash/inventory cap; not a margin or exchange model.
      s.quoteQtyBid = clamp(Math.min(bidSize, maxPosition - s.paper.position, Math.max(0, s.paper.cash) / bid), 0, maxPosition);
      s.quoteQtyAsk = clamp(Math.min(askSize, maxPosition + s.paper.position, Math.max(0, equity()) / ask + Math.max(0, s.paper.position)), 0, maxPosition);
      s.quoteBid = bid; s.quoteAsk = ask;
    }
    // A new price, size or state is a newly posted *virtual* quote. Historical
    // prints from before it was displayed cannot fill it (no look-ahead).
    const latest = [s.quoteBid, s.quoteAsk, s.quoteQtyBid, s.quoteQtyAsk];
    if (prior.some((v, i) => !Object.is(v, latest[i]))) s.quoteActivatedAt = Date.now();
    $('quote-bid').textContent = s.quoteQtyBid > .000001 ? '$' + fmt(s.quoteBid, 3) : '—';
    $('quote-ask').textContent = s.quoteQtyAsk > .000001 ? '$' + fmt(s.quoteAsk, 3) : '—';
    $('quote-bid-size').textContent = s.quoteQtyBid > .000001 ? fmt(s.quoteQtyBid, 3) + ' CL · virtual limit' : 'No active order';
    $('quote-ask-size').textContent = s.quoteQtyAsk > .000001 ? fmt(s.quoteQtyAsk, 3) + ' CL · virtual limit' : 'No active order';
  }
  function executePaper(side, px, qty, time) {
    if (!s.running || !readyToTrade() || !Number.isFinite(px) || px <= 0 || !Number.isFinite(qty) || qty <= 0) return;
    const p = s.paper;
    // Conservative illustrative maker fee; adjustable by code, not an exchange fee schedule.
    const fee = qty * px * .0002;
    const delta = (side === 'BUY' ? 1 : -1) * qty;
    const old = p.position, next = old + delta;
    if (old === 0 || Math.sign(old) === Math.sign(delta)) {
      p.avgEntry = (Math.abs(old) * p.avgEntry + qty * px) / Math.max(1e-10, Math.abs(next));
    } else {
      const closed = Math.min(Math.abs(old), qty);
      p.realized += (px - p.avgEntry) * Math.sign(old) * closed;
      if (Math.abs(next) < 1e-8) p.avgEntry = 0;
      else if (Math.sign(next) !== Math.sign(old)) p.avgEntry = px;
    }
    p.position = Math.abs(next) < 1e-9 ? 0 : next;
    p.cash -= delta * px + fee;
    p.fees += fee;
    p.fills.push({ time, side, price: px, qty, fee });
    if (p.fills.length > MAX_TRADES) p.fills.shift();
    s.lastFillAt = Date.now();
    snapshotEquity(true); savePaper(); computeQuotes(); renderSummary(); renderHistory(); drawEquity();
    toast(`${side === 'BUY' ? 'Simulated buy' : 'Simulated sell'} · ${fmt(qty, 3)} CL at $${fmt(px, 3)}`);
  }
  function onTrades(trades) {
    if (!Array.isArray(trades)) return;
    const sorted = trades.slice().sort((a, b) => (a.time || 0) - (b.time || 0));
    for (const t of sorted) {
      if (!t || t.coin !== MARKET) continue;
      const px = nnum(t.px), sz = nnum(t.sz), time = nnum(t.time);
      if (!(px > 0 && sz > 0 && Number.isFinite(time))) continue;
      const tradeId = String(t.tid ?? `${time}/${t.px}/${t.sz}/${t.side}`);
      if (s.seenTrades.has(tradeId)) continue;
      s.seenTrades.add(tradeId);
      if (s.seenTrades.size > 3000) s.seenTrades = new Set(Array.from(s.seenTrades).slice(-1500));
      // A trade must be fresh AND later than the currently displayed quote;
      // public trades that arrived before we published the quote never fill it.
      if (!s.running || !readyToTrade() || Date.now() - time > 7000 ||
          time > Date.now() + 1000 || time < s.quoteActivatedAt ||
          Date.now() - s.lastFillAt < 2200) continue;
      // Hyperliquid trades use the aggressor side: S hits bid, B lifts ask.
      // These are hypothetical, NOT exchange-verified fills or queue-position simulation.
      if (t.side === 'S' && s.quoteQtyBid > 0 && px <= s.quoteBid) executePaper('BUY', s.quoteBid, Math.min(s.quoteQtyBid, sz), time);
      else if (t.side === 'B' && s.quoteQtyAsk > 0 && px >= s.quoteAsk) executePaper('SELL', s.quoteAsk, Math.min(s.quoteQtyAsk, sz), time);
    }
  }
  function snapshotEquity(force = false) {
    if (!Number.isFinite(mark())) return;
    const points = s.paper.equityPoints;
    const now = Date.now();
    if (force || now - (points.at(-1)?.t || 0) > 15000) {
      points.push({ t: now, v: equity() });
      if (points.length > 250) points.shift();
    } else points[points.length - 1] = { t: now, v: equity() };
  }
  function renderSummary() {
    const e = equity(), pnl = totalPnl(), p = s.paper;
    $('equity').textContent = dollars(e);
    $('pnl').textContent = (pnl > 0 ? '+' : '') + dollars(pnl);
    $('pnl').className = 'stat-value ' + (pnl > .00001 ? 'positive' : pnl < -.00001 ? 'negative' : '');
    $('pnl-sub').textContent = `${fmt(pnl / STARTING_CASH * 100)}% total return`;
    $('position').innerHTML = `${fmt(p.position, 3)} <small>CL</small>`;
    $('position-sub').textContent = p.position > 0 ? `LONG · avg entry $${fmt(p.avgEntry, 3)}` : p.position < 0 ? `SHORT · avg entry $${fmt(p.avgEntry, 3)}` : 'No open position';
    $('fill-count').textContent = String(p.fills.length);
    $('fill-sub').textContent = p.fills.length ? `Last fill ${utc(p.fills.at(-1).time)} UTC` : 'Awaiting first paper trade';
    $('unrealized').textContent = dollars(unrealized());
    $('fees').textContent = dollars(p.fees);
    $('export-btn').disabled = p.fills.length === 0;
  }
  function renderHistory() {
    const rows = s.paper.fills.slice().reverse().slice(0, 80);
    if (!rows.length) {
      $('trade-rows').innerHTML = '<tr><td colspan="6" class="empty-trades">Your simulated fills will appear here when paper trading begins.</td></tr>';
      return;
    }
    // All fields are strongly typed and formatted before being inserted.
    $('trade-rows').innerHTML = rows.map(t => `<tr><td>${utc(t.time)}</td><td><span class="${t.side === 'BUY' ? 'buy-pill' : 'sell-pill'}">${t.side === 'BUY' ? 'BUY' : 'SELL'}</span></td><td>$${fmt(t.price, 3)}</td><td>${fmt(t.qty, 4)}</td><td>$${fmt(t.price * t.qty, 2)}</td><td>$${fmt(t.fee, 4)}</td></tr>`).join('');
  }
  function renderBook() {
    const asks = (s.orderbook[1] || []).slice(0, 5), bids = (s.orderbook[0] || []).slice(0, 5);
    const max = Math.max(1, ...[...asks, ...bids].map(l => nnum(l.sz) || 0));
    function rows(levels, side) {
      return Array.from({ length: 5 }, (_, i) => {
        const l = levels[i], px = nnum(l?.px), sz = nnum(l?.sz);
        if (!(px > 0 && sz >= 0)) return `<div class="book-row empty"><span>—</span><span>—</span><span>—</span></div>`;
        return `<div class="book-row ${side}"><div class="bar" style="width:${clamp(sz / max * 100, 0, 100)}%"></div><span>${fmt(px, 3)}</span><span>${fmt(sz, 3)}</span><span>${fmt(px * sz, 0)}</span></div>`;
      }).join('');
    }
    $('asks').innerHTML = rows(asks, 'ask');
    $('bids').innerHTML = rows(bids, 'bid');
    const spread = s.bestAsk - s.bestBid;
    $('spread').textContent = Number.isFinite(spread) && spread >= 0 ? '$' + fmt(spread, 3) : '—';
    $('spread-bps').textContent = Number.isFinite(spread) && mark() ? fmt(spread / mark() * 10000, 2) + ' bps' : '—';
    const bidQty = bids.reduce((sum, l) => sum + (nnum(l.sz) || 0), 0);
    const askQty = asks.reduce((sum, l) => sum + (nnum(l.sz) || 0), 0);
    $('obi-value').textContent = bidQty + askQty > 0 ? fmt((bidQty - askQty) / (bidQty + askQty) * 100, 1) + '% OBI' : '—';
  }
  function updatePrice(price) {
    if (!(Number.isFinite(price) && price > 0)) return;
    s.price = price;
    s.lastFeed = Date.now();
    $('price').textContent = '$' + fmt(price, 3);
    $('last-update').textContent = 'Last tick ' + utc(Date.now()) + ' UTC';
    if (s.prevDay > 0) {
      const change = (price / s.prevDay - 1) * 100;
      $('change').textContent = (change > 0 ? '+' : '') + fmt(change, 2) + '%';
      $('change').className = 'market-change ' + (change > 0 ? 'positive' : change < 0 ? 'negative' : '');
    }
    s.midHistory.push({ t: Date.now(), v: price });
    if (s.midHistory.length > 500) s.midHistory.shift();
    const candle = s.candles.at(-1), now = Date.now(), ms = ({'1m':60000,'5m':300000,'15m':900000,'1h':3600000})[s.interval];
    if (candle && now >= candle.t && now < candle.t + ms) {
      candle.c = price; candle.h = Math.max(candle.h, price); candle.l = Math.min(candle.l, price);
    }
    snapshotEquity(); renderSummary(); computeQuotes(); drawPrice(); drawEquity();
  }
  function renderHormuz() {
    const p = s.poly;
    const live = polyReady();
    const badge = $('poly-status');
    badge.className = 'status-pill ' + (live ? '' : 'offline');
    badge.innerHTML = '<i></i> ' + (live ? p.mode === 'github' ? 'GITHUB SNAPSHOT' : 'LIVE SNAPSHOT' : p.lastSuccess ? 'STALE / RETRYING' : p.error ? 'UNAVAILABLE' : 'CONNECTING');
    $('poly-composite').textContent = p.ready ? fmt(p.composite * 100, 1) + '%' : '—';
    $('poly-score').textContent = p.ready ? (p.score >= 0 ? '+' : '') + fmt(p.score, 3) : '—';
    const side = !p.ready ? '—' : p.score > 0.05 ? 'BULLISH WTI' : p.score < -0.05 ? 'BEARISH WTI' : 'NEUTRAL';
    $('poly-skew').textContent = live ? side : 'PAUSED / UNAVAILABLE';
    $('poly-model-value').textContent = live ? (p.score >= 0 ? '+' : '') + fmt(p.score, 3) : 'OFFLINE';
    for (const id of ['poly-score','poly-skew','poly-model-value']) {
      $(id).classList.toggle('bullish', live && p.score > 0.05);
      $(id).classList.toggle('bearish', live && p.score < -0.05);
    }
    $('poly-age').textContent = p.sourceAt ? (p.mode === 'github' ? 'GitHub fetch ' : 'Direct fetch ') + utc(p.sourceAt) + ' UTC · checked every ~30s' :
      'Waiting for public Polymarket data';
    $('poly-delta').textContent = Number.isFinite(p.delta) ?
      'Observed ≤15m ΔP: ' + (p.delta >= 0 ? '+' : '') + fmt(p.delta * 100, 2) + ' pp' : 'Observed ≤15m ΔP: awaiting baseline';
    $('poly-source').textContent = p.error && !live ? p.error :
      p.ready ? `${p.markets.length}/4 active deadlines · ${p.source}` : 'No usable market snapshot';
    const container = $('poly-horizons');
    container.replaceChildren();
    if (!p.markets.length) {
      const empty = document.createElement('span'); empty.className = 'poly-empty';
      empty.textContent = p.error || 'Waiting for live probabilities…'; container.append(empty);
    } else for (const h of HORMUZ.HORIZONS) {
      const m = p.markets.find(x => x.iso === h.iso);
      const el = document.createElement('div'); el.className = 'poly-horizon';
      const head = document.createElement('div'); head.className = 'poly-horizon-head';
      const label = document.createElement('span'); label.textContent = h.label;
      const value = document.createElement('strong'); value.textContent = m ? fmt(m.p * 100, 1) + '%' : '—';
      head.append(label, value);
      const bar = document.createElement('div'); bar.className = 'poly-track';
      const inner = document.createElement('span'); inner.style.width = m ? (m.p * 100) + '%' : '0%';
      bar.append(inner);
      const sub = document.createElement('small'); sub.textContent = m ? `Weight ${fmt(h.weight * 100, 0)}% · ${m.basis}` : 'Inactive or unavailable';
      el.append(head, bar, sub); container.append(el);
    }
    updateStartAvailability();
  }
  async function getPublicJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  async function fetchHormuz() {
    try {
      let event, mode = 'direct', sourceAt = Date.now();
      try {
        // Browser-direct public Gamma (might be blocked by CORS on GitHub Pages).
        event = await getPublicJson(HORMUZ.GAMMA_URL, 4000);
      } catch (directError) {
        // Automatic SAME-ORIGIN fallback, deployed by the included GitHub Actions
        // workflow from the exact Polymarket public Gamma market, without API keys.
        const snapshotUrl = new URL('data/hormuz-snapshot.json', document.baseURI).toString() + '?v=' + Date.now();
        event = await getPublicJson(snapshotUrl, 8000);
        mode = 'github';
        sourceAt = Date.parse(event.snapshotFetchedAt);
        if (!Number.isFinite(sourceAt) || sourceAt <= 0 || Date.now() - sourceAt > POLY_GITHUB_STALE_MS || sourceAt > Date.now() + 60000) {
          throw new Error('GitHub Pages Hormuz snapshot is missing, stale or invalid.');
        }
      }
      const sample = HORMUZ.readEvent(event);
      const p = s.poly;
      if (p.identity !== sample.identity) p.observations = []; // no carryover across replaced contracts
      p.identity = sample.identity;
      const now = Date.now();
      p.observations.push({ t: now, v: sample.composite });
      p.observations = p.observations.filter(x => now - x.t <= 15 * 60000);
      const baseline = p.observations.length > 1 ? p.observations[0].v : NaN;
      const signal = HORMUZ.makeSignal(sample.composite, baseline);
      p.ready = true; p.lastSuccess = now; p.error = ''; p.markets = sample.markets; p.sourceAt = sourceAt; p.mode = mode;
      p.composite = sample.composite; p.delta = signal.delta; p.score = signal.score;
      p.source = (mode === 'github' ? 'scheduled GitHub Actions · ' : 'Gamma direct · ') +
        (sample.markets.some(m => m.basis === 'indicative YES outcome price') ? 'includes indicative prices' : 'YES bid/ask midpoints');
      renderHormuz(); computeQuotes();
    } catch (err) {
      s.poly.error = 'Polymarket feed: ' + (err.name === 'AbortError' ? 'timeout' : String(err.message).slice(0, 110));
      if (!polyReady()) { if (s.running) { setRunning(false); toast('Hormuz feed unavailable or stale. Paper trading paused.'); } }
      renderHormuz();
      console.warn('Read-only Hormuz market data unavailable:', err.message);
    }
  }
  async function info(body) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(INFO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    } finally { clearTimeout(timeout); }
  }
  async function fetchContext() {
    try {
      const result = await info({ type: 'metaAndAssetCtxs', dex: DEX });
      if (!Array.isArray(result) || !Array.isArray(result[0]?.universe) || !Array.isArray(result[1])) return;
      const index = result[0].universe.findIndex(m => m.name === MARKET || m.name === 'CL');
      if (index < 0) { toast('WTI market not listed in Hyperliquid metadata.'); return; }
      const ctx = result[1][index];
      if (!ctx) return;
      const prev = nnum(ctx.prevDayPx);
      if (prev > 0) s.prevDay = prev;
      const volume = nnum(ctx.dayNtlVlm), funding = nnum(ctx.funding), oi = nnum(ctx.openInterest);
      $('volume').textContent = Number.isFinite(volume) ? compactUsd(volume) : '—';
      // Hyperliquid funding field is the current payment rate, NOT an 8-hour total.
      $('funding').textContent = Number.isFinite(funding) ? `${fmt(funding * 100, 4)}% current` : '—';
      $('open-interest').textContent = oi > 0 ? fmt(oi, 0) + ' CL' : '—';
      const px = nnum(ctx.midPx || ctx.markPx);
      if (px > 0 && !Number.isFinite(mark())) updatePrice(px);
    } catch (err) { console.warn('Public market snapshot unavailable:', err.message); }
  }
  function compactUsd(n) { if (!Number.isFinite(n)) return '—'; return n >= 1e9 ? '$' + fmt(n / 1e9, 2) + 'B' : n >= 1e6 ? '$' + fmt(n / 1e6, 2) + 'M' : n >= 1e3 ? '$' + fmt(n / 1e3, 1) + 'K' : '$' + fmt(n, 0); }
  async function fetchCandles() {
    const interval = s.interval;
    const now = Date.now(), duration = ({'1m':60000,'5m':300000,'15m':900000,'1h':3600000})[interval];
    $('chart-empty').textContent = 'Loading WTI historical candles…';
    try {
      const candles = await info({ type: 'candleSnapshot', req: { coin: MARKET, interval, startTime: now - duration * 100, endTime: now } });
      if (interval !== s.interval) return;
      if (Array.isArray(candles)) {
        s.candles = candles.map(c => ({ t: nnum(c.t), o: nnum(c.o), h: nnum(c.h), l: nnum(c.l), c: nnum(c.c) }))
          .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite) && c.c > 0).slice(-100);
      }
      $('chart-empty').classList.toggle('hidden', s.candles.length > 0);
      if (!s.candles.length) $('chart-empty').textContent = 'Historical candles currently unavailable. Live ticks will appear here.';
      drawPrice();
    } catch (err) {
      $('chart-empty').textContent = 'Candles unavailable; live ticks may still work.';
      console.warn('Public historical candles unavailable:', err.message);
    }
  }
  function connect() {
    if (s.ws && (s.ws.readyState === WebSocket.CONNECTING || s.ws.readyState === WebSocket.OPEN)) return;
    setConnection('RECONNECTING', 'Connecting to public WTI feed…');
    try {
      const ws = new WebSocket(WS_URL); s.ws = ws;
      ws.onopen = () => {
        s.reconnectAttempts = 0;
        for (const subscription of [{ type: 'l2Book', coin: MARKET }, { type: 'trades', coin: MARKET }, { type: 'allMids', dex: DEX }]) {
          ws.send(JSON.stringify({ method: 'subscribe', subscription }));
        }
      };
      ws.onmessage = ev => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.channel === 'l2Book' && msg.data?.coin === MARKET && Array.isArray(msg.data.levels)) {
          const bids = msg.data.levels[0] || [], asks = msg.data.levels[1] || [];
          const bid = nnum(bids[0]?.px), ask = nnum(asks[0]?.px);
          if (bid > 0 && ask >= bid) {
            s.orderbook = [bids, asks]; s.bestBid = bid; s.bestAsk = ask; s.lastBook = Date.now();
            if (!s.connected) { s.connected = true; setConnection('LIVE'); s.reconnectAttempts = 0; }
            updatePrice((bid + ask) / 2); renderBook();
            updateStartAvailability();
          }
        }
        if (msg.channel === 'allMids') {
          const mids = msg.data?.mids;
          const px = nnum(mids?.[MARKET] ?? mids?.CL);
          if (px > 0) updatePrice(px);
        }
        if (msg.channel === 'trades') onTrades(msg.data);
      };
      ws.onerror = () => { /* Close event handles retry and user notice. */ };
      ws.onclose = () => {
        if (s.ws !== ws) return;
        s.connected = false;
        if (s.running) { setRunning(false); toast('Market feed disconnected. Paper trading paused for safety.'); }
        s.bestBid = NaN; s.bestAsk = NaN;
        setConnection('RECONNECTING', 'Public feed disconnected; retrying…');
        updateStartAvailability();
        s.reconnectAttempts++;
        clearTimeout(s.reconnectId);
        s.reconnectId = setTimeout(connect, Math.min(30000, 1500 * 2 ** Math.min(5, s.reconnectAttempts)));
      };
    } catch { s.reconnectAttempts++; s.reconnectId = setTimeout(connect, 10000); }
  }
  function setupCanvas(id) {
    const canvas = $(id), rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    return { ctx, w: rect.width, h: rect.height };
  }
  function drawPrice() {
    const frame = setupCanvas('price-chart'); if (!frame) return;
    const { ctx, w, h } = frame, left = 7, right = 67, top = 18, bottom = 25, pw = w - left - right, ph = h - top - bottom;
    const candles = s.candles.slice(-70), tickSeries = s.midHistory.slice(-100);
    let lo, hi;
    if (candles.length) { lo = Math.min(...candles.map(c => c.l)); hi = Math.max(...candles.map(c => c.h)); }
    else if (tickSeries.length > 1) { lo = Math.min(...tickSeries.map(p => p.v)); hi = Math.max(...tickSeries.map(p => p.v)); }
    else return;
    const pad = Math.max((hi - lo) * .11, (lo || 1) * .0003);
    lo -= pad; hi += pad;
    const Y = v => top + (hi - v) / (hi - lo) * ph;
    ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.strokeStyle = '#233042'; ctx.lineWidth = 1; ctx.fillStyle = '#8394a7';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * (1 - i / 4), y = top + ph * i / 4;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - 57, y); ctx.stroke(); ctx.fillText(fmt(v, 2), w - 9, y + 4); }
    if (candles.length) {
      const dx = pw / candles.length, candleWidth = Math.max(2, Math.min(9, dx * .6));
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i], x = left + dx * (i + .5), rising = c.c >= c.o;
        ctx.strokeStyle = rising ? '#a9f184' : '#e67e85';ctx.fillStyle = rising ? '#a9f184' : '#e67e85';
        ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
        const y = Y(Math.max(c.o, c.c)), bh = Math.max(1, Math.abs(Y(c.o) - Y(c.c)));
        ctx.fillRect(x - candleWidth / 2, y, candleWidth, bh);
      }
      $('chart-start').textContent = utc(candles[0].t); $('chart-end').textContent = utc(candles.at(-1).t);
    } else if (tickSeries.length > 1) {
      ctx.beginPath(); ctx.strokeStyle = '#b5f476';ctx.lineWidth = 2;
      tickSeries.forEach((p, i) => { const x = left + pw * i / (tickSeries.length - 1); if (!i) ctx.moveTo(x, Y(p.v)); else ctx.lineTo(x, Y(p.v)); });ctx.stroke();
    }
    if (Number.isFinite(mark()) && mark() >= lo && mark() <= hi) {
      const y = Y(mark());ctx.setLineDash([3,4]); ctx.strokeStyle = '#b5f47699';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-57,y);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#baf57c';ctx.fillRect(w-57,y-9,55,18);ctx.fillStyle='#152310';ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.fillText(fmt(mark(),2),w-29,y+4);
    }
  }
  function drawEquity() {
    const frame = setupCanvas('equity-chart'); if (!frame) return;
    const { ctx, w, h } = frame, points = s.paper.equityPoints || [];
    let values = points.map(p => p.v);
    if (Number.isFinite(mark())) values = [...values, equity()];
    if (!values.length) values = [STARTING_CASH];
    const lo = Math.min(STARTING_CASH, ...values), hi = Math.max(STARTING_CASH, ...values), pad = Math.max((hi - lo) * .3, 5);
    const ymin = lo - pad, ymax = hi + pad;
    const X = i => 12 + (w - 25) * i / Math.max(1, values.length - 1);
    const Y = v => 10 + (ymax - v) / (ymax - ymin) * (h - 20);
    ctx.setLineDash([4,5]);ctx.strokeStyle='#25364a';ctx.beginPath();ctx.moveTo(0,Y(STARTING_CASH));ctx.lineTo(w,Y(STARTING_CASH));ctx.stroke();ctx.setLineDash([]);
    const positive = values.at(-1) >= STARTING_CASH, color = positive ? '#bdf17a' : '#f58b91';
    const gradient = ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,positive?'#bdf17a35':'#f58b9128');gradient.addColorStop(1,'#111a2800');
    ctx.beginPath();values.forEach((v,i)=>{if(i===0)ctx.moveTo(X(i),Y(v));else ctx.lineTo(X(i),Y(v));});ctx.lineTo(X(values.length-1),h);ctx.lineTo(X(0),h);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
    ctx.beginPath();values.forEach((v,i)=>{if(i===0)ctx.moveTo(X(i),Y(v));else ctx.lineTo(X(i),Y(v));});ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(X(values.length-1),Y(values.at(-1)),3,0,Math.PI*2);ctx.fill();
  }
  function downloadCsv() {
    if (!s.paper.fills.length) return;
    const rows = ['utc_time,side,price_usd,size_cl,notional_usd,simulated_fee_usd', ...s.paper.fills.map(t => [new Date(t.time).toISOString(),t.side,t.price,t.qty,(t.price*t.qty).toFixed(5),t.fee.toFixed(6)].join(','))];
    const blob = new Blob([rows.join('\r\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'crudeedge-paper-fills.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function init() {
    loadPaper(); renderSummary(); renderHistory(); renderBook();drawEquity();renderHormuz();
    $('year').textContent = String(new Date().getFullYear());
    $('clock').textContent = utc(Date.now()) + ' UTC';
    setInterval(() => {
      $('clock').textContent = utc(Date.now()) + ' UTC';
      if (s.connected && (Date.now() - s.lastFeed > 30000 || Date.now() - s.lastBook > 30000)) {
        s.connected = false; setConnection('RECONNECTING', 'Feed stale. Waiting for a new quote…');
        if (s.running) { setRunning(false); toast('Market feed is stale. Paper trading paused.'); }
        updateStartAvailability();
        if (s.ws?.readyState === WebSocket.OPEN) s.ws.close();
      }
      if (s.running && !readyToTrade()) {
        setRunning(false); toast('A required market-data feed is stale. Paper trading paused.');
      }
      updateStartAvailability();
      // Show stale feed state immediately, not only on the next 30-second poll.
      if (s.poly.lastSuccess && !polyReady() && $('poly-status').textContent.includes('LIVE')) renderHormuz();
      if (s.running) { snapshotEquity(); renderSummary();drawEquity(); }
    }, 1000);
    $('start-btn').addEventListener('click', () => {
      if (!readyToTrade()) return toast('Live Hyperliquid and Polymarket Hormuz data are both required.');
      if (!validateSettings()) return;
      s.lastFillAt = Date.now(); setRunning(true); toast('Paper trading started. No real orders can be placed.');
    });
    $('stop-btn').addEventListener('click', () => { setRunning(false); savePaper(); toast('Paper trading paused. Virtual positions remain marked to market.'); });
    $('reset-btn').addEventListener('click', () => $('reset-modal').showModal());
    $('confirm-reset').addEventListener('click', () => {
      setRunning(false); s.paper = initialPaper(); s.lastFillAt = Date.now(); savePaper(); renderSummary(); renderHistory();drawEquity();toast('Paper account reset to $10,000.');
    });
    $('export-btn').addEventListener('click', downloadCsv);
    $('dismiss-notice').addEventListener('click', () => { $('dismiss-notice').parentElement.remove(); });
    $('chart-interval').addEventListener('change', ev => { s.interval = ev.target.value; s.candles = []; $('chart-symbol').textContent = `WTI / USDC · ${s.interval}`; fetchCandles(); });
    ['trade-size','quote-offset','max-position'].forEach(id => $(id).addEventListener('change', validateSettings));
    const nav = Array.from(document.querySelectorAll('[data-nav]'));
    nav.forEach(a => a.addEventListener('click', () => { nav.forEach(x => x.classList.remove('active'));a.classList.add('active'); }));
    window.addEventListener('resize', () => { drawPrice(); drawEquity(); });
    window.addEventListener('beforeunload', savePaper);
    connect();fetchContext();fetchCandles();fetchHormuz();
    setInterval(fetchHormuz, POLY_POLL_MS);
    setInterval(fetchContext, 45000);
    setInterval(fetchCandles, 180000);
  }
  init();
})();
