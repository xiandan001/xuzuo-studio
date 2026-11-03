import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { compareVersions, selectRelease, parseUpdateManifest, assertAssetUrl, isAllowedDownloadUrl } = createRequire(import.meta.url)('../../electron/update-release.cjs');
const repository = 'https://github.com/xiandan001/xuzuo-studio/releases/download';
const sha512 = createHash('sha512').update('installer').digest('base64');
const release = (version = '1.0.10') => ({ tag_name: `v${version}`, assets: [{ name: 'latest.yml', browser_download_url: `${repository}/v${version}/latest.yml` }, { name: `Xuzuo-Studio-Setup-${version}.exe`, browser_download_url: `${repository}/v${version}/Xuzuo-Studio-Setup-${version}.exe`, size: 9 }] });
const manifest = (version = '1.0.10') => ({ version, files: [{ url: `Xuzuo-Studio-Setup-${version}.exe`, sha512, size: 9 }] });

describe('stable GitHub release contract', () => {
  it('compares numeric version components and ignores build metadata', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
    expect(compareVersions('1.0.0+build.2', '1.0.0')).toBe(0);
    for (const value of ['1.0.0-beta.1', '01.0.0', '1.0', '999999999999999999999.0.0']) expect(() => compareVersions(value, '1.0.0')).toThrow();
  });
  it('selects only newer stable releases, excluding drafts and prereleases', () => {
    const releases = [release('1.0.9'), { ...release('4.0.0'), draft: true }, { ...release('3.0.0'), prerelease: true }, release('2.0.0-beta.1'), release()];
    expect(selectRelease(releases, '1.0.9').version).toBe('1.0.10');
    expect(selectRelease(releases, '1.0.10')).toBe(null);
    expect(() => selectRelease([{ ...release(), assets: [] }], '1.0.0')).toThrow('latest.yml');
  });
  it('validates tag, manifest version, filename, length and the full SHA-512', () => {
    const selected = selectRelease([release()], '1.0.0');
    expect(parseUpdateManifest(JSON.stringify(manifest()), selected)).toMatchObject({ version: '1.0.10', tag: 'v1.0.10', size: 9, sha512 });
    expect(() => parseUpdateManifest(JSON.stringify(manifest('1.0.11')), selected)).toThrow();
    for (const patch of [{ sha512: 'bad' }, { size: 0 }, { url: '../evil.exe' }, { size: 10 }]) {
      const value = manifest(); Object.assign(value.files[0], patch);
      expect(() => parseUpdateManifest(JSON.stringify(value), selected)).toThrow();
    }
    expect(() => parseUpdateManifest('version: 1.0.10', selected)).toThrow();
  });
  it('confines source assets to this repository and allows only GitHub HTTPS download redirects', () => {
    expect(() => assertAssetUrl(`${repository}/v1.0.10/latest.yml`, 'v1.0.10', 'latest.yml')).not.toThrow();
    for (const url of ['http://github.com/xiandan001/xuzuo-studio/releases/download/v1.0.10/latest.yml', 'https://github.com/other/repo/releases/download/v1.0.10/latest.yml', `${repository}/v1.0.10/latest.yml?secret=1`, 'https://github.com.evil.test/file.exe']) expect(() => assertAssetUrl(url, 'v1.0.10', 'latest.yml')).toThrow();
    expect(isAllowedDownloadUrl('https://release-assets.githubusercontent.com/github-production-release-asset/1/file?token=test')).toBe(true);
    expect(isAllowedDownloadUrl('https://evil.test/file.exe')).toBe(false);
    expect(isAllowedDownloadUrl('https://user:pass@objects.githubusercontent.com/file')).toBe(false);
  });
});
