# Offline animation runtime

Private typed helper for Xuzuo Studio. The source algorithms and production
rules were reviewed at gif-factory revision
`17fcba20f19e8b3e64c448a574de384d767b23ab`; see
`assets/licenses/gif-factory.txt`. Upstream example art is not redistributed.

The helper needs only Python and Pillow in development. It performs no model
requests, network requests, shell execution, or FFmpeg calls. Packaged builds
include an onedir PyInstaller runtime, so users do not install Python or pip.

Build on Windows in the controlled CI environment:

```powershell
python -m pip install -r tools/gif-factory/build-requirements.txt
node scripts/build-animation-tool.mjs
python -m unittest discover -s tools/gif-factory/tests -v
```

Package `work/animation-runtime/xuzuo-animation` as the application resource
directory `animation-tool`. Development execution may explicitly select an
existing Python interpreter through `createAnimationTool({developmentPython})`.
No dependency installation is attempted by the application or build script.

`main.py status` reports protocol availability. `main.py render --output PATH`
reads a UTF-8 JSON `AnimationToolManifest` from stdin and requires an existing
empty output directory. Input image paths must already be admitted by the
project artifact service. Crop rectangles are absolute source-atlas pixels.

GIFs are sampled locally for restrained light-motion and two-state effects.
Full actions require at least two different actual poses. Split-atlas mode
preserves original crop dimensions. Actual GIF decoding produces cover PNGs,
frame PNGs, duration arrays, and technical reports; it does not claim aesthetic
review or commercial acceptance. GIF transparency is binary.

The process is single-task, low-priority and restricted to two available CPU
cores. The Node adapter serializes calls, scrubs its environment, bounds the
runtime, cancels its own process tree, and checks output paths. Pillow uses a
bounded shared palette with sequential disk-spooled frames. The hard limits
are 120 frames and 48 million cumulative pixels per animation, 16 million
source pixels, and 30 seconds. Frame ZIP output is opt-in and is streamed with
12,000 files / 200 MiB expanded / 100 MiB archive limits.
