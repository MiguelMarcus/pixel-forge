"""Cria uma entrada realista: pixel art -> 'upgrade de IA' (borrada, com glow e fundo)."""
import json
import os

from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "fixtures", "cavaleiro-64.png")
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)


def main():
    knight = Image.open(SRC).convert("RGBA").resize((512, 512), Image.BICUBIC)
    canvas = Image.new("RGBA", (512, 512), (236, 241, 248, 255))

    glow = knight.filter(ImageFilter.GaussianBlur(20))
    glow.putalpha(glow.getchannel("A").point(lambda a: int(a * 0.55)))
    canvas.alpha_composite(glow)
    canvas.alpha_composite(knight)

    canvas = canvas.filter(ImageFilter.GaussianBlur(1.0))
    canvas.convert("RGB").save(os.path.join(OUT, "ai-512.png"))

    with open(os.path.join(OUT, "ai-512.raw"), "wb") as fh:
        fh.write(canvas.tobytes())
    with open(os.path.join(OUT, "ai-512.json"), "w") as fh:
        json.dump({"width": 512, "height": 512}, fh)

    print("ai-512.png / .raw gerados")


if __name__ == "__main__":
    main()
