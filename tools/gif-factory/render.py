"""Render one bounded entry at a time. No model, network, or subprocess calls."""
from hashlib import sha256
from math import cos, pi
from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont, ImageOps
from manifest import FULL_ACTIONS, TWO_STATES, frame_bounds
from motion import animate


def crop_frame(frame, sources):
    source = sources[frame['atlasId']]
    with Image.open(source['path']) as image:
        ImageOps.exif_transpose(image, in_place=True)
        cropped = image.crop(frame_bounds(frame, sources))
        result = cropped.convert('RGBA')
        cropped.close()
        return result


def caption_font(value, text, width, height):
    if not text:
        return None, []
    choices = [value] if value else []
    windows = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'Fonts'
    choices += [windows / name for name in ['msyh.ttc', 'simhei.ttf', 'simsun.ttc', 'arial.ttf']]
    choices += [Path('/System/Library/Fonts/PingFang.ttc'),
                Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf'),
                Path('/System/Library/Fonts/Supplemental/Arial.ttf'),
                Path('/Library/Fonts/Arial Unicode.ttf')]
    choices += [Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
                Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]
    for filename in choices:
        if not filename or not Path(filename).is_file():
            continue
        try:
            for size in range(max(12, round(min(width, height) * .085)), 7, -1):
                font = ImageFont.truetype(str(filename), size)
                unknown = font.getmask('\U0010ffff')
                absent = [char for char in set(text) if not char.isspace()
                          and font.getmask(char).size == unknown.size
                          and bytes(font.getmask(char)) == bytes(unknown)]
                if absent:
                    break
                bounds = font.getbbox(text.replace('\n', ' '))
                if bounds[2] <= width * .91 and bounds[3] - bounds[1] <= height * .14:
                    return font, []
        except (OSError, ValueError):
            continue
    raise ValueError('未找到能完整显示当前文案的字体；请选择支持这些字符的字体或缩短文案。')


def fitted(source, size, caption, pixel, full_bleed=False):
    width, height = size
    available = (width * (1 if full_bleed else .86), height * ((.83 if caption else 1) if full_bleed else (.73 if caption else .90)))
    scale = min(available[0] / source.width, available[1] / source.height)
    result = source.resize((max(1, round(source.width * scale)), max(1, round(source.height * scale))),
                           Image.Resampling.NEAREST if pixel else Image.Resampling.LANCZOS)
    return result, scale > 1.02


def add_caption(image, caption, font, style, time):
    if not caption or font is None:
        return
    text = caption.replace('\n', ' ')
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font, stroke_width=1)
    x, y = (image.width - (right - left)) / 2, image.height * .965 - bottom
    if style == 'type-linked':
        x += image.width * .012 * cos(2 * pi * time)
        y += image.height * .009 * cos(2 * pi * time)
    draw.text((round(x), round(y)), text, font=font, fill='#18263c',
              stroke_width=max(1, round(image.width / 256)), stroke_fill='white')


def put_source(source, size, caption, pixel, full_bleed=False):
    sprite, enlarged = fitted(source, size, caption, pixel, full_bleed)
    canvas = Image.new('RGBA', size)
    x, y = round((size[0] - sprite.width) / 2), round((size[1] * (.84 if caption else 1) - sprite.height) / 2)
    canvas.alpha_composite(sprite, (x, y))
    sprite.close()
    return canvas, enlarged


def timeline(loop_ms, count):
    base, extra = divmod(loop_ms // 10, count)
    if base < 1:
        raise ValueError('当前时长不足以容纳指定帧数。')
    return [(base + (index < extra)) * 10 for index in range(count)]


def flatten(image, transparent):
    if transparent:
        return image
    matte = Image.new('RGBA', image.size, 'white')
    matte.alpha_composite(image)
    image.close()
    return matte


def render_frames(manifest, entry, sources, directory):
    size = (manifest['width'], manifest['height'])
    pixel = manifest['style'] in {'pixel-light', 'pixel-actions'}
    font, warnings = caption_font(manifest.get('fontPath'), entry['caption'], *size)
    paths, hashes = [], set()
    is_states = manifest['style'] in TWO_STATES
    is_poses = len(entry['frames']) > 1 and not is_states
    count = len(entry['frames']) if is_poses else round(manifest['loopMs'] * manifest['fps'] / 1000)
    durations = [frame['durationMs'] for frame in entry['frames']] if is_poses else timeline(manifest['loopMs'], count)
    if is_poses and sum(durations) != manifest['loopMs']:
        warnings.append('实际时长按各关键帧时长合计；与项目总时长不同。')
    if not is_poses:
        warnings.append('双状态切换动效，不代表独立逐字动画或完整连续人物动作。' if is_states
                        else '本地轻动效，不代表重新生成了连续人物姿态。')
    work = directory / '.planned'
    work.mkdir()
    source_a = crop_frame(entry['frames'][0], sources)
    source_b = crop_frame(entry['frames'][1], sources) if is_states else None
    try:
        alpha = source_a.getchannel('A')
        if manifest['background'] == 'transparent' and alpha.getextrema()[0] == 255:
            warnings.append('源素材本身不透明，已保留原背景；透明画布不等于自动抠图。')
        alpha.close()
        if is_states and source_a.size == source_b.size and sha256(source_a.tobytes()).digest() == sha256(source_b.tobytes()).digest():
            raise ValueError('两个关键状态完全相同，无法制作真实状态切换，请替换其中一张。')
        for index in range(count):
            time = index / max(1, count - 1)
            if is_poses:
                source = crop_frame(entry['frames'][index], sources)
                hashes.add((source.size, sha256(source.tobytes()).digest()))
                frame, enlarged = put_source(source, size, entry['caption'], pixel)
                source.close()
            elif is_states:
                frame, enlarged = put_source(source_a, size, entry['caption'], pixel, True)
                alternate, second_enlarged = put_source(source_b, size, entry['caption'], pixel, True)
                phase = (1 - cos(2 * pi * time)) / 2
                band = max(4, round(size[0] / 28))
                mask = Image.new('L', size)
                draw = ImageDraw.Draw(mask)
                opening = round(phase * band)
                for x in range(0, size[0], band):
                    if opening:
                        draw.rectangle((x, 0, min(size[0] - 1, x + opening - 1), size[1]), fill=255)
                frame.paste(alternate, (0, 0), mask)
                alternate.close()
                mask.close()
                enlarged = enlarged or second_enlarged
            else:
                sprite, enlarged = fitted(source_a, size, entry['caption'], pixel)
                frame = animate(sprite, entry['motion'], time, size, pixel, bool(entry['caption']))
                sprite.close()
            if enlarged:
                warnings.append('源裁切有效分辨率低于输出画布，已等比适配；放大不会补回原图细节。')
            add_caption(frame, entry['caption'], font, manifest['style'], time)
            frame = flatten(frame, manifest['background'] == 'transparent')
            filename = work / f'{index:03d}.png'
            frame.save(filename, format='PNG')
            frame.close()
            paths.append(filename)
        if manifest['style'] in FULL_ACTIONS and len(hashes) < 2:
            raise ValueError('连续姿态没有实际画面变化，请修复图集，未用晃动冒充完整动作。')
    finally:
        source_a.close()
        if source_b:
            source_b.close()
    return paths, durations, list(dict.fromkeys(warnings))
