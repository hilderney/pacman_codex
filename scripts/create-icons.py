"""Reproduce the original application mark as offline-safe PNG PWA icons."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / 'public'
for size in (192, 512):
    image = Image.new('RGB', (size, size), '#090e17')
    draw = ImageDraw.Draw(image)
    # Keep the mark within the maskable icon safe circle.
    points = [(20, 45), (20, 19), (28, 19), (28, 34), (36, 34), (36, 19), (44, 19), (44, 45), (36, 45), (36, 34), (28, 34), (28, 45), (20, 45)]
    points = [(round(x * size / 64), round(y * size / 64)) for x, y in points]
    draw.line(points, fill='#9aefd6', width=max(2, round(size * 2 / 64)), joint='curve')
    image.save(root / f'icon-{size}.png')
