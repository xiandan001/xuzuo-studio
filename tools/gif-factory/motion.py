"""Local restrained motion, adapted from gif-factory's MIT atlas exporter."""
from math import cos, exp, pi, sin
from PIL import Image


def transform(kind, t):
    wave = sin(2 * pi * t)
    bounce = max(0.0, sin(2 * pi * t))
    if kind == 'nod':
        return 0, 4 * wave, 1, 1 - .018 * wave, 2.2 * wave
    if kind == 'jump':
        return 0, -18 * bounce, 1 + .02 * bounce, 1 + .04 * bounce, 0
    if kind == 'sway':
        return 7 * wave, 0, 1, 1, 4 * wave
    if kind == 'startle':
        kick = exp(-((t - .35) / .1) ** 2)
        return 0, -11 * kick, 1 + .045 * kick, 1 + .06 * kick, -3 * kick
    if kind == 'tremble':
        return 2.8 * sin(12 * pi * t), 0, 1, 1, 1.2 * sin(12 * pi * t)
    if kind == 'ponder':
        return 0, 1.5 * wave, 1, 1, 3 * wave
    if kind == 'breathe':
        return 0, -.8 * wave, 1 + .012 * wave, 1 + .018 * wave, 0
    if kind == 'stomp':
        return 3 * wave, 4 * abs(wave), 1, 1 - .02 * abs(wave), 2 * wave
    if kind == 'rush':
        return 9 * wave, -2 * abs(wave), 1, 1, -5 * wave
    if kind == 'peek':
        return 8 * wave, 0, 1, 1, 2 * wave
    if kind in {'pulse', 'pop'}:
        pulse = .035 * wave if kind == 'pulse' else .06 * bounce
        return 0, -3 * bounce, 1 + pulse, 1 + pulse, 0
    if kind == 'offer':
        return 0, -5 * bounce, 1 + .025 * bounce, 1 + .025 * bounce, 1.5 * wave
    if kind == 'lean':
        return 4 * wave, 0, 1, 1, 5 * wave
    if kind == 'droop':
        return 0, 5 * bounce, 1 + .01 * bounce, 1 - .025 * bounce, -2 * bounce
    if kind == 'dance':
        return 7 * wave, -5 * abs(wave), 1, 1, 5 * wave
    raise ValueError('不支持的轻动效。')


def animate(sprite, motion, t, size, pixel, caption=False):
    dx, dy, sx, sy, angle = transform(motion, t)
    scale = min(size) / 512
    resample = Image.Resampling.NEAREST if pixel else Image.Resampling.BICUBIC
    changed = sprite.resize((max(1, round(sprite.width * sx)), max(1, round(sprite.height * sy))), resample)
    rotated = changed.rotate(angle, resample=Image.Resampling.NEAREST if pixel else Image.Resampling.BICUBIC, expand=True)
    changed.close()
    canvas = Image.new('RGBA', size)
    canvas.alpha_composite(rotated, (round((size[0] - rotated.width) / 2 + dx * scale),
                                     round((size[1] * (.82 if caption else 1) - rotated.height) / 2 + dy * scale)))
    rotated.close()
    return canvas
