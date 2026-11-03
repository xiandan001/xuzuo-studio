import argparse
import json
import struct
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZES = [16, 24, 32, 48, 64, 128, 256]
ASSETS = ROOT / 'assets'
QA = ROOT / 'work' / 'icon-qa'
OUTPUTS = ROOT / 'outputs'


def verify_image(image, size):
    assert image.size == (size, size), f'Unexpected dimensions: {image.size}'
    image = image.convert('RGBA')
    assert image.getpixel((0, 0))[3] == 0, 'Rounded corners must be transparent'
    pixels = list(image.get_flattened_data())
    assert all(red == green == blue for red, green, blue, _ in pixels), 'Icon must be monochrome'
    white_pixels = sum(red > 230 and alpha > 230 for red, _, _, alpha in pixels)
    assert white_pixels >= max(8, size * size * .08), 'The page silhouette must remain visible'
    return {'size': size, 'mode': image.mode, 'alphaBounds': image.getbbox(), 'whitePixels': white_pixels}


def create_icon():
    frames = [Image.open(QA / f'{size}.png').convert('RGBA') for size in SIZES]
    frames[-1].save(ASSETS / 'app-icon.ico', format='ICO', sizes=[(size, size) for size in SIZES], append_images=frames[:-1])


def contact_sheet():
    sheet = Image.new('RGB', (960, 620), '#f5f5f5')
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 16), 'XUZUO STUDIO / folded page + first stroke', fill='#111')
    for row, background in enumerate(['#fff', '#e4e4e4', '#252525']):
        top = 48 + row * 184
        draw.rounded_rectangle((16, top, 944, top + 176), radius=12, fill=background)
        x = 32
        for size in SIZES[:-1]:
            icon = Image.open(QA / f'{size}.png').convert('RGBA')
            label = '#ddd' if row == 2 else '#555'
            draw.text((x, top + 8), f'{size}px', fill=label)
            sheet.paste(icon, (x, top + 32), icon)
            x += max(size + 24, 72)
        small = Image.open(QA / '16.png').convert('RGBA').resize((96, 96), Image.Resampling.NEAREST)
        draw.text((660, top + 8), '16px / pixel detail', fill=label)
        sheet.paste(small, (660, top + 32), small)
        large = Image.open(ASSETS / 'app-icon.png').convert('RGBA').resize((112, 112), Image.Resampling.LANCZOS)
        sheet.paste(large, (804, top + 16), large)
    sheet.save(OUTPUTS / 'icon-contact-sheet.png')


def verify():
    data = (ASSETS / 'app-icon.ico').read_bytes()
    reserved, kind, count = struct.unpack_from('<HHH', data)
    assert (reserved, kind, count) == (0, 1, len(SIZES)), 'ICO must contain all seven frames'
    entries = []
    for index in range(count):
        width, height = struct.unpack_from('<BB', data, 6 + index * 16)
        entries.append((width or 256, height or 256))
    assert sorted(entries) == [(size, size) for size in SIZES], f'Incorrect ICO sizes: {entries}'
    icon = Image.open(ASSETS / 'app-icon.ico')
    checks = [verify_image(icon.ico.getimage((size, size)), size) for size in SIZES]
    checks += [verify_image(Image.open(ASSETS / filename), size) for filename, size in [('app-icon.png', 256), ('app-icon-512.png', 512)]]
    for filename in ['assets/app-icon.svg', 'src/components/Brand.tsx', 'index.html', 'scripts/render-app-icon.mjs', 'scripts/verify-app-icon.py']:
        assert b'\r' not in (ROOT / filename).read_bytes(), f'{filename} must use LF'
    report = {
        'status': 'passed',
        'design': 'Original monochrome folded page with an integrated negative-space pen stroke',
        'selectedCandidate': 'a-folded-page',
        'candidateReview': 'A keeps a solid paper silhouette at 16px. B has thinner open edges. C loses the separate fold.',
        'visualReview': 'Inspected the candidate contact sheet and native 16/24/32/48/64/128/256px forms on light, gray and dark backgrounds.',
        'icoSizes': entries,
        'imageChecks': checks,
        'contactSheet': 'outputs/icon-contact-sheet.png',
    }
    (OUTPUTS / 'icon-qa.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': report['status'], 'icoSizes': SIZES, 'report': str(OUTPUTS / 'icon-qa.json')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Verify the monochrome app icon, or create its ICO from native SVG renders.')
    parser.add_argument('--create', action='store_true')
    args = parser.parse_args()
    OUTPUTS.mkdir(exist_ok=True)
    if args.create:
        create_icon()
        contact_sheet()
    verify()
