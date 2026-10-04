"""
Draws the desktop app's images from the web app's logo (src/app/icon.png). Run again after the logo changes:

    python3 desktop/scripts/make-art.py

  assets/icon.png              window + notification icon (256)
  assets/tray.png (+@1.5x, @2x) tray icon (16 / 24 / 32)
  build/icon.ico               app, installer and shortcut icon (16 … 256)
  build/icon.png               the same, 256 PNG
  build/installerSidebar.bmp   installer welcome / finish pages (164 x 314)
  build/installerHeader.bmp    installer page header (150 x 57)

Needs Pillow (pip install pillow).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

DESKTOP = Path(__file__).resolve().parent.parent
REPO = DESKTOP.parent
LOGO = REPO / "src" / "app" / "icon.png"

NAVY = (11, 29, 77)
BRAND = (17, 87, 241)
BRAND_DARK = (12, 63, 174)
WHITE = (255, 255, 255)
SOFT = (180, 196, 239)

FONT_DIRS = [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu"), Path("/usr/share/fonts/truetype")]


def font(bold: bool, size: int) -> ImageFont.FreeTypeFont:
    names = ["segoeuib.ttf", "DejaVuSans-Bold.ttf"] if bold else ["segoeui.ttf", "DejaVuSans.ttf"]
    for d in FONT_DIRS:
        for n in names:
            if (d / n).exists():
                return ImageFont.truetype(str(d / n), size)
    return ImageFont.load_default()


def mark() -> Image.Image:
    """The logo mark, trimmed to its visible pixels."""
    im = Image.open(LOGO).convert("RGBA")
    return im.crop(im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox())


def fit(im: Image.Image, size: int, pad: float) -> Image.Image:
    """`im` centred on a transparent square, `pad` of the side left free around it."""
    inner = round(size * (1 - 2 * pad))
    scale = inner / max(im.size)
    small = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(small, ((size - small.width) // 2, (size - small.height) // 2))
    return out


def gradient(w: int, h: int, top, bottom) -> Image.Image:
    g = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        g.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return g.resize((w, h))


def sidebar(m: Image.Image) -> Image.Image:
    s = 3  # draw large, shrink at the end (smooth edges)
    w, h = 164 * s, 314 * s
    img = gradient(w, h, NAVY, BRAND_DARK).convert("RGBA")

    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((w * 0.25, -h * 0.2, w * 1.5, h * 0.45), fill=(61, 123, 255, 120))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(40 * s)))

    grid = Image.new("RGBA", (w, h), (0, 0, 0, 0))  # faint chart grid (own layer: blended, not painted over)
    g = ImageDraw.Draw(grid)
    for x in range(0, w, 22 * s):
        g.line([(x, 0), (x, h)], fill=(255, 255, 255, 16), width=s)
    for y in range(0, h, 22 * s):
        g.line([(0, y), (w, y)], fill=(255, 255, 255, 16), width=s)
    img.alpha_composite(grid)

    # white tile with the mark
    tile = 76 * s
    tx, ty = (w - tile) // 2, 34 * s
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((tx, ty + 8 * s, tx + tile, ty + tile + 8 * s), 20 * s, fill=(0, 0, 0, 110))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(9 * s)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((tx, ty, tx + tile, ty + tile), 20 * s, fill=WHITE)
    img.alpha_composite(fit(m, tile, 0.14), (tx, ty))

    def centred(text, y, f, fill):
        tw = d.textlength(text, font=f)
        d.text(((w - tw) / 2, y), text, font=f, fill=fill)

    centred("Algo Hunt", 126 * s, font(True, 19 * s), WHITE)
    centred("Strategy alerts", 152 * s, font(False, 10 * s), SOFT)
    centred("NSE · BSE · MCX", 166 * s, font(False, 10 * s), SOFT)

    # candles climbing along the bottom, with a rising line
    chart = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    c = ImageDraw.Draw(chart)
    base = h - 26 * s
    for i, up in enumerate([True, False, True, True, False, True, True]):
        x = (24 + i * 19) * s
        mid = base - (26 + i * 11) * s
        body = (9 if up else 6) * s
        c.line([(x, mid - body - 8 * s), (x, mid + body + 8 * s)], fill=(255, 255, 255, 110), width=2 * s)
        c.rounded_rectangle((x - 5 * s, mid - body, x + 5 * s, mid + body), 2 * s, fill=(255, 255, 255, 235 if up else 95))
    line = [(10, 14), (40, 24), (70, 42), (100, 52), (128, 76), (156, 92)]
    c.line([(x * s, base - y * s) for x, y in line], fill=(122, 167, 255, 230), width=3 * s, joint="curve")
    img.alpha_composite(chart)
    return img.convert("RGB").resize((164, 314), Image.LANCZOS)


def header(m: Image.Image) -> Image.Image:
    s = 4
    w, h = 150 * s, 57 * s
    img = Image.new("RGBA", (w, h), WHITE + (255,))
    size = 46 * s
    img.alpha_composite(fit(m, size, 0.04), (w - size - 8 * s, (h - size) // 2))
    return img.convert("RGB").resize((150, 57), Image.LANCZOS)


def main() -> None:
    m = mark()
    (DESKTOP / "assets").mkdir(exist_ok=True)
    (DESKTOP / "build").mkdir(exist_ok=True)

    icon = fit(m, 256, 0.06)
    icon.save(DESKTOP / "assets" / "icon.png")
    icon.save(DESKTOP / "build" / "icon.png")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    # Small sizes get less padding (more visible at 16 px).
    frames = [fit(m, n, 0.06 if n >= 48 else 0.02) for n in sizes]
    frames[-1].save(DESKTOP / "build" / "icon.ico", sizes=[(n, n) for n in sizes], append_images=frames[:-1])
    for name, n in [("tray.png", 16), ("tray@1.5x.png", 24), ("tray@2x.png", 32)]:
        fit(m, n, 0.02).save(DESKTOP / "assets" / name)

    sidebar(m).save(DESKTOP / "build" / "installerSidebar.bmp")
    header(m).save(DESKTOP / "build" / "installerHeader.bmp")
    print("made: assets/icon.png, assets/tray*.png, build/icon.ico, build/icon.png, build/installerSidebar.bmp, build/installerHeader.bmp")


if __name__ == "__main__":
    main()
