"""Builds <film>/contact-sheet.png from the stills written by `render.mjs <film> --stills`.

Usage: $PY contact.py <film-dir> [--cols 6]
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

film = Path(next((a for a in sys.argv[1:] if not a.startswith('--')), '.')).resolve()
cols = int(sys.argv[sys.argv.index('--cols') + 1]) if '--cols' in sys.argv else 6
times = json.loads((film / 'stills' / 'times.json').read_text())
if not times:
    sys.exit('no stills: set window.STILL_TIMES in index.html')
first = Image.open(film / 'stills' / 's01.png')
tw = 480
th = round(tw * first.height / first.width)
rows = -(-len(times) // cols)
sheet = Image.new('RGB', (cols * tw, rows * (th + 22)), (18, 18, 22))
draw = ImageDraw.Draw(sheet)
for i, t in enumerate(times):
    im = Image.open(film / 'stills' / f's{i + 1:02d}.png').convert('RGB').resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 22)
    sheet.paste(im, (x, y + 22))
    draw.text((x + 6, y + 5), f'#{i + 1}  t={t:.1f}s', fill=(235, 235, 235))
sheet.save(film / 'contact-sheet.png')
print(film / 'contact-sheet.png')
