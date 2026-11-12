const { createHash } = require('node:crypto');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const { inspectPresentation, inspectWord, inspectSpreadsheet } = require('./delivery-preflight-office.cjs');
const OFFICE = { ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

async function inspectImage(file, binding, loadModule) {
  const type = imageType(file.buffer); if (type.mimeType !== file.mimeType) throw Error('文件内容与登记的图像类型不一致。');
  const size = rasterDimensions(file.buffer);
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width <= 0 || size.height <= 0 || size.width > 16384 || size.height > 16384) throw Error('实际图片尺寸不在本地预检范围内。');
  const target = { projectId: file.projectId, artifactId: file.id, sha256: file.sha256, ...(Number.isSafeInteger(binding?.sourceRevision) ? { sourceRevision: binding.sourceRevision } : {}) };
  const checks = [{ id: file.id + '-dimensions', artifactId: file.id, label: '实际图片尺寸', status: 'passed', method: 'image', detail: `读取真实文件：${size.width} × ${size.height}${type.frames ? `，${type.frames}帧` : ''}。未提供交付目标时，此项只验证尺寸可读。` }], findings = [];
  if (type.mimeType === 'image/png' && size.width * size.height <= 16777216) {
    const bitmap = loadModule('pngjs').PNG.sync.read(file.buffer, { checkCRC: true }); let transparent = 0;
    for (let index = 3; index < bitmap.data.length; index += 4) if (bitmap.data[index] < 255) transparent++;
    checks.push({ id: file.id + '-alpha', artifactId: file.id, label: '透明像素实测', status: 'passed', method: 'image', detail: transparent ? `已解码到 ${transparent} 个非不透明像素；透明边缘和主体质量仍需目视核对。` : '实际像素完全不透明；若要透明素材，请先处理背景。此项不代表透明要求已满足。' });
  } else if (type.mimeType !== 'image/jpeg') {
    checks.push({ id: file.id + '-alpha', artifactId: file.id, label: '透明边缘', status: 'unverified', method: 'image', detail: type.mimeType === 'image/png' ? '图片超过1600万像素，未在主流程解码整幅像素；请打开检查。' : '当前未逐像素验证此格式的透明区域，请打开完整画面检查。' });
  }
  findings.push({ id: file.id + '-visual', severity: 'unverified', label: '画面与使用范围需要人工核对', detail: '文件尺寸和透明通道不能证明文字、人物一致性、裁切或素材授权符合交付要求。', method: 'image', target });
  return { checks, findings, facts: { ...size, frames: type.frames } };
}

async function analyzeDeliveryArtifact({ file: input, binding } = {}, loadModule = require) {
  const file = { ...input, buffer: Buffer.from(input?.buffer || []) };
  if (!file.buffer.length || file.buffer.length > 32 * 1024 * 1024) throw Error('格式预检支持单个不超过32MB的文件。');
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  if (sha256 !== file.sha256) throw Error('预检输入的实际内容与文件指纹不一致。');
  let result;
  if (file.mimeType === OFFICE.ppt) result = await inspectPresentation(file, binding, loadModule);
  else if (file.mimeType === OFFICE.word) result = await inspectWord(file, binding, loadModule);
  else if (file.mimeType === OFFICE.excel) result = await inspectSpreadsheet(file, binding, loadModule);
  else if (file.mimeType.startsWith('image/')) result = await inspectImage(file, binding, loadModule);
  else throw Error('格式预检支持真实的Word、PPT、Excel和图片成品。');
  return { ...result, checks: [{ id: file.id + '-file', artifactId: file.id, label: '真实文件与指纹', status: 'passed', method: 'file', detail: `${file.name} · SHA256 ${sha256.slice(0, 12)}，只读检查，原文件保持不变。` }, ...result.checks] };
}
module.exports = { analyzeDeliveryArtifact, OFFICE };
