/* CrudeEdge — public, browser-only paper trading dashboard.
 * This file is deliberately read-only against Hyperliquid. It contains NO wallet,
 * NO private keys, NO signing code, NO /exchange API calls and NO live-order path.
 */
(() => {
  'use strict';
  const MARKET = 'xyz:CL';
  const DEX = 'xyz';
  const RATE_MARKET = 'para:10Y';
  const INFO_URL = 'https://api.hyperliquid.xyz/info';
  const WS_URL = 'wss://api.hyperliquid.xyz/ws';
  const STORAGE_KEY = 'crudeedge-public-paper-v1';
  const HORMUZ = window.CrudeEdgeHormuz;
  const RATES = window.CrudeEdgeRates;
  const POLY_STALE_MS = 120000; // Direct Gamma polling freshness.
  const POLY_GITHUB_STALE_MS = 45 * 60000; // GitHub Action schedule can be delayed.
  const POLY_POLL_MS = 30000;
  if (!HORMUZ || !RATES) throw new Error('Hormuz/rate model module missing. Trading is disabled.');
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
    chartSamples: [], historyOil: [], historyYield: [], chartHover: -1, rate: { value: NaN, bid: NaN, ask: NaN, lastAt: 0, observations: [], deltaBps: NaN, score: NaN },
    paper: initialPaper(), settings: { notional: 200, offset: 0, maxPosition: 5, rateWeight: RATES.DEFAULT_WEIGHT },
    poly: { ready: false, lastSuccess: 0, error: '', markets: [], composite: NaN,
      score: NaN, delta: NaN, identity: '', observations: [], source: '', mode: '', sourceAt: 0 }
  };
  let toastTimer;
  // Accessibility-friendly, data-driven change highlights. Never animate fake data.
  const previousLiveValues = new Map();
  function writeLive(id, content, numeric = NaN) {
    const el = $(id);
    if (!el) return;
    const value = String(content);
    if (el.textContent === value) return;
    const previous = previousLiveValues.get(id);
    el.textContent = value;
    el.classList.remove('value-flash-up', 'value-flash-down', 'value-flash-neutral');
    if (previous && Number.isFinite(previous.value) && Number.isFinite(numeric) && Math.abs(numeric - previous.value) > 1e-12) {
      // Reset the animation when successive genuine ticks arrive.
      void el.offsetWidth;
      el.classList.add(numeric > previous.value ? 'value-flash-up' : 'value-flash-down');
    } else if (previous && previous.text !== value) {
      void el.offsetWidth;
      el.classList.add('value-flash-neutral');
    }
    previousLiveValues.set(id, { text: value, value: numeric });
  }
  function renderLiveInputBoard() {
    const mid = bookMid();
    const spread = s.bestAsk - s.bestBid;
    const bids = (s.orderbook[0] || []).slice(0, 5), asks = (s.orderbook[1] || []).slice(0, 5);
    const bq = bids.reduce((sum, l) => sum + (nnum(l.sz) || 0), 0);
    const aq = asks.reduce((sum, l) => sum + (nnum(l.sz) || 0), 0);
    const imbalance = bq + aq > 0 ? (bq - aq) / (bq + aq) : NaN;
    writeLive('input-best-bid', Number.isFinite(s.bestBid) ? '$' + fmt(s.bestBid, 3) : '—', s.bestBid);
    writeLive('input-best-ask', Number.isFinite(s.bestAsk) ? '$' + fmt(s.bestAsk, 3) : '—', s.bestAsk);
    writeLive('input-spread', Number.isFinite(spread) && spread >= 0 ? '$' + fmt(spread, 3) : '—', spread);
    writeLive('input-obi', Number.isFinite(imbalance) ? fmt(imbalance * 100, 1) + '%' : '—', imbalance);
    const validPoly = polyReady();
    writeLive('input-hormuz', validPoly ? fmt(s.poly.composite * 100, 2) + '%' : '—', validPoly ? s.poly.composite : NaN);
    writeLive('input-delta', validPoly && Number.isFinite(s.poly.delta) ? (s.poly.delta >= 0 ? '+' : '') + fmt(s.poly.delta * 100, 2) + ' pp' : '—', validPoly ? s.poly.delta : NaN);
    writeLive('input-score', validPoly ? (s.poly.score >= 0 ? '+' : '') + fmt(s.poly.score, 3) : '—', validPoly ? s.poly.score : NaN);
    writeLive('input-inventory', fmt(s.paper.position, 3) + ' CL', s.paper.position);
    const hasRate = rateReady();
    const combined = combinedScore();
    writeLive('input-rate', hasRate ? fmt(s.rate.value, 4) + '%' : '—', hasRate ? s.rate.value : NaN);
    writeLive('input-rate-delta', hasRate ? (s.rate.deltaBps >= 0 ? '+' : '') + fmt(s.rate.deltaBps, 2) + ' bp' : '—', hasRate ? s.rate.deltaBps : NaN);
    writeLive('input-rate-score', hasRate ? (s.rate.score >= 0 ? '+' : '') + fmt(s.rate.score, 3) : '—', hasRate ? s.rate.score : NaN);
    writeLive('input-rate-weight', fmt(s.settings.rateWeight * 100, 0) + '%', s.settings.rateWeight);
    writeLive('input-combined-score', Number.isFinite(combined) ? (combined >= 0 ? '+' : '') + fmt(combined, 3) : '—', combined);
    const localCorr = RATES.observedCorrelation(s.chartSamples.slice(-600));
    writeLive('input-local-corr', Number.isFinite(localCorr) ? fmt(localCorr, 3) + ' · exploratory' : '— · need paired ticks', localCorr);
    const tilt = Number.isFinite(combined) ? HORMUZ.quoteTilt(combined, s.settings.notional, s.settings.offset) : null;
    const bidNotional = s.quoteQtyBid > 0 && Number.isFinite(s.quoteBid) ? s.quoteQtyBid * s.quoteBid : NaN;
    const askNotional = s.quoteQtyAsk > 0 && Number.isFinite(s.quoteAsk) ? s.quoteQtyAsk * s.quoteAsk : NaN;
    writeLive('input-bid-offset', tilt ? fmt(tilt.bidOffsetBps, 2) : '—', tilt?.bidOffsetBps);
    writeLive('input-ask-offset', tilt ? fmt(tilt.askOffsetBps, 2) : '—', tilt?.askOffsetBps);
    writeLive('input-bid-notional', Number.isFinite(bidNotional) ? dollars(bidNotional) : '—', bidNotional);
    writeLive('input-ask-notional', Number.isFinite(askNotional) ? dollars(askNotional) : '—', askNotional);
    writeLive('quote-step-prob', validPoly ? fmt(s.poly.composite * 100, 1) + '%' : '—', validPoly ? s.poly.composite : NaN);
    writeLive('quote-step-score', Number.isFinite(combined) ? (combined >= 0 ? '+' : '') + fmt(combined, 3) : '—', combined);
    writeLive('quote-step-rate', hasRate ? (s.rate.score >= 0 ? '+' : '') + fmt(s.rate.score, 3) : '—', hasRate ? s.rate.score : NaN);
    writeLive('quote-step-bid-offset', tilt ? fmt(tilt.bidOffsetBps, 2) + ' bps' : '—', tilt?.bidOffsetBps);
    writeLive('quote-step-ask-offset', tilt ? fmt(tilt.askOffsetBps, 2) + ' bps' : '—', tilt?.askOffsetBps);
    $('flow-feed-stamp').textContent = marketReady() && validPoly && hasRate ? 'All three feeds current · ' + utc(Date.now()) + ' UTC' : 'Awaiting WTI + Hormuz + 10Y feeds';
    $('quote-last-updated').textContent = s.running && readyToTrade() && s.quoteActivatedAt ?
      'updated ' + fmt((Date.now() - s.quoteActivatedAt) / 1000, 1) + 's ago' : 'Start paper trading to post virtual quotes';
    renderMathNotebook();
  }

  // This is the same arithmetic used by computeQuotes(), shown term-by-term.
  // The display is never an independent alternative "research-only" formula.
  function renderMathNotebook() {
    const okH = polyReady(), okR = rateReady();
    const p = s.poly.composite, delta = s.poly.delta;
    const safeTrend = Number.isFinite(delta) ? clamp(-delta / .05, -1, 1) : 0;
    const h = s.poly.score, r = s.rate.score, w = s.settings.rateWeight;
    const score = combinedScore();
    const f = (x, digits = 4) => fmt(x, digits);
    const signed = x => Math.abs(x)<0.000000001 ? f(0) : (x > 0 ? '+' : '') + f(x);
    const value = (id, str, num = NaN) => writeLive(id, str, num);
    const valid = okH && okR && Number.isFinite(score);
    value('math-p', okH ? `( ${s.poly.markets.map(m => `${f(m.weight, 2)}×${f(m.p, 3)}`).join(' + ')} ) / ${f(s.poly.markets.reduce((z, m) => z + m.weight, 0), 2)} = ${f(p)}` : '— awaiting Hormuz deadlines', okH ? p : NaN);
    const baseP = Number.isFinite(delta) ? p - delta : p;
    value('math-dp', okH ? `${f(p)} − ${f(baseP)} = ${Number.isFinite(delta) ? signed(delta) : '0.0000 (initial baseline)'}` : '—', Number.isFinite(delta) ? delta : NaN);
    value('math-h', okH ? `clip[0.25×(1−2×${f(p)}) + 0.75×${f(safeTrend)}] = ${signed(h)}` : '—', okH ? h : NaN);
    const records = s.rate.observations;
    const firstY = records.length ? records[0].v : NaN;
    value('math-y', okR ? `100×(${f(s.rate.value, 4)} − ${f(firstY, 4)}) = ${signed(s.rate.deltaBps)} bp` : '— awaiting live 10Y yield', okR ? s.rate.deltaBps : NaN);
    value('math-r', okR ? `clip(−${f(s.rate.deltaBps, 3)} / 5) = ${signed(r)}` : '—', okR ? r : NaN);
    value('math-s', valid ? `(${f(1-w,2)}×${f(h)}) + (${f(w,2)}×${f(r)}) = ${signed(score)}` : '— three fresh inputs required', score);
    const tilt = valid ? HORMUZ.quoteTilt(score, s.settings.notional, s.settings.offset) : null;
    const d0 = s.settings.offset;
    value('math-db', tilt ? `${f(d0,2)} + 3×${f(Math.max(0,-score),4)} = ${f(tilt.bidOffsetBps,3)} bps` : '—', tilt?.bidOffsetBps);
    value('math-da', tilt ? `${f(d0,2)} + 3×${f(Math.max(0,score),4)} = ${f(tilt.askOffsetBps,3)} bps` : '—', tilt?.askOffsetBps);
    const quoteValid = s.running && readyToTrade() && tilt;
    value('math-bid', quoteValid ? `${f(s.bestBid,3)} × (1 − ${f(tilt.bidOffsetBps,3)}/10,000) = $${f(s.quoteBid,3)}` : '— start paper trading for a live quote', quoteValid ? s.quoteBid : NaN);
    value('math-ask', quoteValid ? `${f(s.bestAsk,3)} × (1 + ${f(tilt.askOffsetBps,3)}/10,000) = $${f(s.quoteAsk,3)}` : '— start paper trading for a live quote', quoteValid ? s.quoteAsk : NaN);
    value('math-nb', tilt ? `${f(s.settings.notional,2)} × (1 + 0.6×${f(score)}) = ${dollars(tilt.bidNotional)}` : '—', tilt?.bidNotional);
    value('math-na', tilt ? `${f(s.settings.notional,2)} × (1 − 0.6×${f(score)}) = ${dollars(tilt.askNotional)}` : '—', tilt?.askNotional);
    value('math-result-bid', quoteValid && s.quoteQtyBid > 0 ? `BID $${f(s.quoteBid,3)} / ${f(s.quoteQtyBid,3)} CL` : 'BID —', s.quoteBid);
    value('math-result-ask', quoteValid && s.quoteQtyAsk > 0 ? `ASK $${f(s.quoteAsk,3)} / ${f(s.quoteQtyAsk,3)} CL` : 'ASK —', s.quoteAsk);
    $('math-tick').textContent = valid ? `LIVE · ${utc(Date.now())} UTC` : 'WAITING FOR FRESH INPUTS';
    writeLive('poly-model-value',valid?signed(score):'OFFLINE',valid?score:NaN);
  }

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
        const savedWeight = nnum(stored.settings.rateWeight);
        s.settings.rateWeight = Number.isFinite(savedWeight) ? clamp(savedWeight, 0, RATES.MAX_WEIGHT) : RATES.DEFAULT_WEIGHT;
      }
      $('trade-size').value = s.settings.notional;
      $('quote-offset').value = s.settings.offset;
      $('max-position').value = s.settings.maxPosition;
      $('rate-weight').value = String(Math.round(s.settings.rateWeight * 100));
      $('rate-weight-display').textContent = fmt(s.settings.rateWeight * 100, 0) + '%';
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
  function rateReady() {
    return s.connected && Number.isFinite(s.rate.value) && s.rate.value > 0 && Number.isFinite(s.rate.score) &&
      Date.now() - s.rate.lastAt >= -1000 && Date.now() - s.rate.lastAt < 60000;
  }
  function combinedScore() { return rateReady() && polyReady() ? RATES.blendScores(s.poly.score, s.rate.score, s.settings.rateWeight) : NaN; }
  function readyToTrade() { return marketReady() && polyReady() && rateReady() && Number.isFinite(combinedScore()); }
  function updateStartAvailability() {
    $('start-btn').disabled = !readyToTrade();
    const waiting = !marketReady() ? 'Waiting for live Hyperliquid WTI book' :
      !polyReady() ? 'Waiting for live Polymarket Hormuz snapshot' :
      !rateReady() ? 'Waiting for live Hyperliquid para:10Y yield' : 'All three inputs ready · paper trades only';
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
    ['trade-size', 'quote-offset', 'max-position', 'rate-weight', 'chart-interval'].forEach(id => { if (id !== 'chart-interval') $(id).disabled = running; });
    computeQuotes();
  }
  function validateSettings() {
    const notional = nnum($('trade-size').value), offset = nnum($('quote-offset').value), maxPosition = nnum($('max-position').value);
    if (![notional, offset, maxPosition].every(Number.isFinite) || notional < 10 || notional > 10000 || offset < 0 || offset > 50 || maxPosition < .1 || maxPosition > 100) {
      toast('Invalid settings. Check the allowed ranges.'); return false;
    }
    const rateWeight = nnum($('rate-weight').value) / 100;
    if (!Number.isFinite(rateWeight) || rateWeight < 0 || rateWeight > RATES.MAX_WEIGHT) { toast('Interest weight must be 0–40%.'); return false; }
    s.settings = { notional, offset, maxPosition, rateWeight };
    $('rate-weight-display').textContent = fmt(rateWeight * 100, 0) + '%';
    savePaper(); computeQuotes(); return true;
  }
  function computeQuotes() {
    const prior = [s.quoteBid, s.quoteAsk, s.quoteQtyBid, s.quoteQtyAsk];
    s.quoteBid = NaN; s.quoteAsk = NaN; s.quoteQtyBid = 0; s.quoteQtyAsk = 0;
    if (s.running && readyToTrade()) {
      const { notional, offset, maxPosition } = s.settings;
      // Both Hormuz and observed nominal 10Y yield movements feed the SAME live
      // paper quote formula. 20% is a tunable heuristic, NOT a literature estimate.
      const tilt = HORMUZ.quoteTilt(combinedScore(), notional, offset);
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
    writeLive('quote-bid', s.quoteQtyBid > .000001 ? '$' + fmt(s.quoteBid, 3) : '—', s.quoteBid);
    writeLive('quote-ask', s.quoteQtyAsk > .000001 ? '$' + fmt(s.quoteAsk, 3) : '—', s.quoteAsk);
    $('quote-bid-size').textContent = s.quoteQtyBid > .000001 ? fmt(s.quoteQtyBid, 3) + ' CL · virtual limit' : 'No active order';
    $('quote-ask-size').textContent = s.quoteQtyAsk > .000001 ? fmt(s.quoteQtyAsk, 3) + ' CL · virtual limit' : 'No active order';
    renderLiveInputBoard();
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
    writeLive('equity', dollars(e), e);
    writeLive('pnl', (pnl > 0 ? '+' : '') + dollars(pnl), pnl);
    $('pnl').className = 'stat-value ' + (pnl > .00001 ? 'positive' : pnl < -.00001 ? 'negative' : '');
    $('pnl-sub').textContent = `${fmt(pnl / STARTING_CASH * 100)}% total return`;
    $('position').innerHTML = `${fmt(p.position, 3)} <small>CL</small>`;
    $('position-sub').textContent = p.position > 0 ? `LONG · avg entry $${fmt(p.avgEntry, 3)}` : p.position < 0 ? `SHORT · avg entry $${fmt(p.avgEntry, 3)}` : 'No open position';
    writeLive('fill-count', String(p.fills.length), p.fills.length);
    $('fill-sub').textContent = p.fills.length ? `Last fill ${utc(p.fills.at(-1).time)} UTC` : 'Awaiting first paper trade';
    writeLive('input-inventory', fmt(p.position, 3) + ' CL', p.position);
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
    renderLiveInputBoard();
  }
  function updatePrice(price) {
    if (!(Number.isFinite(price) && price > 0)) return;
    s.price = price;
    s.lastFeed = Date.now();
    writeLive('price', '$' + fmt(price, 3), price);
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
    writeLive('poly-composite', p.ready ? fmt(p.composite * 100, 1) + '%' : '—', p.composite);
    writeLive('poly-score', p.ready ? (p.score >= 0 ? '+' : '') + fmt(p.score, 3) : '—', p.score);
    const side = !p.ready ? '—' : p.score > 0.05 ? 'BULLISH WTI' : p.score < -0.05 ? 'BEARISH WTI' : 'NEUTRAL';
    $('poly-skew').textContent = live ? side : 'PAUSED / UNAVAILABLE';
    const both = combinedScore();
    $('poly-model-value').textContent = Number.isFinite(both) ? (both >= 0 ? '+' : '') + fmt(both, 3) : 'OFFLINE';
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
  function onRateBook(data) {
    const levels = data?.levels;
    const bid = nnum(levels?.[0]?.[0]?.px), ask = nnum(levels?.[1]?.[0]?.px);
    if (!(bid > 0 && ask >= bid)) return;
    const mid = (bid + ask) / 2;
    const now = Date.now();
    s.rate.bid = bid; s.rate.ask = ask; s.rate.value = mid; s.rate.lastAt = now;
    const records = s.rate.observations;
    // Only record genuinely changed quotes as a new economic observation.
    if (!records.length || records.at(-1).v !== mid) records.push({ t: now, v: mid });
    while (records.length > 1 && records[0].t < now - RATES.WINDOW_MS) records.shift();
    if (records.length > 900) records.splice(0, records.length - 900);
    const model = RATES.rateSignal(records, now);
    s.rate.deltaBps = model.deltaBps; s.rate.score = model.score;
    writeLive('price-proxy', fmt(mid, 4) + '%', mid);
    $('para-status').textContent = 'Live U.S. 10Y yield · bid ' + fmt(bid, 4) + '% / ask ' + fmt(ask, 4) + '% · ' + utc(now) + ' UTC';
    $('rate-feed-label').textContent = '10Y tick ' + utc(now) + ' UTC';
    updateStartAvailability(); computeQuotes(); drawPrice();
  }
  async function fetchTenY() {
    // A periodic safety fallback; one-second redraw does NOT mean one-second HTTP polling.
    // WebSocket l2Book is the primary low-latency source of genuine quote events.
    if (Date.now() - s.rate.lastAt < 12000) return;
    try {
      const result = await info({ type: 'l2Book', coin: RATE_MARKET });
      onRateBook(result);
    } catch (err) {
      if (!rateReady()) {
        $('para-status').textContent = '10Y quote unavailable or stale; paper trading blocked';
        $('rate-feed-label').textContent = '10Y feed stale';
      }
      console.warn('Public 10Y yield unavailable:', String(err?.message || err));
    }
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
  async function fetchDualHistory() {
    // Historical *actual* 1-minute closes for both instruments. These timestamps
    // are plotted alongside the one-second latest-quote samples, never interpolated.
    const now = Date.now();
    const startTime = now - 65 * 60000;
    const load = async (coin) => {
      const raw = await info({ type: 'candleSnapshot', req: { coin, interval: '1m', startTime, endTime: now } });
      if (!Array.isArray(raw)) return [];
      return raw.map(x=>({t:nnum(x.t), v:nnum(x.c)}))
        .filter(x=>Number.isFinite(x.t) && Number.isFinite(x.v) && x.v>0 && x.t<=now && x.t>=startTime)
        .sort((a,b)=>a.t-b.t).slice(-65);
    };
    const results=await Promise.allSettled([load(MARKET),load(RATE_MARKET)]);
    if(results[0].status==='fulfilled' && results[0].value.length) s.historyOil=results[0].value;
    if(results[1].status==='fulfilled' && results[1].value.length) s.historyYield=results[1].value;
    if(results.some(x=>x.status==='rejected')) console.info('One or both historical candle feeds unavailable: live 1-second quotes still work.');
    drawPrice();
  }
  function connect() {
    if (s.ws && (s.ws.readyState === WebSocket.CONNECTING || s.ws.readyState === WebSocket.OPEN)) return;
    setConnection('RECONNECTING', 'Connecting to public WTI feed…');
    try {
      const ws = new WebSocket(WS_URL); s.ws = ws;
      ws.onopen = () => {
        s.reconnectAttempts = 0;
        for (const subscription of [{ type: 'l2Book', coin: MARKET }, { type: 'trades', coin: MARKET }, { type: 'allMids', dex: DEX }, { type: 'l2Book', coin: RATE_MARKET }]) {
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
        if (msg.channel === 'l2Book' && msg.data?.coin === RATE_MARKET) onRateBook(msg.data);
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
  const CHART_WINDOWS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 };
  let lastChartView = null;
  function sampleChart() {
    // Every second records the newest ACTUAL observed quote, with original event
    // timestamps. Unchanged quotes are explicitly held, not invented ticks.
    const now = Date.now();
    const freshOil = marketReady() && Date.now()-s.lastFeed < 30000;
    const freshYield = rateReady();
    if (!freshOil && !freshYield) return;
    const obs = { t: now, oil: freshOil ? mark() : NaN,
      yield: freshYield ? s.rate.value : NaN,
      oilAt: freshOil ? s.lastFeed : 0, yieldAt: freshYield ? s.rate.lastAt : 0 };
    s.chartSamples.push(obs);
    while (s.chartSamples.length > 3600) s.chartSamples.shift();
    $('chart-empty').classList.add('hidden');
  }
  function chartTimeLabel(t) {
    return new Date(t).toLocaleTimeString('en-GB', {timeZone:'UTC', hour12:false});
  }
  function setupChartHover() {
    const canvas = $('price-chart');
    function move(clientX) {
      if (!lastChartView?.data?.length) return;
      const box = canvas.getBoundingClientRect();
      const x = clientX - box.left;
      const v = lastChartView;
      const target = v.start + clamp((x-v.left)/v.width, 0, 1)*(v.end-v.start);
      let chosen = v.data[0]; let d = Infinity;
      for (const point of v.data) { const nd = Math.abs(point.t-target); if (nd<d) { chosen=point; d=nd; } }
      s.chartHover = chosen.t;
      drawPrice();
    }
    canvas.addEventListener('pointermove', ev => move(ev.clientX));
    canvas.addEventListener('pointerleave', () => { s.chartHover = -1; $('chart-hover-tooltip').classList.add('hidden'); drawPrice(); });
    canvas.addEventListener('focus', () => {
      if (lastChartView?.data?.length) { s.chartHover = lastChartView.data.at(-1).t; drawPrice(); }
    });
    canvas.addEventListener('blur', () => { s.chartHover = -1; $('chart-hover-tooltip').classList.add('hidden'); drawPrice(); });
    canvas.addEventListener('keydown', ev => {
      if (!['ArrowLeft','ArrowRight','Escape'].includes(ev.key)) return;
      ev.preventDefault();
      if (ev.key === 'Escape') { s.chartHover = -1; $('chart-hover-tooltip').classList.add('hidden'); drawPrice(); return; }
      const pts = lastChartView?.data || []; if (!pts.length) return;
      const currentIndex = pts.findIndex(x => x.t === s.chartHover);
      const index = currentIndex < 0 ? pts.length-1 : clamp(currentIndex + (ev.key==='ArrowLeft'?-1:1),0,pts.length-1);
      s.chartHover = pts[index].t; drawPrice();
    });
  }
  function drawPrice() {
    const frame = setupCanvas('price-chart'); if (!frame) return;
    const { ctx, w, h } = frame;
    const left=74, right=79, top=46, bottom=45;
    const width=Math.max(50,w-left-right), height=Math.max(50,h-top-bottom);
    const end=Date.now(), span=CHART_WINDOWS[s.interval] || 300000, start=end-span;
    const live=s.chartSamples.filter(x=>x.t>=start && x.t<=end);
    const oilPoints=[...s.historyOil.filter(x=>x.t>=start&&x.t<=end).map(x=>({t:x.t,oil:x.v})),
       ...live.filter(x=>Number.isFinite(x.oil)).map(x=>({t:x.t,oil:x.oil}))].sort((a,b)=>a.t-b.t);
    const yieldPoints=[...s.historyYield.filter(x=>x.t>=start&&x.t<=end).map(x=>({t:x.t,yield:x.v})),
       ...live.filter(x=>Number.isFinite(x.yield)).map(x=>({t:x.t,yield:x.yield}))].sort((a,b)=>a.t-b.t);
    // Aligned tooltip inputs: as-of last genuine quote at or before each timestamp.
    const times=[...new Set([...oilPoints.map(x=>x.t),...yieldPoints.map(x=>x.t)])].sort((a,b)=>a-b);
    let oi=-1,ri=-1;
    const data=times.map(t=>{
      while(oi+1<oilPoints.length&&oilPoints[oi+1].t<=t) oi++;
      while(ri+1<yieldPoints.length&&yieldPoints[ri+1].t<=t) ri++;
      return {t,oil:oi>=0?oilPoints[oi].oil:NaN,yield:ri>=0?yieldPoints[ri].yield:NaN};
    });
    lastChartView={data,left,width,start,end};
    const oil=oilPoints, rates=yieldPoints;
    const oilValues=oil.map(x=>x.oil), yieldValues=rates.map(x=>x.yield);
    function scale(vals, fallback, minPad) {
      let lo=vals.length?Math.min(...vals):fallback, hi=vals.length?Math.max(...vals):fallback;
      const pad=Math.max((hi-lo)*.22, minPad);
      return {lo:lo-pad,hi:hi+pad,y:v=>top+(hi+pad-v)/(hi-lo+2*pad)*height};
    }
    const oilAxis=scale(oilValues,mark() || 70,Math.max(.02,(mark()||70)*.0002));
    const rateAxis=scale(yieldValues,s.rate.value || 4.5,.002);
    const X=t=>left+clamp((t-start)/span,0,1)*width;
    ctx.font='11px ui-monospace, monospace';
    for(let i=0;i<=5;i++) {
      const y=top+height*i/5;
      ctx.strokeStyle='rgba(43,105,167,.16)';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+width,y);ctx.stroke();
      const ov=oilAxis.hi+(oilAxis.lo-oilAxis.hi)*i/5;
      const rv=rateAxis.hi+(rateAxis.lo-rateAxis.hi)*i/5;
      ctx.textAlign='right';ctx.fillStyle='#a63148';ctx.fillText('$'+fmt(ov,2),left-7,y+4);
      ctx.textAlign='left';ctx.fillStyle='#185eab';ctx.fillText(fmt(rv,3)+'%',left+width+8,y+4);
    }
    for(let i=0;i<=5;i++) {
      const x=left+width*i/5;
      ctx.strokeStyle='rgba(43,105,167,.1)';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+height);ctx.stroke();
      ctx.textAlign='center';ctx.fillStyle='#58718a';
      ctx.fillText(chartTimeLabel(start+span*i/5).slice(0,5),x,top+height+22);
    }
    function trace(points, field, scaleFn, color) {
      if (!points.length) return null;
      ctx.beginPath();
      for(let i=0;i<points.length;i++) {const x=X(points[i].t),y=scaleFn(points[i][field]);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
      ctx.lineCap='round';ctx.lineJoin='round';
      ctx.strokeStyle=color==='oil'?'rgba(195,55,82,.12)':'rgba(26,104,185,.12)';ctx.lineWidth=7;ctx.stroke();
      ctx.strokeStyle=color==='oil'?'#c74252':'#1c73c4';ctx.lineWidth=2.9;ctx.stroke();
      const last=points.at(-1), x=X(last.t), y=scaleFn(last[field]);
      ctx.fillStyle=color==='oil'?'#c74252':'#1c73c4';ctx.beginPath();ctx.arc(x,y,4.6,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#fff9ed';ctx.lineWidth=1.6;ctx.stroke();
      return {x,y,last};
    }
    const oilEnd=trace(oil,'oil',oilAxis.y,'oil');
    const yieldEnd=trace(rates,'yield',rateAxis.y,'rate');
    function cursor(id, point, valid) {
      const el=$(id);
      if(point && valid) {
        el.style.left=(point.x-122)+'px';el.style.top=(point.y-14)+'px';
        el.classList.remove('hidden');
      } else el.classList.add('hidden');
    }
    cursor('pencil-cursor',oilEnd,marketReady());
    cursor('rate-pencil-cursor',yieldEnd,rateReady());
    $('chart-pencil-live').textContent='✎ One-second redraw · red WTI ($) · blue 10Y (%) · only real quotes change';
    $('chart-start').textContent=chartTimeLabel(start)+' UTC';
    $('chart-end').textContent=chartTimeLabel(end)+' UTC';
    // Tooltips and crosshair use the exact recorded sampled quote and its event timestamp.
    const tooltip=$('chart-hover-tooltip');
    const closest=s.chartHover>=0&&data.length ? data.reduce((best,p)=>Math.abs(p.t-s.chartHover)<Math.abs(best.t-s.chartHover)?p:best,data[0]) : null;
    if(closest) {
      const x=X(closest.t);
      ctx.setLineDash([4,5]);ctx.strokeStyle='rgba(18,55,84,.5)';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+height);ctx.stroke();ctx.setLineDash([]);
      for(const [field,axis,color] of [['oil',oilAxis,'#c74252'],['yield',rateAxis,'#1c73c4']]) {
        if (!Number.isFinite(closest[field])) continue;
        ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,axis.y(closest[field]),5,0,Math.PI*2);ctx.fill();
      }
      tooltip.textContent=`${chartTimeLabel(closest.t)} UTC · WTI: ${Number.isFinite(closest.oil)?'$'+fmt(closest.oil,3):'—'} · 10Y: ${Number.isFinite(closest.yield)?fmt(closest.yield,4)+'%':'—'} · last observed at/as-of time`;
      tooltip.style.left=clamp(x-120,8,w-265)+'px';
      tooltip.style.top=Math.max(8,top-31)+'px';
      tooltip.classList.remove('hidden');
    } else tooltip.classList.add('hidden');
    $('chart-empty').classList.toggle('hidden',data.length>0);
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
    ctx.setLineDash([4,5]);ctx.strokeStyle='rgba(30,77,120,.22)';ctx.beginPath();ctx.moveTo(0,Y(STARTING_CASH));ctx.lineTo(w,Y(STARTING_CASH));ctx.stroke();ctx.setLineDash([]);
    const positive = values.at(-1) >= STARTING_CASH, color = positive ? '#28875a' : '#c44c5b';
    const gradient = ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,positive?'#28875a30':'#c44c5b26');gradient.addColorStop(1,'#ffffff00');
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
      sampleChart(); drawPrice();
      if (s.running && !readyToTrade()) {
        setRunning(false); toast('A required market-data feed is stale. Paper trading paused.');
      }
      updateStartAvailability();
      renderLiveInputBoard();
      // Show stale feed state immediately, not only on the next 30-second poll.
      if (s.poly.lastSuccess && !polyReady() && $('poly-status').textContent.includes('LIVE')) renderHormuz();
      if (s.running) { snapshotEquity(); renderSummary();drawEquity(); }
    }, 1000);
    $('start-btn').addEventListener('click', () => {
      if (!readyToTrade()) return toast('Live WTI, Polymarket Hormuz and para:10Y data are all required.');
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
    $('chart-interval').addEventListener('change', ev => { s.interval = ev.target.value; $('chart-symbol').textContent = `WTI / USD · last ${s.interval} · 10Y yield (%)`; drawPrice(); });
    $('rate-weight').addEventListener('input', ev => { s.settings.rateWeight = clamp(nnum(ev.target.value) / 100, 0, RATES.MAX_WEIGHT); $('rate-weight-display').textContent = fmt(s.settings.rateWeight * 100,0) + '%'; computeQuotes(); });
    $('rate-weight').addEventListener('change', () => { savePaper(); });
    ['trade-size','quote-offset','max-position'].forEach(id => $(id).addEventListener('change', validateSettings));
    const nav = Array.from(document.querySelectorAll('[data-nav]'));
    nav.forEach(a => a.addEventListener('click', () => { nav.forEach(x => x.classList.remove('active'));a.classList.add('active'); }));
    setupChartHover();
    window.addEventListener('resize', () => { drawPrice(); drawEquity(); });
    window.addEventListener('beforeunload', savePaper);
    sampleChart(); connect();fetchContext();fetchHormuz();fetchTenY();fetchDualHistory();
    setInterval(fetchHormuz, POLY_POLL_MS);
    setInterval(fetchContext, 45000);
    setInterval(fetchTenY, 12000);
    setInterval(fetchDualHistory, 120000);

  }
  init();
})();
