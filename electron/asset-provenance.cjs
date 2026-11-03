const fields = ['builtinId', 'packId', 'origin', 'author', 'licenseId', 'licenseName', 'licenseUrl', 'sourceUrl', 'usageNote', 'licenseNotice'];
function assetProvenance(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || fields.some(field => typeof value[field] !== 'string' || value[field].length > (field === 'licenseNotice' ? 30000 : 2000)) || Object.keys(value).some(field => !fields.includes(field)) || !['original', 'open-source'].includes(value.origin) || !/^[A-Za-z0-9-]{1,100}$/.test(value.builtinId)) throw new Error('素材来源与授权信息无效，原文件仍保留。');
  for (const field of ['licenseUrl', 'sourceUrl']) {
    if (field === 'sourceUrl' && !value[field] && value.origin === 'original') continue;
    try { const url = new URL(value[field]); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid'); }
    catch { throw new Error('素材来源链接无效，未加入项目。'); }
  }
  return Object.fromEntries(fields.map(field => [field, value[field]]));
}
module.exports = { assetProvenance };
