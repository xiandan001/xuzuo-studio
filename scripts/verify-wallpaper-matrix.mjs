import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencyRoot = fs.existsSync(path.join(root, 'node_modules/pngjs/package.json')) ? root : path.join(root, 'work/ui-build');
const require = createRequire(path.join(dependencyRoot, 'package.json')), { PNG } = require('pngjs');
const { createCpuTasks } = createRequire(import.meta.url)('../electron/cpu-tasks.cjs');
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
const source = new PNG({ width: 24, height: 36 });
for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
  const at = (y * source.width + x) * 4;
  source.data[at] = x < 12 ? 230 : 20; source.data[at + 1] = y < 18 ? 190 : 40; source.data[at + 2] = x < 12 ? 40 : 220; source.data[at + 3] = 255;
}
const buffer = PNG.sync.write(source), sha = value => createHash('sha256').update(value).digest('hex'), sourceSha256 = sha(buffer);
const catalog = fs.readFileSync(path.join(root, 'src/data/wallpaper-devices.ts'), 'utf8');
const dimensions = [...catalog.matchAll(/"width":\s*(\d+),\s*"height":\s*(\d+)/g)].map(match => [Number(match[1]), Number(match[2])]);
assert(dimensions.length >= 57, 'Verified catalogue dimensions missing from matrix');
const full = process.argv.includes('--full');
const cases = [...new Map([...dimensions.flatMap(([width, height]) => [[width, height], [height, width]]), [2160, 3840], [3840, 2160]].map(([width, height]) => [`${width}x${height}`, { width, height, fit: 'cover' }])).values()];
const selected = full ? cases : [cases[0], cases[1], { width: 2064, height: 2752, fit: 'contain' }, { width: 2160, height: 3840, fit: 'cover' }];
const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'xuzuo-wallpaper-matrix-'));
const inspector = path.join(directory, 'inspect.cjs');
await fsp.writeFile(inspector, `const {parentPort,workerData}=require('node:worker_threads');try{const {PNG}=require(workerData.input.pngModule);const image=PNG.sync.read(Buffer.from(workerData.input.buffer));let opaque=true;for(let i=3;i<image.data.length;i+=4)if(image.data[i]!==255){opaque=false;break;}parentPort.postMessage({result:{width:image.width,height:image.height,opaque,decodedPixels:image.width*image.height}});}catch(error){parentPort.postMessage({error:error.message});}\n`);
const createWorker = (file, options) => new Worker(file, { ...options, env: { ...process.env, NODE_PATH: path.join(dependencyRoot, 'node_modules') } });
const fitter = createCpuTasks({ createWorker }), decoder = createCpuTasks({ workerFile: inspector, createWorker });
let expected = performance.now() + 20, maxTimerDelayMs = 0, timerTicks = 0;
const timer = setInterval(() => { const at = performance.now(); maxTimerDelayMs = Math.max(maxTimerDelayMs, at - expected); expected = at + 20; timerTicks++; }, 20);
const results = [], started = performance.now();
try {
  for (const target of selected) {
    const at = performance.now(), png = Buffer.from(await fitter.run('wallpaper', { buffer, target }));
    const actual = await decoder.run('inspect', { buffer: png, pngModule: require.resolve('pngjs') });
    assert.equal(actual.width, target.width); assert.equal(actual.height, target.height); assert(actual.opaque); assert.equal(sha(buffer), sourceSha256);
    results.push({ ...target, ...actual, bytes: png.length, elapsedMs: Math.round(performance.now() - at) });
  }
  await fitter.drain(); await decoder.drain(); clearInterval(timer);
  const report = { passed: true, commit: process.env.GITHUB_SHA || 'local', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, fullMatrix: full, catalogueEntries: dimensions.length, cases: results.length, results, elapsedMs: Math.round(performance.now() - started), coordinator: { timerTicks, maxTimerDelayMs: Math.round(maxTimerDelayMs), outputDecodedInWorker: true }, sourceSha256, sourceUnchanged: sha(buffer) === sourceSha256, apiCalls: 0, guiOpened: false };
  await fsp.mkdir(path.join(root, 'work'), { recursive: true });
  const reportPath = path.join(root, 'work', `wallpaper-matrix-${full ? 'full' : 'sample'}.json`);
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, results: undefined, report: reportPath }));
} finally {
  clearInterval(timer); await fitter.drain(); await decoder.drain();
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert(path.basename(directory).startsWith('xuzuo-wallpaper-matrix-'));
  await fsp.rm(directory, { recursive: true, force: true });
}
