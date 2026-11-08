import copy
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from zipfile import ZipFile

from PIL import Image, ImageDraw, ImageSequence

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from main import output_folder, render
from manifest import STYLES, FULL_ACTIONS, TWO_STATES, validate


class AnimationRuntimeTest(unittest.TestCase):
    def cp1252_render(self, manifest, folder):
        environment = {key: value for key, value in os.environ.items() if key.upper() in
                       {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC'}}
        environment.update(PYTHONIOENCODING='cp1252', PYTHONUTF8='0', PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1')
        return subprocess.run([sys.executable, '-B', str(Path(__file__).resolve().parents[1] / 'main.py'),
                               'render', '--output', str(folder)],
                              input=json.dumps(manifest, ensure_ascii=False).encode('utf-8'),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment,
                              timeout=20, check=False)

    def test_cp1252_success_protocol_is_ascii_and_restores_chinese_warnings(self):
        source = self.root / '中文原图集.png'
        source.write_bytes(self.atlas.read_bytes())
        folder = self.root / '中文成功输出'
        folder.mkdir()
        manifest = self.manifest()
        manifest.update(title='中文动画协议回归', width=128, height=128)
        manifest['atlases'][0]['path'] = str(source)
        manifest['entries'][0]['caption'] = '你好'
        result = self.cp1252_render(manifest, folder)
        self.assertEqual(result.returncode, 0, result.stderr.decode('ascii', errors='replace'))
        self.assertTrue(result.stdout.isascii())
        self.assertNotIn(b'UnicodeEncodeError', result.stderr)
        response = json.loads(result.stdout.decode('ascii'))
        self.assertTrue(any('本地轻动效' in warning for warning in response['outputs'][0]['report']['warnings']))
        self.assertTrue((folder / response['outputs'][0]['gifPath']).is_file())
        self.assertEqual(source.read_bytes(), self.atlas.read_bytes())

    def test_cp1252_error_protocol_is_ascii_and_restores_chinese_error(self):
        source = self.root / '中文错误原图集.png'
        source.write_bytes(self.atlas.read_bytes())
        folder = self.root / '中文失败输出'
        folder.mkdir()
        manifest = self.manifest()
        manifest['title'] = '中文错误协议回归'
        manifest['atlases'][0]['path'] = str(source)
        manifest['entries'][0]['frames'][0]['crop'] = [0, 0, 10000, 64]
        result = self.cp1252_render(manifest, folder)
        self.assertEqual(result.returncode, 1)
        self.assertTrue(result.stdout.isascii())
        self.assertNotIn(b'UnicodeEncodeError', result.stderr)
        response = json.loads(result.stdout.decode('ascii'))
        self.assertIn('裁切范围超出了源图', response['error'])
        self.assertEqual(list(folder.iterdir()), [])
        self.assertEqual(source.read_bytes(), self.atlas.read_bytes())

    def test_light_motion_does_not_silently_ignore_additional_source_poses(self):
        value = self.manifest()
        value['entries'][0]['frames'].append(copy.deepcopy(value['entries'][0]['frames'][0]))
        with self.assertRaisesRegex(ValueError, '一个源姿态'):
            validate(value)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='xuzuo-animation-python-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.atlas = self.root / 'source.png'
        image = Image.new('RGBA', (128, 64))
        draw = ImageDraw.Draw(image)
        draw.rectangle((18, 12, 46, 52), fill='black')
        draw.rectangle((82, 8, 114, 44), fill='#e85575')
        image.save(self.atlas)
        image.close()
        self.original = sha256(self.atlas.read_bytes()).hexdigest()

    def manifest(self, style='pixel-light', mode='gif'):
        frames = [{'atlasId': 'source', 'cell': [0, 0], 'grid': [2, 1], 'durationMs': 80}]
        if style in FULL_ACTIONS | TWO_STATES:
            frames.append({'atlasId': 'source', 'cell': [1, 0], 'grid': [2, 1], 'durationMs': 120})
        return {'version': 1, 'mode': mode, 'style': style, 'title': 'Own synthetic fixture',
                'width': 64, 'height': 64, 'fps': 10, 'loopMs': 800, 'background': 'transparent',
                'atlases': [{'id': 'source', 'path': str(self.atlas)}],
                'entries': [{'id': 'entry-1', 'caption': '', 'motion': 'sway', 'frames': frames}]}

    def run_manifest(self, manifest, name='output'):
        output = self.root / name
        output.mkdir()
        result = render(manifest, output)
        self.assertEqual(sha256(self.atlas.read_bytes()).hexdigest(), self.original)
        return result, output

    def test_nine_routes_generate_actual_decodable_files(self):
        for style in sorted(STYLES):
            with self.subTest(style=style):
                manifest = self.manifest(style)
                result, folder = self.run_manifest(manifest, style)
                item = result['outputs'][0]
                self.assertEqual(item['entryId'], 'entry-1')
                with Image.open(folder / item['gifPath']) as gif:
                    self.assertEqual(gif.size, (64, 64))
                    self.assertEqual(gif.info['loop'], 0)
                    actual = [frame.info['duration'] for frame in ImageSequence.Iterator(gif)]
                self.assertEqual(sum(actual), item['report']['loopMs'])
                self.assertEqual(actual, item['report']['durationsMs'])
                self.assertEqual(len(actual), item['report']['frames'])
                self.assertEqual(len(actual), len(item['framePaths']))
                self.assertTrue(all((folder / filename).is_file() for filename in item['framePaths']))
                self.assertFalse((folder / 'entry-0001/.planned').exists())

    def test_split_atlas_keeps_exact_source_resolution_and_crop(self):
        manifest = self.manifest(mode='atlas')
        manifest['entries'][0]['frames'][0]['crop'] = [10, 11, 38, 43]
        result, folder = self.run_manifest(manifest)
        item = result['outputs'][0]
        self.assertNotIn('gifPath', item)
        with Image.open(folder / item['coverPath']) as cover:
            self.assertEqual(cover.size, (28, 32))
        self.assertEqual(item['report']['width'], 28)
        self.assertEqual(item['report']['height'], 32)
        self.assertEqual(item['report']['loopMs'], 0)

    def test_pixel_black_is_not_replaced_by_transparency_slot(self):
        result, folder = self.run_manifest(self.manifest())
        with Image.open(folder / result['outputs'][0]['coverPath']) as cover:
            pixels = list(cover.convert('RGBA').getdata())
            self.assertTrue(any(pixel == (0, 0, 0, 255) for pixel in pixels))
            self.assertTrue(any(pixel[3] == 0 for pixel in pixels))

    def test_jpeg_orientation_is_applied_before_crop_without_changing_original(self):
        source = self.root / 'oriented.jpg'
        image = Image.new('RGB', (20, 40), 'blue')
        ImageDraw.Draw(image).rectangle((0, 0, 19, 19), fill='red')
        exif = Image.Exif()
        exif[274] = 6
        image.save(source, exif=exif)
        image.close()
        before = sha256(source.read_bytes()).hexdigest()
        manifest = self.manifest(mode='atlas')
        manifest['atlases'][0]['path'] = str(source)
        manifest['entries'][0]['frames'][0]['grid'] = [1, 1]
        result, folder = self.run_manifest(manifest)
        with Image.open(folder / result['outputs'][0]['coverPath']) as cover:
            self.assertEqual(cover.size, (40, 20))
            self.assertGreater(cover.getpixel((5, 10))[2], 200)
            self.assertGreater(cover.getpixel((35, 10))[0], 200)
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), before)

    def test_opaque_output_has_no_transparent_pixels(self):
        manifest = self.manifest()
        manifest['background'] = 'opaque'
        result, folder = self.run_manifest(manifest)
        self.assertFalse(result['outputs'][0]['report']['transparent'])
        with Image.open(folder / result['outputs'][0]['gifPath']) as gif:
            self.assertTrue(all(frame.convert('RGBA').getchannel('A').getextrema() == (255, 255)
                                for frame in ImageSequence.Iterator(gif)))

    def test_full_action_requires_actual_different_poses(self):
        manifest = self.manifest('pixel-actions')
        manifest['entries'][0]['frames'][1] = copy.deepcopy(manifest['entries'][0]['frames'][0])
        with self.assertRaisesRegex(ValueError, '实际画面变化'):
            self.run_manifest(manifest)

    def test_full_action_never_falls_back_to_geometric_wiggle(self):
        manifest = self.manifest('illustrated-actions')
        manifest['entries'][0]['frames'] = manifest['entries'][0]['frames'][:1]
        with self.assertRaisesRegex(ValueError, '真实连续姿态'):
            validate(manifest)

    def test_two_identical_states_are_rejected(self):
        manifest = self.manifest('lenticular')
        manifest['entries'][0]['frames'][1] = copy.deepcopy(manifest['entries'][0]['frames'][0])
        with self.assertRaisesRegex(ValueError, '完全相同'):
            self.run_manifest(manifest)

    def test_real_frame_durations_are_not_replaced_by_nominal_fps(self):
        manifest = self.manifest('clay-mascot')
        result, _ = self.run_manifest(manifest)
        self.assertEqual(result['outputs'][0]['report']['durationsMs'], [80, 120])
        self.assertEqual(result['outputs'][0]['report']['loopMs'], 200)
        self.assertTrue(any('项目总时长不同' in text for text in result['outputs'][0]['report']['warnings']))

    def test_sampling_distributes_gif_time_units_without_losing_total(self):
        manifest = self.manifest()
        manifest.update(fps=12, loopMs=1000)
        result, _ = self.run_manifest(manifest)
        self.assertEqual(result['outputs'][0]['report']['loopMs'], 1000)
        self.assertTrue(all(duration % 10 == 0 for duration in result['outputs'][0]['report']['durationsMs']))

    def test_default_fractional_fps_is_accepted_with_exact_gif_timing(self):
        manifest = self.manifest('photo-people')
        manifest.update(fps=12.5, loopMs=1920)
        result, _ = self.run_manifest(manifest)
        self.assertEqual(result['outputs'][0]['report']['loopMs'], 1920)
        self.assertTrue(all(duration % 10 == 0 for duration in result['outputs'][0]['report']['durationsMs']))

    def test_gif_limits_checked_before_rendering(self):
        for settings in [dict(width=3072, height=3072), dict(fps=50, loopMs=6000)]:
            with self.subTest(settings=settings):
                manifest = self.manifest()
                manifest.update(**settings)
                with self.assertRaisesRegex(ValueError, '120帧|4800万'):
                    validate(manifest)

    def test_unknown_parameters_and_missing_sources_are_not_silently_used(self):
        manifest = self.manifest()
        manifest['apiKey'] = 'must-not-be-part-of-tool-protocol'
        with self.assertRaisesRegex(ValueError, '不支持的字段'):
            validate(manifest)
        del manifest['apiKey']
        manifest['entries'][0]['frames'][0]['atlasId'] = 'missing'
        with self.assertRaisesRegex(ValueError, '没有对应'):
            validate(manifest)

    def test_invalid_crop_and_duration_fail_with_concrete_message(self):
        manifest = self.manifest()
        manifest['entries'][0]['frames'][0]['crop'] = [0, 0, 150, 64]
        with self.assertRaisesRegex(ValueError, '裁切范围'):
            validate(manifest)
        del manifest['entries'][0]['frames'][0]['crop']
        manifest['entries'][0]['frames'][0]['durationMs'] = 83
        with self.assertRaisesRegex(ValueError, '10毫秒'):
            validate(manifest)

    def test_external_gif_is_not_sent_as_a_static_atlas(self):
        gif = self.root / 'external.gif'
        Image.new('RGB', (32, 32), 'red').save(gif)
        manifest = self.manifest()
        manifest['atlases'][0]['path'] = str(gif)
        with self.assertRaisesRegex(ValueError, '静态PNG'):
            validate(manifest)

    def test_unsupported_font_glyph_does_not_export_missing_character_box(self):
        manifest = self.manifest()
        manifest['entries'][0]['caption'] = '\U0010ffff'
        with self.assertRaisesRegex(ValueError, '字体'):
            self.run_manifest(manifest)

    def test_output_folder_must_be_empty_and_existing_files_preserved(self):
        target = self.root / 'keep'
        target.mkdir()
        source = target / 'original.png'
        source.write_bytes(b'original')
        with self.assertRaisesRegex(ValueError, '空输出目录'):
            output_folder(str(target))
        self.assertEqual(source.read_bytes(), b'original')

    def test_frame_zip_is_optional_actual_and_keeps_forward_slash_paths(self):
        manifest = self.manifest()
        manifest['exportFrames'] = True
        result, folder = self.run_manifest(manifest)
        self.assertIn('archivePath', result)
        with ZipFile(folder / result['archivePath']) as bundle:
            self.assertIsNone(bundle.testzip())
            self.assertEqual(len(bundle.namelist()), len(result['outputs'][0]['framePaths']))
            self.assertTrue(all('\\' not in name and '..' not in name for name in bundle.namelist()))
            for filename in result['outputs'][0]['framePaths']:
                self.assertEqual(bundle.read(Path(filename).as_posix()), (folder / filename).read_bytes())
        manifest['exportFrames'] = False
        without, _ = self.run_manifest(manifest, 'without-zip')
        self.assertNotIn('archivePath', without)

    def test_batch_entries_are_sequential_distinct_and_preserve_sources(self):
        manifest = self.manifest()
        manifest['entries'] = [{**copy.deepcopy(manifest['entries'][0]), 'id': f'item-{index}', 'motion': 'jump' if index % 2 else 'sway'} for index in range(12)]
        began = time.perf_counter()
        result, _ = self.run_manifest(manifest)
        self.assertEqual(len(result['outputs']), 12)
        self.assertEqual(len({item['gifPath'] for item in result['outputs']}), 12)
        print(json.dumps({'metric': 'synthetic-12-entry-batch', 'seconds': round(time.perf_counter() - began, 3), 'modelCalls': 0}))

    def test_default_lenticular_120_samples_fits_real_resource_and_timing_limits(self):
        manifest = self.manifest('lenticular')
        manifest.update(width=480, height=720, fps=20, loopMs=6000, background='opaque')
        manifest['atlases'] = []
        manifest['entries'][0]['frames'] = []
        for index, color in enumerate(['#e85575', '#358cbb']):
            source = self.root / f'state-{index}.png'
            image = Image.new('RGB', (480, 720), 'black')
            ImageDraw.Draw(image).rectangle((60, 60, 420, 650), fill=color)
            image.save(source)
            image.close()
            manifest['atlases'].append({'id': f'state-{index}', 'path': str(source)})
            manifest['entries'][0]['frames'].append({'atlasId': f'state-{index}', 'cell': [0, 0], 'grid': [1, 1], 'durationMs': 3000})
        began = time.perf_counter()
        result, folder = self.run_manifest(manifest)
        item = result['outputs'][0]
        self.assertEqual(item['report']['loopMs'], 6000)
        self.assertLessEqual(item['report']['frames'], 120)
        self.assertGreaterEqual(item['report']['frames'], 2)
        self.assertEqual(item['report']['loop'], 0)
        with Image.open(folder / item['gifPath']) as gif:
            self.assertTrue(all(frame.convert('RGB').getpixel((0, 0)) == (0, 0, 0) for frame in ImageSequence.Iterator(gif)))
        print(json.dumps({'metric': 'synthetic-default-lenticular', 'seconds': round(time.perf_counter() - began, 3), 'actualFrames': item['report']['frames'], 'loopMs': item['report']['loopMs'], 'modelCalls': 0}))


if __name__ == '__main__':
    unittest.main()
