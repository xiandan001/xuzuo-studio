const RELEASES_URL = 'https://api.github.com/repos/xiandan001/xuzuo-studio/releases?per_page=20';
const ASSET_BASE = 'https://github.com/xiandan001/xuzuo-studio/releases/download/';

function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)) throw Error('更新版本号无效。');
  const parts = value.split('+')[0].split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error('更新版本号超出范围。');
  return parts;
}
function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}
function tagVersion(tag) {
  if (typeof tag !== 'string') throw Error('更新标签无效。');
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  versionParts(version); return version;
}
function assertAssetUrl(value, tag, filename) {
  const expected = ASSET_BASE + encodeURIComponent(tag) + '/' + encodeURIComponent(filename);
  let url; try { url = new URL(value); } catch { throw Error('更新资源地址无效。'); }
  if (url.href !== expected || url.protocol !== 'https:' || url.username || url.password) throw Error('更新资源不属于指定 GitHub 仓库。');
  return url.href;
}
function isAllowedDownloadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port
      && ['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'].includes(url.hostname);
  } catch { return false; }
}
function selectRelease(input, currentVersion) {
  versionParts(currentVersion);
  if (!Array.isArray(input)) throw Error('GitHub 更新列表格式异常。');
  const releases = [];
  for (const value of input) {
    if (!value || value.draft || value.prerelease) continue;
    try { const version = tagVersion(value.tag_name); if (compareVersions(version, currentVersion) > 0) releases.push({ ...value, version, tag: value.tag_name }); } catch { /* Unsupported release tags are not stable application versions. */ }
  }
  releases.sort((a, b) => compareVersions(b.version, a.version));
  if (!releases.length) return null;
  const release = releases[0], manifest = release.assets?.find(asset => asset.name === 'latest.yml');
  if (!manifest) throw Error('更新版本未提供 latest.yml。');
  return { ...release, manifestUrl: assertAssetUrl(manifest.browser_download_url, release.tag, 'latest.yml') };
}
function validateUpdateRecord(value) {
  if (!value || typeof value !== 'object' || tagVersion(value.tag) !== value.version) throw Error('更新标签与清单版本不一致。');
  versionParts(value.version);
  if (typeof value.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,195}\.exe$/.test(value.filename)) throw Error('更新安装包文件名无效。');
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > 2 * 1024 * 1024 * 1024) throw Error('更新安装包大小无效。');
  if (typeof value.sha512 !== 'string' || Buffer.from(value.sha512, 'base64').length !== 64 || Buffer.from(value.sha512, 'base64').toString('base64') !== value.sha512) throw Error('更新安装包缺少有效 SHA-512。');
  return { version: value.version, tag: value.tag, filename: value.filename, size: value.size, sha512: value.sha512, url: assertAssetUrl(value.url, value.tag, value.filename) };
}
function parseUpdateManifest(text, release) {
  let value; try { value = JSON.parse(text); } catch { throw Error('更新清单格式异常。'); }
  if (!value || value.version !== release.version || !Array.isArray(value.files) || value.files.length !== 1) throw Error('更新标签与清单版本不一致。');
  const file = value.files[0], asset = release.assets?.find(item => item.name === file?.url);
  if (!asset) throw Error('更新清单中的安装包尚未发布。');
  if ((value.path !== undefined && value.path !== file.url) || (value.sha512 !== undefined && value.sha512 !== file.sha512)
    || (asset.size !== undefined && asset.size !== file.size)) throw Error('更新安装包信息不一致。');
  return validateUpdateRecord({ version: value.version, tag: release.tag, filename: file.url, size: file.size, sha512: file.sha512, url: asset.browser_download_url });
}

module.exports = { RELEASES_URL, compareVersions, selectRelease, parseUpdateManifest, validateUpdateRecord, assertAssetUrl, isAllowedDownloadUrl };
