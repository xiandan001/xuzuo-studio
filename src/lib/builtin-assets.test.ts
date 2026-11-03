import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSETS, BUILTIN_COLLECTIONS, builtinAssetImage, builtinAssetLicense, filterBuiltinAssets } from './builtin-assets';

describe('内置素材的浏览与筛选', () => {
  const all = { query: '', collection: 'all', origin: 'all' as const, transparent: false };
  it('使用真实打包图片URL和缩略图，原图不塞进Base64目录', () => {
    expect(BUILTIN_ASSETS).toHaveLength(28); expect(BUILTIN_COLLECTIONS).toHaveLength(4);
    for (const asset of BUILTIN_ASSETS) {
      expect(builtinAssetImage(asset)).toMatch(/\.png(?:\?|$)/); expect(builtinAssetImage(asset, false)).toMatch(/\.png(?:\?|$)/);
      expect(builtinAssetImage(asset)).not.toMatch(/^data:/); expect(builtinAssetImage(asset)).not.toBe(builtinAssetImage(asset, false));
    }
  });
  it('按集合、来源、关键词和透明背景组合筛选，保留目录顺序', () => {
    const originalOrder = BUILTIN_ASSETS.map(asset => asset.id);
    const open = filterBuiltinAssets(BUILTIN_ASSETS, { ...all, origin: 'open-source' });
    expect(open).toHaveLength(8); expect(open.every(asset => asset.licenseId === 'ISC')).toBe(true);
    expect(filterBuiltinAssets(BUILTIN_ASSETS, { ...all, query: ' 没有此关键词 ' })).toEqual([]);
    const sample = BUILTIN_ASSETS.find(asset => asset.transparent)!;
    const matches = filterBuiltinAssets(BUILTIN_ASSETS, { query: sample.name, collection: sample.collection, origin: sample.origin as 'original' | 'open-source', transparent: true });
    expect(matches).toEqual([sample]); expect(BUILTIN_ASSETS.map(asset => asset.id)).toEqual(originalOrder);
  });
  it('每件素材都关联离线完整许可与作者，开源官方来源可追溯', () => {
    for (const asset of BUILTIN_ASSETS) {
      const license = builtinAssetLicense(asset);
      expect(license?.notice.length).toBeGreaterThan(500); expect(asset.author).toBeTruthy(); expect(asset.usageNote).toBeTruthy();
      if (asset.origin === 'open-source') expect(asset.sourceUrl).toMatch(/^https:\/\/github\.com\/lucide-icons\/lucide\/blob\/0\.468\.0\//);
      else expect(asset.sourceUrl).toBe('');
    }
  });
});
