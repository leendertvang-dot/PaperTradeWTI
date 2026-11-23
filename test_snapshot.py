"""No-network regression tests for the public GitHub Pages Polymarket fetch."""
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fetch_hormuz_snapshot', ROOT / 'scripts' / 'fetch_hormuz_snapshot.py')
fetcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetcher)


class Response:
    status = 200

    def __init__(self, payload):
        self.payload = io.BytesIO(json.dumps(payload).encode())

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, n):
        return self.payload.read(n)


class SnapshotTests(unittest.TestCase):
    def test_success_preserves_only_public_allowlisted_market_fields(self):
        event = {
            'id': 'event-id', 'slug': fetcher.SLUG,
            'title': 'Strait of Hormuz traffic returns to normal by...?',
            'markets': [
                {'id': str(i), 'groupItemTitle': d, 'outcomes': '["Yes", "No"]',
                 'outcomePrices': '["0.25", "0.75"]', 'secret_material': 'NEVER PUBLISH'}
                for i, d in enumerate(['January 31, 2027', 'March 31, 2027'])
            ],
            'private_metadata': 'NEVER PUBLISH'
        }
        with tempfile.TemporaryDirectory() as t:
            with patch.object(fetcher, 'ROOT', Path(t)), patch.object(fetcher, 'urlopen', return_value=Response(event)):
                fetcher.run()
            data = json.loads((Path(t) / 'data/hormuz-snapshot.json').read_text())
            self.assertEqual(data['slug'], fetcher.SLUG)
            self.assertEqual(len(data['markets']), 2)
            self.assertNotIn('secret_material', data['markets'][0])
            self.assertNotIn('private_metadata', data)
            self.assertIn('snapshotFetchedAt', data)

    def test_network_failure_still_builds_site_with_unavailable_marker(self):
        with tempfile.TemporaryDirectory() as t:
            with patch.object(fetcher, 'ROOT', Path(t)), patch.object(fetcher, 'urlopen', side_effect=OSError('offline')):
                fetcher.run()
            data = json.loads((Path(t) / 'data/hormuz-snapshot.json').read_text())
            self.assertEqual(data['markets'], [])
            self.assertFalse(data['active'])
            self.assertEqual(data['slug'], fetcher.SLUG)

    def test_wrong_event_identity_never_publishes_its_market_data(self):
        event = {'slug': 'some-other-event', 'title': 'Other event',
                 'markets': [{'id': 1}, {'id': 2}]}
        with tempfile.TemporaryDirectory() as t:
            with patch.object(fetcher, 'ROOT', Path(t)), patch.object(fetcher, 'urlopen', return_value=Response(event)):
                fetcher.run()
            data = json.loads((Path(t) / 'data/hormuz-snapshot.json').read_text())
            self.assertEqual(data['markets'], [])


if __name__ == '__main__':
    unittest.main()
