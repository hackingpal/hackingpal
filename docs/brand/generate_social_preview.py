"""Generate the GitHub social-preview PNG for HackingPal.

Renders two variants into docs/brand/:
  - social-preview.png         — primary, matches the current README tagline
  - social-preview-classic.png — original copy with name+URL corrected

Run from anywhere:
    python3 docs/brand/generate_social_preview.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent
W, H = 1280, 640
BG = (14, 14, 14)
INK = (255, 255, 255)
INK_MUTED = (170, 170, 170)
INK_DIM = (138, 138, 138)
ACCENT = (90, 177, 255)

SF = "/System/Library/Fonts/SFNS.ttf"
SF_MONO = "/System/Library/Fonts/SFNSMono.ttf"

MARK_X = 175
TEXT_X = 480
RIGHT_MARGIN = 60


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def text_w(d: ImageDraw.ImageDraw, s: str, f: ImageFont.FreeTypeFont) -> int:
    b = d.textbbox((0, 0), s, font=f)
    return b[2] - b[0]


def fit_size(d: ImageDraw.ImageDraw, s: str, path: str, max_w: int, start: int, floor: int = 18) -> ImageFont.FreeTypeFont:
    size = start
    while size > floor:
        f = font(path, size)
        if text_w(d, s, f) <= max_w:
            return f
        size -= 2
    return font(path, floor)


def render(out_path: Path, title: str, subtitle: str, tagline: str, url: str) -> None:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    f_mark = font(SF_MONO, 180)
    f_title = font(SF, 96)

    max_text_w = W - TEXT_X - RIGHT_MARGIN
    f_sub = fit_size(d, subtitle, SF, max_text_w, start=36, floor=24)
    f_tag = fit_size(d, tagline, SF, max_text_w, start=32, floor=22)

    url_prefix = ">;) "
    f_url = fit_size(d, url_prefix + url, SF_MONO, max_text_w, start=32, floor=20)

    mark = ">;)"
    mbbox = d.textbbox((0, 0), mark, font=f_mark)
    mark_h = mbbox[3] - mbbox[1]
    mark_y = (H - mark_h) // 2 - mbbox[1]
    d.text((MARK_X, mark_y), mark, font=f_mark, fill=INK)

    title_h = d.textbbox((0, 0), title, font=f_title)[3]
    sub_h = d.textbbox((0, 0), subtitle, font=f_sub)[3]
    tag_h = d.textbbox((0, 0), tagline, font=f_tag)[3]
    url_h = d.textbbox((0, 0), url_prefix, font=f_url)[3]

    gap_title_sub = 26
    gap_sub_tag = 22
    gap_tag_url = 38

    block_h = title_h + gap_title_sub + sub_h + gap_sub_tag + tag_h + gap_tag_url + url_h
    y = (H - block_h) // 2

    d.text((TEXT_X, y), title, font=f_title, fill=INK)
    y += title_h + gap_title_sub
    d.text((TEXT_X, y), subtitle, font=f_sub, fill=INK_MUTED)
    y += sub_h + gap_sub_tag
    d.text((TEXT_X, y), tagline, font=f_tag, fill=INK_DIM)
    y += tag_h + gap_tag_url

    prefix_w = text_w(d, url_prefix, f_url)
    d.text((TEXT_X, y), url_prefix, font=f_url, fill=INK_DIM)
    d.text((TEXT_X + prefix_w, y), url, font=f_url, fill=ACCENT)

    img.save(out_path, "PNG", optimize=True)
    print(f"wrote {out_path} ({out_path.stat().st_size // 1024} KB)")


def main() -> None:
    render(
        OUT_DIR / "social-preview.png",
        title="HackingPal",
        subtitle="AI-assisted security workspace for authorized engagements",
        tagline="engagements  •  75+ tools  •  AI copilot",
        url="github.com/hackingpal/hackingpal",
    )
    render(
        OUT_DIR / "social-preview-classic.png",
        title="HackingPal",
        subtitle="Offensive-security toolkit",
        tagline="40+ tools  •  AI assistant  •  cross-platform",
        url="github.com/hackingpal/hackingpal",
    )


if __name__ == "__main__":
    main()
