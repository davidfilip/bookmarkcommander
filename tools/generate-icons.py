"""Generate the extension's B monogram using only the Python standard library."""
from pathlib import Path
import struct
import zlib


def ellipse(x, y, cx, cy, rx, ry):
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1


def pixel(x, y):
    # Rounded square with a terminal-inspired neon-green-to-dark-teal gradient.
    dx, dy = max(18 - x, 0, x - 110), max(18 - y, 0, y - 110)
    if x < 4 or x > 124 or y < 4 or y > 124 or dx * dx + dy * dy > 14 ** 2:
        return (0, 0, 0, 0)
    t = (x + y) / 256
    color = tuple(round(a + (b - a) * t) for a, b in zip((57, 255, 112), (0, 48, 55)))
    stem = 35 <= x <= 49 and 27 <= y <= 101
    top = 46 <= x and ellipse(x, y, 54, 47, 35, 20)
    bottom = 46 <= x and ellipse(x, y, 56, 79, 36, 22)
    hole = (49 <= x and ellipse(x, y, 56, 47, 18, 8)) or (49 <= x and ellipse(x, y, 57, 79, 20, 10))
    return (*((248, 248, 242) if (stem or top or bottom) and not hole else color), 255)


def chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))


for size in (16, 32, 48, 128):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            samples = [pixel((x + (sx + .5) / 4) * 128 / size,
                             (y + (sy + .5) / 4) * 128 / size)
                       for sy in range(4) for sx in range(4)]
            alpha = sum(p[3] for p in samples)
            rgb = [round(sum(p[c] * p[3] for p in samples) / alpha) if alpha else 0 for c in range(3)]
            rows.extend((*rgb, round(alpha / 16)))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(rows))) + chunk(b'IEND', b'')
    (Path(__file__).resolve().parents[1] / 'icons' / f'icon-{size}.png').write_bytes(png)
