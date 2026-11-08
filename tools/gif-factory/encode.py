"""Shared bounded palette and actual GIF decoding, adapted from MIT gif-factory."""
from hashlib import sha256
from math import ceil, sqrt
from PIL import Image, ImageSequence
from manifest import MAX_FRAMES, MAX_PIXELS


def shared_palette(paths):
    columns = max(1, ceil(sqrt(len(paths))))
    board = Image.new('RGB', (columns * 128, ceil(len(paths) / columns) * 128), 'white')
    for index, filename in enumerate(paths):
        with Image.open(filename) as source:
            rgba = source.convert('RGBA')
            rgba.thumbnail((128, 128), Image.Resampling.LANCZOS)
            board.paste(rgba, ((index % columns) * 128, (index // columns) * 128), rgba)
            rgba.close()
    palette = board.quantize(colors=254, dither=Image.Dither.NONE)
    colors = palette.getpalette()
    palette.putpalette((colors + colors[:3] * ((768 - len(colors)) // 3))[:768])
    board.close()
    return palette


def indexed_frames(paths, palette, transparent):
    colors = palette.getpalette()
    replacement = min(range(254), key=lambda index: sum((colors[index * 3 + channel] - colors[765 + channel]) ** 2 for channel in range(3)))
    remap = bytes([*range(255), replacement])
    for filename in paths:
        with Image.open(filename) as source:
            rgba = source.convert('RGBA')
            matte = Image.new('RGB', rgba.size, 'white')
            alpha = rgba.getchannel('A')
            matte.paste(rgba, (0, 0), alpha)
            rgba.close()
            frame = matte.quantize(palette=palette, dither=Image.Dither.NONE)
            matte.close()
            if transparent:
                mapped = frame.point(remap)
                frame.close()
                frame = mapped
            if transparent:
                missing = alpha.point(lambda a: 255 if a < 128 else 0)
                frame.paste(255, mask=missing)
                missing.close()
                frame.info['transparency'] = 255
            alpha.close()
            yield frame


def encode(paths, durations, destination, transparent):
    palette = shared_palette(paths)
    iterator = indexed_frames(paths, palette, transparent)
    first = next(iterator)
    try:
        options = dict(format='GIF', save_all=True, append_images=iterator,
                       duration=durations, loop=0, disposal=2, optimize=False)
        if transparent:
            options['transparency'] = 255
        first.save(destination, **options)
    finally:
        first.close()
        iterator.close()
        palette.close()
    if destination.stat().st_size > 64 * 1024 * 1024:
        raise ValueError('动画文件超过64MB，请缩小尺寸、帧率或时长。')


def decode_report(filename, directory, expected_size, expected_ms, requested_transparency, warnings):
    frames = directory / 'frames'
    frames.mkdir()
    paths, hashes, durations, transparent = [], set(), [], False
    with Image.open(filename) as gif:
        if gif.format != 'GIF' or gif.size != expected_size or gif.info.get('loop') != 0:
            raise ValueError('实际GIF尺寸或循环字段与请求不一致。')
        for index, source in enumerate(ImageSequence.Iterator(gif)):
            if index >= MAX_FRAMES or (index + 1) * gif.width * gif.height > MAX_PIXELS:
                raise ValueError('实际GIF超过120帧或4800万累计像素。')
            duration = source.info.get('duration', 0)
            if not isinstance(duration, int) or duration <= 0 or duration % 10:
                raise ValueError('实际GIF包含无效的单帧时长。')
            durations.append(duration)
            image = source.convert('RGBA')
            alpha = image.getchannel('A')
            transparent = transparent or alpha.getextrema()[0] == 0
            bounds = alpha.getbbox()
            if requested_transparency and bounds and (bounds[0] == 0 or bounds[1] == 0 or bounds[2] == image.width or bounds[3] == image.height):
                warnings.append('个别帧内容触及画布边缘，请检查裁切和主体安全边距。')
            alpha.close()
            hashes.add(sha256(image.tobytes()).digest())
            path = frames / f'frame-{index:03d}.png'
            image.save(path, format='PNG')
            if index == 0:
                image.save(directory / 'cover.png', format='PNG')
            image.close()
            paths.append(path)
    if sum(durations) != expected_ms:
        raise ValueError('实际解码时长与请求时序不一致。')
    if len(hashes) < 2:
        raise ValueError('实际GIF没有可见画面变化，请调整姿态或动效。')
    if requested_transparency and not transparent:
        warnings.append('实际GIF没有透明像素，源背景已保留；未声称完成了自动抠图。')
    if requested_transparency:
        warnings.append('GIF仅支持透明或不透明像素，半透明边缘与PNG不同。')
    return paths, {'width': expected_size[0], 'height': expected_size[1], 'frames': len(paths),
                   'loopMs': sum(durations), 'loop': 0, 'transparent': transparent, 'durationsMs': durations,
                   'warnings': list(dict.fromkeys(warnings))}
