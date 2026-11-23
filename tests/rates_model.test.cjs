const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../rates-model.js');

test('10Y yield rise creates negative oil-side exploratory signal, measured in basis points', () => {
  const p = R.rateSignal([{t:1000, v:4.50},{t:2000,v:4.55}],2000);
  assert.ok(Math.abs(p.deltaBps - 5) < 1e-7);
  assert.ok(Math.abs(p.score + 1) < 1e-7);
  assert.ok(Math.abs(R.rateSignal([{t:1000,v:4.55},{t:2000,v:4.50}],2000).score - 1) < 1e-10);
});
test('20% nominal rates actually contributes to final score, bounded, never mistaken for correlation', () => {
  assert.ok(Math.abs(R.blendScores(.5, -.5, .2) - .3) < 1e-10);
  assert.equal(R.blendScores(.5,-.5,0), .5);
  assert.ok(Number.isNaN(R.blendScores(.5,-.5,.462)));
  assert.ok(Number.isNaN(R.blendScores(.5,NaN,.2)));
});
test('out-of-window or unavailable rates cannot create fabricated score', () => {
  assert.ok(Number.isNaN(R.rateSignal([],1000).score));
  const signal = R.rateSignal([{t:0,v:4.0},{t:1000000,v:4.5}],1000000);
  assert.equal(signal.deltaBps,0);
});
test('observed local correlation requires enough genuinely new paired values', () => {
  const sample = Array.from({length:90},(_,i)=>({oil:70+0.04*Math.sin(i/6)+0.001*i,yield:5-0.0025*Math.sin(i/6)-0.00007*i,oilAt:i,yieldAt:i}));
  assert.ok(R.observedCorrelation(sample) < -.99);
  assert.ok(Number.isNaN(R.observedCorrelation(sample.map(x=>({...x,yieldAt:0})))));
});
