const { parentPort, workerData } = require('node:worker_threads');
async function run() {
  if (workerData.task === 'delivery-preflight') return require('./delivery-preflight-analysis.cjs').analyzeDeliveryArtifact(workerData.input);
  if (workerData.task === 'commerce-compose') return require('./commerce-compositor.cjs').composeCommerceImage(workerData.input);
  if (workerData.task === 'commerce-alpha') return require('./commerce-compositor.cjs').applyCommerceAlpha(workerData.input);
  if (workerData.task === 'commerce-protect') return require('./commerce-compositor.cjs').protectCommercePixels(workerData.input);
  if (workerData.task === 'commerce-preview') return require('./commerce-compositor.cjs').previewCommerceRaster(workerData.input);
  if (workerData.task === 'business-listing-zip') return require('./business-listing.cjs').createListingZip(workerData.input);
  if (workerData.task === 'bead') return require('./bead-pattern.runtime.cjs').createBeadPattern(workerData.input.raster, workerData.input.settings, workerData.input.palette);
  if (workerData.task === 'bead-export') return require('./bead-exports.cjs').createBeadExport(workerData.input);
  if (workerData.task === 'bead-bundle') return require('./bead-exports.cjs').createBeadBundle(workerData.input);
  if (workerData.task === 'wallpaper') return require('./wallpaper-worker.cjs').fitWallpaperPng(workerData.input);
  if (workerData.task === 'engineering') return require('./wallpaper-worker.cjs').fitEngineeringPng(workerData.input);
  if (workerData.task === 'reference-text') return require('./reference-text.cjs').extractReferenceText(workerData.input);
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
