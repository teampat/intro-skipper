#!/usr/bin/env python3
"""Generate extension icons (red rounded square with a skip-forward glyph)
matching the logo used in docs/index.html and docs/styles.css.

No third-party dependencies: builds raw RGBA pixels and encodes a PNG by hand.
"""
import os
import struct
import zlib

RED = (0xCC, 0x00, 0x00, 0xFF)   # --red from docs/styles.css
WHITE = (0xFF, 0xFF, 0xFF, 0xFF)
TRANSPARENT = (0, 0, 0, 0)

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
SIZES = (16, 32, 48, 128)


def rounded_rect_mask(x, y, size, radius):
    """Return True if point (x, y) is inside a rounded square of given size/radius."""
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def in_triangle(px, py, ax, ay, bx, by, cx, cy):
    def sign(x1, y1, x2, y2, x3, y3):
        return (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)

    d1 = sign(px, py, ax, ay, bx, by)
    d2 = sign(px, py, bx, by, cx, cy)
    d3 = sign(px, py, cx, cy, ax, ay)

    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def in_rect(px, py, x0, y0, x1, y1):
    return x0 <= px <= x1 and y0 <= py <= y1


def make_icon(size):
    radius = size * 0.22

    y_top, y_bottom, y_center = size * 0.28, size * 0.72, size * 0.5
    x_a, x_b, x_c = size * 0.20, size * 0.44, size * 0.66
    bar_x0, bar_x1 = size * 0.72, size * 0.80

    pixels = bytearray()
    for j in range(size):
        row = bytearray()
        py = j + 0.5
        for i in range(size):
            px = i + 0.5
            if not rounded_rect_mask(px, py, size, radius):
                r, g, b, a = TRANSPARENT
            else:
                r, g, b, a = RED
                glyph = (
                    in_triangle(px, py, x_a, y_top, x_a, y_bottom, x_b, y_center)
                    or in_triangle(px, py, x_b, y_top, x_b, y_bottom, x_c, y_center)
                    or in_rect(px, py, bar_x0, y_top, bar_x1, y_bottom)
                )
                if glyph:
                    r, g, b, a = WHITE
            row += bytes((r, g, b, a))
        pixels += b"\x00" + row  # filter type 0 (none) per scanline
    return bytes(pixels)


def png_chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path, size, raw):
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(png_chunk(b"IHDR", ihdr))
        f.write(png_chunk(b"IDAT", idat))
        f.write(png_chunk(b"IEND", b""))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        raw = make_icon(size)
        out_path = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(out_path, size, raw)
        print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
