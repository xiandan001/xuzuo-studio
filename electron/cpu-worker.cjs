const { parentPort, workerData } = require('node:worker_threads');
async function run() {
  if (workerData.task === 'office') return require('./office-render.cjs').renderOffice(workerData.input);
  if (workerData.task === 'image-alpha') {
    const { bitmap, width, height } = workerData.input;
    if (!width || !height || width * height > 16777216 || bitmap.length !== width * height * 4) return { width, height, transparency: 'unknown' };
    for (let index = 3; index < bitmap.length; index += 4) if (bitmap[index] < 255) return { width, height, transparency: 'present' };
    return { width, height, transparency: 'opaque' };
  }
  throw new Error('Unsupported CPU task');
}
run().then(result => parentPort.postMessage({ result }), error => parentPort.postMessage({ error: error.message || '后台文件处理未完成。' }));
