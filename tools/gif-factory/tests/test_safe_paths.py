import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from safe_paths import regular_path
from main import output_folder
from manifest import ordinary_file


@unittest.skipUnless(sys.platform == 'darwin', 'macOS system aliases')
class MacSystemPathsTest(unittest.TestCase):
    def test_tmp_alias_accepts_real_input_and_empty_output(self):
        with tempfile.TemporaryDirectory(prefix='xuzuo-system-alias-', dir='/tmp') as folder:
            root = Path(folder)
            source = root / 'source.png'
            source.write_bytes(b'owned fixture')
            output = root / 'output'
            output.mkdir()
            self.assertEqual(ordinary_file(str(source)), source.resolve())
            self.assertEqual(output_folder(str(output)), output.resolve())

    def test_system_alias_does_not_allow_a_nested_user_symlink(self):
        with tempfile.TemporaryDirectory(prefix='xuzuo-system-alias-', dir='/tmp') as folder:
            root = Path(folder)
            target = root / 'target'
            target.mkdir()
            source = target / 'source.png'
            source.write_bytes(b'owned fixture')
            link = root / 'redirect'
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, '符号链接'):
                ordinary_file(str(link / 'source.png'))
            with self.assertRaisesRegex(ValueError, '符号链接'):
                output_folder(str(link))

    def test_relative_path_is_not_admitted(self):
        with self.assertRaises(ValueError):
            regular_path('relative/source.png')
