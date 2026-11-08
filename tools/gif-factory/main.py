"""Private offline command-line protocol for Xuzuo Studio animation tasks."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import sys
import time


def background_priority():
    if os.name == 'nt':
        kernel = ctypes.windll.kernel32
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        kernel.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        kernel.GetProcessAffinityMask.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_size_t)]
        kernel.SetProcessAffinityMask.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
        process = kernel.GetCurrentProcess()
        kernel.SetPriorityClass(process, 0x4000)
        available, system = ctypes.c_size_t(), ctypes.c_size_t()
        if kernel.GetProcessAffinityMask(process, ctypes.byref(available), ctypes.byref(system)):
            bits = [1 << index for index in range(available.value.bit_length()) if available.value & (1 << index)]
            kernel.SetProcessAffinityMask(process, ctypes.c_size_t(sum(bits[:2])))
    else:
        try:
            os.nice(5)
        except OSError:
            pass


def peak_memory_bytes():
    if os.name == 'nt':
        class Counters(ctypes.Structure):
            _fields_ = [('cb', ctypes.c_ulong), ('faults', ctypes.c_ulong)] + [(name, ctypes.c_size_t) for name in
                        ['peakWorking', 'working', 'peakPaged', 'paged', 'peakNonpaged', 'nonpaged', 'pagefile', 'peakPagefile']]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        kernel = ctypes.windll.kernel32
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        kernel.K32GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_ulong]
        if kernel.K32GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            return counters.peakWorking
        return None
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024)


def output_folder(value):
    folder = Path(value)
    if not folder.is_absolute() or folder.is_symlink():
        raise ValueError('输出位置须为独立的本机绝对目录。')
    if any(parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)() for parent in folder.parents):
        raise ValueError('输出目录不能使用符号链接或重定向位置。')
    if not folder.is_dir() or any(folder.iterdir()):
        raise ValueError('请使用专属空输出目录，工具不会覆盖已有产物。')
    return folder.resolve(strict=True)


def split_entry(entry, sources, folder):
    from render import crop_frame
    frames = folder / 'frames'
    frames.mkdir()
    paths, warnings = [], []
    for index, frame in enumerate(entry['frames']):
        image = crop_frame(frame, sources)
        filename = frames / f'frame-{index:03d}.png'
        image.save(filename, format='PNG')
        if index == 0:
            image.save(folder / 'cover.png', format='PNG')
            width, height = image.size
            transparent = image.getchannel('A').getextrema()[0] == 0
        elif image.size != (width, height):
            warnings.append('各源裁切分辨率不同，拆分PNG保持各自原尺寸。')
        image.close()
        paths.append(filename)
    return paths, dict(width=width, height=height, frames=len(paths), loopMs=0, loop=0,
                       transparent=transparent, warnings=warnings)


def render(manifest, output):
    from manifest import validate
    from render import render_frames
    from encode import encode, decode_report
    document, sources = validate(manifest)
    outputs = []
    for index, entry in enumerate(document['entries']):
        folder = output / f'entry-{index + 1:04d}'
        folder.mkdir()
        print(json.dumps({'stage': 'composing', 'entryId': entry['id']}), file=sys.stderr, flush=True)
        gif = None
        if document['mode'] == 'atlas':
            paths, report = split_entry(entry, sources, folder)
        else:
            planned, durations, warnings = render_frames(document, entry, sources, folder)
            temporary, gif = folder / 'animation.gif.tmp', folder / 'animation.gif'
            encode(planned, durations, temporary, document['background'] == 'transparent')
            paths, report = decode_report(temporary, folder, (document['width'], document['height']),
                                          sum(durations), document['background'] == 'transparent', warnings)
            temporary.rename(gif)
            for path in planned:
                path.unlink()
            (folder / '.planned').rmdir()
        result = {'entryId': entry['id'], 'coverPath': str((folder / 'cover.png').relative_to(output)),
                  'framePaths': [str(path.relative_to(output)) for path in paths], 'report': report}
        if gif:
            result['gifPath'] = str(gif.relative_to(output))
        (folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        outputs.append(result)
    result = {'outputs': outputs}
    if document.get('exportFrames'):
        from zipfile import ZipFile, ZIP_DEFLATED
        files = [output / name for item in outputs for name in item['framePaths']]
        if len(files) > 12_000 or sum(path.stat().st_size for path in files) > 200 * 1024 * 1024:
            raise ValueError('帧包超过12000个文件或200MB展开体积，请分批导出。')
        temporary = output / 'frames.zip.tmp'
        with ZipFile(temporary, 'w', compression=ZIP_DEFLATED, compresslevel=1) as bundle:
            for filename in files:
                bundle.write(filename, filename.relative_to(output).as_posix())
                if temporary.stat().st_size > 100 * 1024 * 1024:
                    raise ValueError('帧压缩包超过100MB，请分批导出。')
        if temporary.stat().st_size > 100 * 1024 * 1024:
            raise ValueError('帧压缩包超过100MB，请分批导出。')
        archive = output / 'frames.zip'
        temporary.rename(archive)
        result['archivePath'] = str(archive.relative_to(output))
    return result


def main():
    background_priority()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'render'])
    parser.add_argument('--output')
    args = parser.parse_args()
    import PIL
    if args.action == 'status':
        print(json.dumps({'available': True, 'protocol': 1, 'pillow': PIL.__version__, 'offline': True}), flush=True)
        return
    if not args.output:
        parser.error('render requires --output')
    folder = output_folder(args.output)
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('动画参数过大，请分批制作。')
    value = json.loads(raw.decode('utf-8'))
    began = time.perf_counter()
    result = render(value, folder)
    print(json.dumps({'stage': 'complete', 'elapsedMs': round((time.perf_counter() - began) * 1000),
                      'processPeakMemoryBytes': peak_memory_bytes(), 'entries': len(result['outputs'])}), file=sys.stderr, flush=True)
    print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, OverflowError, RuntimeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=True), flush=True)
        raise SystemExit(1)
