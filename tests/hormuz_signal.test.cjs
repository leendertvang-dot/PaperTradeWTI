const assert = require('node:assert/strict');
const {EVENT_SLUG, HORIZONS, readEvent, makeSignal, quoteTilt } = require('../hormuz-signal.js');
const now = Date.parse('2026-11-23T19:00:00Z');
const dates = ['January 31, 2027', 'March 31, 2027', 'June 30, 2027', 'December 31, 2027'];
const prices = [0.06, 0.14, 0.26, 0.34];
const event = {
  id: 'demo-event-id', slug: EVENT_SLUG, title: 'Strait of Hormuz traffic returns to normal by...?',
  markets: dates.map((date, i) => ({
    id: `m-${i}`, groupItemTitle: date, question: `Strait of Hormuz traffic returns to normal by ${date}?`,
    active: true, closed: false, outcomes: '["Yes","No"]', outcomePrices: JSON.stringify([prices[i], 1-prices[i]])
  }))
};
const reading = readEvent(event, now);
assert.equal(reading.markets.length, 4);
assert.deepEqual(reading.markets.map(x => x.iso), HORIZONS.map(x => x.iso));
const expectedComposite = 0.4 * 0.06 + 0.3 * 0.14 + 0.2 * 0.26 + 0.1 * 0.34;
assert.ok(Math.abs(reading.composite - expectedComposite) < 1e-10);
assert.equal(reading.markets[0].basis, 'indicative YES outcome price');
assert.equal(makeSignal(reading.composite).delta !== makeSignal(reading.composite).delta, true); // NaN baseline
assert.ok(makeSignal(reading.composite).score > 0); // lower odds of normalization -> bullish-risk heuristic
assert.ok(makeSignal(0.15, 0.20).score > makeSignal(0.15, 0.15).score); // falling normalization odds -> higher oil-risk score
assert.ok(makeSignal(0.20, 0.15).score < makeSignal(0.20, 0.20).score);
const tilt = quoteTilt(0.6, 200, 1.0);
assert.ok(tilt.bidNotional > tilt.askNotional);
assert.ok(tilt.askOffsetBps > tilt.bidOffsetBps);
const tiltBear = quoteTilt(-0.6, 200, 1.0);
assert.ok(tiltBear.bidNotional < tiltBear.askNotional);
assert.ok(tiltBear.bidOffsetBps > tiltBear.askOffsetBps);
assert.throws(() => readEvent({ ...event, slug:'another-event' }, now), /identity/);
assert.throws(() => readEvent({ ...event, markets: event.markets.slice(0,1) }, now), /Fewer than two/);
const closed = structuredClone(event); closed.markets[0].closed = true;
const closedReading = readEvent(closed, now);
const expectedRenormalized = (0.3 * .14 + 0.2 * .26 + 0.1 * .34) / .6;
assert.ok(Math.abs(closedReading.composite - expectedRenormalized) < 1e-10);
const quoted = structuredClone(event);
quoted.markets[0].bestBid = 0.03; quoted.markets[0].bestAsk = 0.05;
assert.ok(Math.abs(readEvent(quoted, now).markets[0].p - .04) < 1e-10);
const malformed = structuredClone(event); malformed.markets[1].outcomes = '["Maybe","No"]';
assert.equal(readEvent(malformed, now).markets.length, 3);
assert.throws(() => readEvent(event, Date.parse('2027-07-01T00:00:00Z')), /Fewer than two/);

// A different explicit year must NEVER be silently mapped to a 2027 contract.
const mixedYear = structuredClone(event);
mixedYear.markets[0].groupItemTitle = 'January 31, 2026';
mixedYear.markets[0].question = 'Strait of Hormuz traffic returns to normal by January 31, 2026?';
const withoutWrongYear = readEvent(mixedYear, now);
assert.equal(withoutWrongYear.markets.length, 3);
assert.equal(withoutWrongYear.markets.some(m => m.iso === '2027-01-31'), false);
const wrongYears = structuredClone(mixedYear);
wrongYears.markets[1].groupItemTitle = 'March 31, 2026';
wrongYears.markets[1].question = 'Strait of Hormuz traffic returns to normal by March 31, 2026?';
wrongYears.markets[2].closed = true;
assert.throws(() => readEvent(wrongYears, now), /Fewer than two/);
// An explicitly 2027-dated market still matches even with a different expiry date.
const datesWithDifferentExpiry = structuredClone(event);
datesWithDifferentExpiry.markets[3].endDate = '2028-01-01T00:00:00Z';
assert.equal(readEvent(datesWithDifferentExpiry, now).markets.length, 4);
