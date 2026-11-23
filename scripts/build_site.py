"""Create minimal GitHub Pages deployment artifact; no tests, git metadata or secrets."""
from pathlib import Path
from shutil import copy2, rmtree
ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'dist'
if DIST.exists(): rmtree(DIST)
for name in ['index.html','styles.css','app.js','hormuz-signal.js','assets/favicon.svg','.nojekyll','data/hormuz-snapshot.json']:
    source=ROOT/name
    if not source.is_file(): raise FileNotFoundError(f'Missing public deployment file: {name}')
    target=DIST/name; target.parent.mkdir(parents=True,exist_ok=True);copy2(source,target)
print('Safe static Pages artifact created:', DIST)
