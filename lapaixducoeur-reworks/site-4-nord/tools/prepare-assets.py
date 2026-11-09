#!/usr/bin/env python3
"""One-off asset preparation (Pillow + ffmpeg). Output is committed under static/assets/.

Run from the site folder:  python3 tools/prepare-assets.py
build.mjs never calls this; it only copies static/ into dist/.
"""
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

SITE = Path(__file__).resolve().parent.parent
SRC = SITE.parent / "shared" / "assets"
OUT = SITE / "static" / "assets" / "img"
FONTS = SITE / "static" / "assets" / "fonts"
OUT.mkdir(parents=True, exist_ok=True)

PHOTOS = ["food-bank-volunteers", "bread-sharing", "children-joy", "children-play", "widows",
          "elders", "bible-study", "lunchboxes", "fruit", "clothing", "library"]
WIDTHS = [640, 1024, 1600]


def grade(im: Image.Image) -> Image.Image:
    """Muted, slightly warm documentary grade with lifted blacks."""
    im = im.convert("RGB")
    im = ImageEnhance.Color(im).enhance(0.80)
    im = ImageEnhance.Contrast(im).enhance(0.93)
    r, g, b = im.split()
    r = r.point(lambda v: min(255, int(v * 1.025 + 4)))
    g = g.point(lambda v: min(255, int(v * 1.0 + 2)))
    b = b.point(lambda v: min(255, int(v * 0.94)))
    im = Image.merge("RGB", (r, g, b))
    # matte: lift the darkest tones a little
    return im.point(lambda v: int(14 + v * (236 / 255)))


manifest = {}
for name in PHOTOS:
    src = Image.open(SRC / f"{name}.jpg")
    graded = grade(src)
    w0, h0 = graded.size
    widths = sorted({min(w, w0) for w in WIDTHS})
    for w in widths:
        h = round(h0 * w / w0)
        im = graded.resize((w, h), Image.LANCZOS)
        im.save(OUT / f"{name}-{w}.jpg", "JPEG", quality=78, optimize=True, progressive=True)
        im.save(OUT / f"{name}-{w}.webp", "WEBP", quality=74, method=6)
    manifest[name] = {"w": w0, "h": h0, "widths": widths}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))

# Logo variants
logo = Image.open(SRC / "logo.png").convert("RGBA")
for w in (96, 192, 320):
    im = logo.resize((w, round(416 * w / 480)), Image.LANCZOS)
    im.save(OUT / f"logo-{w}.png", optimize=True)
    im.save(OUT / f"logo-{w}.webp", "WEBP", quality=90)

# Favicons (logo on a snow tile)
STATIC = SITE / "static"
def tile(size):
    bg = Image.new("RGBA", (size, size), (244, 244, 241, 255))
    lw = int(size * 0.9)
    lg = logo.resize((lw, round(416 * lw / 480)), Image.LANCZOS)
    bg.alpha_composite(lg, ((size - lw) // 2, (size - lg.height) // 2))
    return bg
tile(180).save(STATIC / "apple-touch-icon.png")
tile(32).save(STATIC / "favicon-32.png")
tile(512).save(STATIC / "icon-512.png")
tile(64).save(STATIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

# Open Graph card 1200x630
og = Image.new("RGB", (1200, 630), (244, 244, 241))
photo = grade(Image.open(SRC / "food-bank-volunteers.jpg"))
photo = ImageOps.fit(photo, (560, 630), Image.LANCZOS, centering=(0.55, 0.5))
og.paste(photo, (640, 0))
d = ImageDraw.Draw(og)
d.rectangle([0, 0, 640, 630], fill=(244, 244, 241))
d.rectangle([0, 600, 1200, 630], fill=(47, 74, 63))
lg = logo.resize((150, 130), Image.LANCZOS)
og.paste(lg, (72, 70), lg)
def font(path, size, wght=None):
    f = ImageFont.truetype(str(path), size)
    if wght:
        try:
            f.set_variation_by_axes([wght])
        except Exception:
            pass
    return f
sans = FONTS / "manrope-var.woff2"
d.text((72, 236), "MONTRÉAL · DEPUIS 2014", font=font(sans, 22, 700), fill=(181, 51, 46))
d.text((72, 276), "La Paix du Cœur", font=font(sans, 64, 750), fill=(35, 39, 42))
d.text((72, 352), "Kimia Na Motema", font=font(FONTS / "source-serif-4-italic.woff2", 40), fill=(47, 74, 63))
d.line([(72, 428), (180, 428)], fill=(47, 74, 63), width=2)
d.text((72, 450), "Maraudes · Collectes alimentaires · Bénévolat", font=font(sans, 24, 500), fill=(70, 76, 74))
d.text((72, 486), "Street outreach · Food drives · Volunteering", font=font(sans, 24, 500), fill=(70, 76, 74))
og.save(OUT / "og-card.jpg", "JPEG", quality=84, optimize=True)

# Sample audio: 8 s of a soft, fading two-note chord (clearly a placeholder)
audio = SITE / "static" / "assets" / "audio" / "voix-du-coeur-extrait.mp3"
subprocess.run([
    "ffmpeg", "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=8",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=8",
    "-filter_complex", "[0][1]amix=inputs=2,volume=0.35,afade=t=in:d=1.2,afade=t=out:st=5.5:d=2.5",
    "-ac", "1", "-b:a", "48k", str(audio)], check=True)
print("assets ready:", len(manifest), "photos")
