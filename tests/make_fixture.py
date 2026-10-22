"""Gera a fixture de pixel art real (usada no teste de idempotência)."""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "fixtures", "cavaleiro-64.png")
OUT = os.path.join(HERE, "fixtures")
os.makedirs(OUT, exist_ok=True)


def main() -> int:
    if not os.path.exists(SRC):
        print(f"fonte ausente: {SRC} (teste de idempotência sera pulado)")
        return 0

    img = Image.open(SRC).convert("RGBA")
    name = "cavaleiro-64"
    with open(os.path.join(OUT, name + ".raw"), "wb") as fh:
        fh.write(img.tobytes())
    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as fh:
        json.dump({"width": img.width, "height": img.height}, fh)

    colors = img.convert("RGB").getcolors(maxcolors=70000) or []
    print(f"fixture {name}: {img.width}x{img.height}, {len(colors)} cores")
    return 0


if __name__ == "__main__":
    sys.exit(main())
