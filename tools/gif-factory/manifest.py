"""Strict offline input contract for the desktop animation helper."""
from pathlib import Path
from math import isfinite
import re
from PIL import Image
from safe_paths import regular_path

STYLES = {'pixel-light', 'pixel-actions', 'illustrated-actions', 'photo-people',
          'photo-pets', 'clay-mascot', 'lenticular', 'type-linked', 'comic-fusion'}
MOTIONS = {'nod', 'jump', 'sway', 'startle', 'tremble', 'ponder', 'breathe',
           'stomp', 'rush', 'peek', 'pulse', 'pop', 'offer', 'lean', 'droop', 'dance'}
FULL_ACTIONS = {'pixel-actions', 'illustrated-actions', 'clay-mascot'}
TWO_STATES = {'lenticular', 'type-linked', 'comic-fusion'}
MAX_FRAMES = 120
MAX_PIXELS = 48_000_000
MAX_SOURCE_PIXELS = 16_000_000
Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS


def integer(value, minimum, maximum, label):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f'{label}须为{minimum}至{maximum}之间的整数。')
    return value


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', value):
        raise ValueError('动画素材或条目的编号无效。')
    return value


def ordinary_file(value):
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError('源素材须为已登记的本机绝对路径。')
    source = regular_path(value)
    if not source.is_file() or not 0 < source.stat().st_size <= 64 * 1024 * 1024:
        raise ValueError('源素材不存在或超过64MB，请重新选择图片。')
    return source.resolve(strict=True)


def fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - allowed:
        raise ValueError(f'{label}含不支持的字段。')


def text(value, maximum, label):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 and c != '\n' for c in value):
        raise ValueError(f'{label}无效或过长。')


def frame_bounds(frame, sources):
    if frame['atlasId'] not in sources:
        raise ValueError('所选关键帧没有对应的源图集。')
    width, height = sources[frame['atlasId']]['size']
    columns, rows = frame['grid']
    column, row = frame['cell']
    if column >= columns or row >= rows:
        raise ValueError('关键帧位置超出了图集网格。')
    bounds = frame.get('crop') or [column * width // columns, row * height // rows,
                                    (column + 1) * width // columns, (row + 1) * height // rows]
    left, top, right, bottom = bounds
    if not 0 <= left < right <= width or not 0 <= top < bottom <= height:
        raise ValueError('裁切范围超出了源图，未自动截断或覆盖原稿。')
    return tuple(bounds)


def validate(value):
    fields(value, {'version', 'mode', 'style', 'title', 'width', 'height', 'fps', 'loopMs',
                   'background', 'fontPath', 'atlases', 'entries', 'exportFrames'}, '动画参数')
    if value.get('version') != 1 or isinstance(value.get('version'), bool):
        raise ValueError('动画参数版本不受支持。')
    if value.get('mode') not in {'atlas', 'gif'} or value.get('style') not in STYLES:
        raise ValueError('请选择支持的图集用途和动画风格。')
    if value.get('background') not in {'transparent', 'opaque'}:
        raise ValueError('请选择透明或不透明背景。')
    if value.get('exportFrames') is not None and not isinstance(value['exportFrames'], bool):
        raise ValueError('帧包导出选项须为布尔值。')
    text(value.get('title'), 200, '标题')
    width = integer(value.get('width'), 16, 4096, '画布宽度')
    height = integer(value.get('height'), 16, 4096, '画布高度')
    if width * height > MAX_SOURCE_PIXELS:
        raise ValueError('单帧超过1600万像素，请缩小画布。')
    fps = value.get('fps')
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not isfinite(fps) or not 1 <= fps <= 50:
        raise ValueError('采样帧率须为1至50之间的有限数值。')
    total = integer(value.get('loopMs'), 20, 30_000, '循环时长')
    if total % 10:
        raise ValueError('GIF时长须为10毫秒的整数倍。')
    if value.get('fontPath') is not None:
        font = ordinary_file(value['fontPath'])
        if font.suffix.lower() not in {'.ttf', '.otf', '.ttc'}:
            raise ValueError('请选择TrueType或OpenType字体。')
    atlases, entries = value.get('atlases'), value.get('entries')
    if not isinstance(atlases, list) or not 1 <= len(atlases) <= 1000:
        raise ValueError('请先准备1至1000份静态源图。')
    sources = {}
    for atlas in atlases:
        fields(atlas, {'id', 'path'}, '源图')
        key = identifier(atlas.get('id'))
        if key in sources:
            raise ValueError('源图编号不能重复。')
        source = ordinary_file(atlas.get('path'))
        with Image.open(source) as image:
            if image.format not in {'PNG', 'JPEG', 'WEBP'} or getattr(image, 'n_frames', 1) != 1:
                raise ValueError('动画源图须为静态PNG、JPEG或WebP，外部动图请先选帧。')
            if image.width * image.height > MAX_SOURCE_PIXELS:
                raise ValueError('源图超过1600万像素，请先缩小。')
            orientation = image.getexif().get(274, 1)
            size = (image.height, image.width) if orientation in {5, 6, 7, 8} else image.size
        with Image.open(source) as checked:
            checked.verify()
        sources[key] = {'path': source, 'size': size}
    if not isinstance(entries, list) or not 1 <= len(entries) <= 1000:
        raise ValueError('动画条目数量须为1至1000。')
    seen = set()
    for entry in entries:
        fields(entry, {'id', 'caption', 'motion', 'frames'}, '动画条目')
        key = identifier(entry.get('id'))
        if key in seen:
            raise ValueError('动画条目编号不能重复。')
        seen.add(key)
        text(entry.get('caption'), 200, '文案')
        if entry.get('motion') not in MOTIONS:
            raise ValueError('请选择支持的轻动效。')
        frames = entry.get('frames')
        if not isinstance(frames, list) or not 1 <= len(frames) <= MAX_FRAMES:
            raise ValueError('每个条目须有1至120个实际关键状态。')
        pixels = 0
        for frame in frames:
            fields(frame, {'atlasId', 'cell', 'grid', 'crop', 'durationMs'}, '关键帧')
            identifier(frame.get('atlasId'))
            for label, pair, minimum in [('网格', frame.get('grid'), 1), ('格位置', frame.get('cell'), 0)]:
                if not isinstance(pair, list) or len(pair) != 2:
                    raise ValueError(f'{label}须有横纵两个值。')
                for number in pair:
                    integer(number, minimum, 256, label)
            if frame.get('crop') is not None:
                if not isinstance(frame['crop'], list) or len(frame['crop']) != 4:
                    raise ValueError('裁切范围须为左、上、右、下四个源像素值。')
                for number in frame['crop']:
                    integer(number, 0, 16_000_000, '裁切坐标')
            duration = integer(frame.get('durationMs'), 10, 30_000, '单帧时长')
            if duration % 10:
                raise ValueError('单帧时长须为10毫秒的整数倍。')
            left, top, right, bottom = frame_bounds(frame, sources)
            pixels += (right - left) * (bottom - top)
        if value['mode'] == 'gif':
            if value['style'] not in FULL_ACTIONS | TWO_STATES and len(frames) != 1:
                raise ValueError('轻动效只使用一个源姿态；多个关键状态请切换连续动作风格。')
            count = len(frames) if len(frames) > 1 and value['style'] not in TWO_STATES else round(total * value['fps'] / 1000)
            if value['style'] in FULL_ACTIONS and len(frames) < 2:
                raise ValueError('完整动作至少需要两张真实连续姿态，不能用整图摇晃代替。')
            if value['style'] in TWO_STATES and len(frames) != 2:
                raise ValueError('光栅卡和动态海报需要两张不同的关键状态。')
            if not 2 <= count <= MAX_FRAMES or width * height * count > MAX_PIXELS:
                raise ValueError('动画超过120帧或4800万累计像素，请缩小尺寸、帧率或时长。')
            if sum(frame['durationMs'] for frame in frames) > 30_000:
                raise ValueError('关键帧累计时长超过30秒。')
        elif pixels > MAX_PIXELS:
            raise ValueError('拆分图集超过4800万累计像素，请分批处理。')
    return value, sources
