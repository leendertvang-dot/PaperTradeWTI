#!/usr/bin/env python3
"""GitHub Actions: download public Polymarket event data, validate, publish sanitized snapshot.
Uses only the public Gamma GET endpoint; never reads env vars, wallet keys or GitHub secrets.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

SLUG = 'strait-of-hormuz-traffic-returns-to-normal-byptptpt'
URL = f'https://gamma-api.polymarket.com/events/slug/{SLUG}'
ROOT = Path(__file__).resolve().parents[1]

def run():
    timestamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    try:
        req = Request(URL, headers={'Accept': 'application/json', 'User-Agent': 'CrudeEdge-Paper-Trading-Dashboard/1.2'})
        with urlopen(req, timeout=25) as response:
            if response.status != 200:
                raise RuntimeError(f'Polymarket Gamma returned HTTP {response.status}')
            # Bounded public metadata response, not private account data.
            event = json.loads(response.read(2_000_000))
        if not isinstance(event, dict) or event.get('slug') != SLUG or 'hormuz' not in str(event.get('title','')).lower():
            raise ValueError('Unexpected Gamma event identity; do not publish unrelated data')
        if not isinstance(event.get('markets'), list) or len(event['markets']) < 2:
            raise ValueError('Gamma event does not contain enough deadline markets')
        markets = []
        for market in event['markets']:
            if not isinstance(market, dict):
                continue
            # Whitelist: publish only the public market fields used by the page.
            clean = {key: market[key] for key in (
                'id', 'slug', 'groupItemTitle', 'question', 'endDate', 'endDateIso',
                'active', 'closed', 'archived', 'resolved', 'outcomes',
                'outcomePrices', 'bestBid', 'bestAsk'
            ) if key in market}
            markets.append(clean)
        snapshot = {
            'id': str(event.get('id') or SLUG), 'slug': SLUG,
            'title': event['title'], 'active': event.get('active', True),
            'closed': event.get('closed', False), 'markets': markets,
            'snapshotFetchedAt': timestamp,
            'source': 'public Polymarket Gamma API; GitHub Pages scheduled fetch'
        }
        print(f'Fetched {len(markets)} public markets from the exact Hormuz event.')
    except Exception as exc:
        # Fail closed without blocking the first GitHub Pages deployment. The
        # viewer can still open the dashboard and see public Hyperliquid prices,
        # but the browser's readEvent() rejects empty markets and DISABLES trading.
        # Never substitute fabricated market odds or stale hard-coded prices.
        print(f'WARNING: public Polymarket market fetch failed ({type(exc).__name__}); deploying a safe unavailable marker.')
        snapshot = {
            'id': SLUG, 'slug': SLUG, 'title': 'Strait of Hormuz market feed unavailable',
            'active': False, 'closed': False, 'markets': [],
            'snapshotFetchedAt': timestamp, 'source': 'unavailable; no probabilities published'
        }
    dest = ROOT / 'data' / 'hormuz-snapshot.json'
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(snapshot, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    print('Published sanitized data/hormuz-snapshot.json')
if __name__ == '__main__': run()
