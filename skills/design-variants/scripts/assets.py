"""Embed images into a self-contained design-variants board.

  python assets.py embed <assets.json> name=path[:WxH] ...
      Centre-crops each image to WxH (or keeps its size), saves JPEG q70 (PNG when it has alpha),
      and merges {name: data-URI} into assets.json. SVGs are embedded as-is.
  python assets.py inline <board.src.html> <assets.json> > board.html
      Replaces every {{asset:name}} with its data URI. Exits 1 on an unknown name.
"""

import base64
import io
import json
import re
import sys
from pathlib import Path


def encode(path: Path, size: str | None) -> str:
    if path.suffix.lower() == ".svg":
        return "data:image/svg+xml;base64," + base64.b64encode(path.read_bytes()).decode()
    from PIL import Image, ImageOps

    image = ImageOps.exif_transpose(Image.open(path))
    if size:
        width, height = (int(part) for part in size.lower().split("x"))
        image = ImageOps.fit(image, (width, height), Image.LANCZOS)
    buffer = io.BytesIO()
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        image.save(buffer, "PNG", optimize=True)
        mime = "image/png"
    else:
        image.convert("RGB").save(buffer, "JPEG", quality=70, optimize=True, progressive=True)
        mime = "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(buffer.getvalue()).decode()


def embed(target: Path, specs: list[str]) -> None:
    assets = json.loads(target.read_text()) if target.exists() else {}
    for spec in specs:
        name, _, rest = spec.partition("=")
        match = re.fullmatch(r"(.+?)(?::(\d+x\d+))?", rest)
        if not name or not match:
            sys.exit(f"bad spec {spec!r}: use name=path[:WxH]")
        path, size = match.groups()
        assets[name] = encode(Path(path), size)
        print(f"{name:<24} {len(assets[name]) // 1024:>5} KB  {path}", file=sys.stderr)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(assets))
    total = sum(len(value) for value in assets.values()) // 1024
    print(f"{len(assets)} assets, {total} KB -> {target}", file=sys.stderr)


def inline(board: Path, source: Path) -> None:
    assets = json.loads(source.read_text())
    missing: set[str] = set()

    def swap(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in assets:
            missing.add(name)
            return match.group(0)
        return assets[name]

    html = re.sub(r"\{\{asset:([\w.-]+)\}\}", swap, board.read_text())
    if missing:
        sys.exit(f"unknown assets: {', '.join(sorted(missing))}")
    sys.stdout.write(html)


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "embed":
        embed(Path(sys.argv[2]), sys.argv[3:])
    elif len(sys.argv) == 4 and sys.argv[1] == "inline":
        inline(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        sys.exit(__doc__)
