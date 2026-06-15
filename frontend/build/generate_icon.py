#!/usr/bin/env python3
"""Generate the MyHackingPal Terminal Wink icon set.

Renders a 1024x1024 master with Apple's icon grid padding (the visible
mark occupies ~824/1024 with a rounded-square fill), centers the
">;)" wordmark in white Menlo Bold, then emits all the iconset PNGs
and runs `iconutil` to produce icon.icns.

Run:  python3 generate_icon.py
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import subprocess

BUILD = Path(__file__).resolve().parent
ICONSET = BUILD / "icon.iconset"

CANVAS = 1024
SQUIRCLE = 824            # Apple icon grid: ~80.5% of canvas
RADIUS = 185              # ~22.5% of mark, close to Apple's squircle
BG = (17, 17, 17, 255)    # #111
FG = (255, 255, 255, 255)
FONT_PATH = "/System/Library/Fonts/Menlo.ttc"
FONT_INDEX = 1            # Bold


def fit_font(text: str, target_w: int) -> ImageFont.FreeTypeFont:
    """Binary search the Menlo Bold size whose rendered text width is
    closest to target_w. Mono fonts scale linearly so this converges
    in ~12 steps."""
    lo, hi = 10, 800
    best = ImageFont.truetype(FONT_PATH, lo, index=FONT_INDEX)
    while lo <= hi:
        mid = (lo + hi) // 2
        f = ImageFont.truetype(FONT_PATH, mid, index=FONT_INDEX)
        l, _, r, _ = f.getbbox(text)
        w = r - l
        if w <= target_w:
            best = f
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def render_master() -> Image.Image:
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = (CANVAS - SQUIRCLE) // 2
    draw.rounded_rectangle(
        [margin, margin, margin + SQUIRCLE, margin + SQUIRCLE],
        radius=RADIUS,
        fill=BG,
    )

    text = ">;)"
    font = fit_font(text, target_w=int(SQUIRCLE * 0.62))

    l, t, r, b = font.getbbox(text)
    text_w = r - l
    text_h = b - t
    x = (CANVAS - text_w) // 2 - l
    y = (CANVAS - text_h) // 2 - t
    draw.text((x, y), text, font=font, fill=FG)
    return img


def main() -> None:
    ICONSET.mkdir(parents=True, exist_ok=True)
    master = render_master()
    master.save(BUILD / "icon-1024.png")
    master.resize((512, 512), Image.LANCZOS).save(BUILD / "icon.png")

    iconset_sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for size, name in iconset_sizes:
        master.resize((size, size), Image.LANCZOS).save(ICONSET / name)

    subprocess.check_call(
        ["iconutil", "-c", "icns", "-o", str(BUILD / "icon.icns"), str(ICONSET)]
    )
    print(f"wrote {BUILD / 'icon.icns'}")


if __name__ == "__main__":
    main()
