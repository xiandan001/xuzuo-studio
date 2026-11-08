"""Allow only the three system-owned macOS aliases, then inspect every parent."""
from pathlib import Path
import sys


def regular_path(value):
    source = Path(value)
    if not source.is_absolute():
        raise ValueError('路径须为本机绝对位置。')
    if sys.platform == 'darwin':
        parts = source.parts
        if len(parts) > 1 and parts[1] in {'var', 'tmp', 'etc'}:
            alias = Path('/') / parts[1]
            target = Path('/private') / parts[1]
            if alias.is_symlink() and alias.resolve(strict=True) == target and not target.is_symlink() and target.is_dir():
                source = target.joinpath(*parts[2:])
    if source.is_symlink() or any(parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)()
                                  for parent in source.parents):
        raise ValueError('路径不能使用符号链接或重定向目录。')
    return source
