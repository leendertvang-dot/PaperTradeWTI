"""Verify strict allowlist for public GitHub Pages source, and no order routes/secrets.
Run from the repository: python tests/security_checks.py
This is a regression test, not a replacement for auditing added code or git history.
"""
from pathlib import Path
import re
ROOT = Path(__file__).resolve().parents[1]
expected = {
    "index.html", "app.js", "hormuz-signal.js", "styles.css", "README.md", "AUDIT_REPORT.md",
    "LICENSE", ".gitignore", ".nojekyll", "assets/favicon.svg", "assets/dashboard-preview.webp",
    "tests/security_checks.py", "tests/test_snapshot.py", "tests/hormuz_signal.test.cjs", ".github/workflows/validate.yml",
    ".github/workflows/pages.yml", "scripts/build_site.py", "scripts/fetch_hormuz_snapshot.py"
}
actual = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and p.relative_to(ROOT).parts[0] not in ('dist','data','.git') and '__pycache__' not in p.relative_to(ROOT).parts}
assert actual == expected, f"Unexpected or missing files: {actual.symmetric_difference(expected)}"
js = (ROOT / 'app.js').read_text()
model = (ROOT / 'hormuz-signal.js').read_text()
html = (ROOT / 'index.html').read_text()
assert 'Start Paper Trading' in html
assert 'id="pencil-cursor"' in html and 'id="chart-pencil-live"' in html, 'Live pencil trace must remain in the page'
assert 'id="input-hormuz"' in html and 'id="input-bid-offset"' in html, 'Live input decomposition required'
assert "writeLive('quote-bid'" in js and "writeLive('quote-ask'" in js, 'Quote updates must be visibly animated'
assert "coin: 'para:10Y'" in js, 'Public 10Y reference panel must be present'

assert "wss://api.hyperliquid.xyz/ws" in js
assert "https://api.hyperliquid.xyz/info" in js
assert "https://gamma-api.polymarket.com" in model
assert 'https://gamma-api.polymarket.com' in html
assert 'HORMUZ.quoteTilt(s.poly.score' in js, 'Polymarket input must affect executed paper quoting'
assert 'readyToTrade()' in js and 'polyReady()' in js
assert 'xyz:CL' in js
assert re.search(r"function executePaper\(", js), 'Paper fills must be simulated locally'
for path in ROOT.rglob('*'):
    if not path.is_file() or path.relative_to(ROOT).parts[0] in ('.git', 'dist', 'data') or '__pycache__' in path.relative_to(ROOT).parts: continue
    if path.suffix not in ['.html', '.js', '.cjs', '.css', '.md', '.svg', '.py', '.yml', '.webp', ''] and path.name not in ['.gitignore', '.nojekyll', 'LICENSE']:
        raise AssertionError('Unexpected file extension: ' + str(path))
    if path.suffix == '.webp':
        assert path.relative_to(ROOT).as_posix() == 'assets/dashboard-preview.webp'
        assert path.stat().st_size < 500_000, 'Preview unexpectedly large'
        continue
    contents = path.read_text()
    assert not re.search(r'(?im)^\s*(?:HL_PRIVATE_KEY|PRIVATE_KEY|SECRET_KEY|WALLET_PRIVATE_KEY)\s*=\s*\S+', contents), path
    assert not re.search(r'0x[a-fA-F0-9]{64}', contents), path
    assert not re.search(r'-----BEGIN [A-Z ]+PRIVATE KEY-----', contents), path
    assert not re.search(r'(?i)\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16})\b', contents), path
    if path.suffix in {'.js', '.cjs', '.html'}:
        assert not re.search(r'''(?i)(?:https://api\.hyperliquid\.xyz/exchange|/exchange['"`])''', contents), f'Order endpoint: {path}'
print('PASS: strict public file allowlist, no credential artifacts or exchange order endpoint, both public data feeds and integrated Hormuz paper strategy.')
