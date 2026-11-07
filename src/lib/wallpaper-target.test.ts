import { describe, expect, it } from 'vitest';
import { WALLPAPER_DEVICES, wallpaperBrandLabel } from '../data/wallpaper-devices';
import { parseWallpaperTarget, readWallpaperTarget, searchWallpaperDevices, wallpaperGenerationSize, wallpaperPrompt, wallpaperTargetIssue } from './wallpaper-target';
import type { WallpaperTarget } from '../wallpaper-types';

const custom = (width = 1170, height = 2532): WallpaperTarget => ({ width, height, fit: 'cover' });
describe('verified wallpaper catalogue', () => {
  it('retains all verified sources, unique IDs, portrait pixels and separate fold screens', () => {
    expect(WALLPAPER_DEVICES).toHaveLength(57);
    expect(new Set(WALLPAPER_DEVICES.map(device => device.id)).size).toBe(57);
    expect(new Set(WALLPAPER_DEVICES.map(device => `${device.width}x${device.height}`)).size).toBe(40);
    expect([...new Set(WALLPAPER_DEVICES.map(device => device.brand))].sort()).toEqual(['apple', 'honor', 'huawei', 'oppo', 'samsung', 'vivo', 'xiaomi']);
    for (const device of WALLPAPER_DEVICES) {
      expect(device.width).toBeLessThanOrEqual(device.height); expect(device.aliases.length).toBeGreaterThan(0); expect(device.verifiedAt).toBe('2026-11-07');
      expect(new URL(device.sourceUrl).protocol).toBe('https:'); expect(wallpaperTargetIssue({ ...custom(device.width, device.height), deviceId: device.id })).toBeUndefined();
    }
    expect(WALLPAPER_DEVICES.filter(device => device.category === 'foldable')).toHaveLength(6);
    expect(wallpaperBrandLabel('apple')).toBe('苹果');
  });
  it('resolves every canonical catalogue label back to that exact device, including generations and fold screens', () => {
    for (const device of WALLPAPER_DEVICES) {
      const result = parseWallpaperTarget(device.name); expect(result.status, device.name).toBe('resolved');
      if (result.status === 'resolved') expect(result.target, device.name).toMatchObject({ deviceId: device.id, width: device.width, height: device.height });
    }
  });
});

describe('local wallpaper device and resolution recognition', () => {
  it.each([
    ['帮我制作一张适合苹果18 Pro Max的可爱壁纸', 'iphone-18-pro-max', 1320, 2868],
    ['iPhone 18 Pro', 'iphone-18-pro', 1206, 2622],
    ['wallpaper for iPhone 17 Pro Max please', 'iphone-17-pro-max', 1320, 2868],
    ['我的手机是vivo X500 Pro Max，做个夜景壁纸', 'x500-pro-max', 1440, 3168],
    ['小米18ProMax壁纸', 'xiaomi-18-pro-max', 1208, 2624],
    ['三星S26+壁纸', 'galaxy-s26-plus', 1440, 3120],
    ['华为Mate90 Pro', 'mate-90-pro', 1280, 2832],
    ['OPPO Find X10 Pro Max', 'find-x10-pro-max', 1272, 2772],
    ['荣耀Magic9超能版', 'magic9-super-power', 1280, 2788],
    ['ipad pro 11 M5', 'ipad-pro-11-m5', 1668, 2420],
  ])('resolves %s without paid inference', (text, id, width, height) => {
    const result = parseWallpaperTarget(text); expect(result.status).toBe('resolved');
    if (result.status === 'resolved') { expect(result.device?.id).toBe(id); expect(result.target).toMatchObject({ width, height, fit: 'cover', deviceId: id }); }
  });
  it.each(['小米18Pro', 'iPhone 18 Pro Ultra', 'iPhone 19 Pro', 'vivo X5000', 'Galaxy S260'])('does not complete unsupported model names as a nearby model: %s', text => {
    expect(parseWallpaperTarget(text).status).toBe('unknown');
  });
  it('keeps Pro distinct from Pro Max while showing both in an editable search list', () => {
    expect(searchWallpaperDevices('iPhone18Pro').map(device => device.id)).toEqual(['iphone-18-pro', 'iphone-18-pro-max']);
    const result = parseWallpaperTarget('iPhone18Pro'); expect(result.status === 'resolved' && result.device?.id).toBe('iphone-18-pro');
  });
  it('asks for the iPad generation and fold screen instead of silently using the first match', () => {
    const ipad = parseWallpaperTarget('给我一张 iPad Pro 11 的壁纸'); expect(ipad.status).toBe('ambiguous');
    if (ipad.status === 'ambiguous') expect(ipad.candidates.map(device => device.id)).toEqual(['ipad-pro-11-m5', 'ipad-pro-11-m2']);
    const fold = parseWallpaperTarget('Galaxy Z Fold7壁纸'); expect(fold.status).toBe('ambiguous');
    if (fold.status === 'ambiguous') expect(new Set(fold.candidates.map(device => device.screen))).toEqual(new Set(['inner', 'cover']));
    const cover = parseWallpaperTarget('三星Fold7外屏壁纸'); expect(cover.status === 'resolved' && cover.device?.id).toBe('galaxy-z-fold7-cover');
    const spokenCover = parseWallpaperTarget('给Galaxy Z Fold7的外屏做壁纸'); expect(spokenCover.status === 'resolved' && spokenCover.device?.id).toBe('galaxy-z-fold7-cover');
    const bothScreens = parseWallpaperTarget('三星Fold7内外屏壁纸'); expect(bothScreens.status).toBe('ambiguous');
  });
  it('keeps separately mentioned devices ambiguous rather than preferring the longest model name', () => {
    const result = parseWallpaperTarget('给iPhone18 Pro Max和小米17做壁纸'); expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') expect(new Set(result.candidates.map(device => device.id))).toEqual(new Set(['iphone-18-pro-max', 'xiaomi-17']));
  });
  it.each(['1170×2532', '宽1170高2532', '宽度为 1170 像素，高度为 2532 像素', '壁纸做成1170 * 2532 px', '做成1170乘2532', '1170乘以2532', '1170 by 2532 pixels'])('recognizes explicit custom pixels: %s', text => {
    const result = parseWallpaperTarget(text); expect(result.status).toBe('resolved');
    if (result.status === 'resolved') { expect(result.target).toMatchObject(custom()); expect(result.target.deviceId).toBeUndefined(); expect(result.device).toBeUndefined(); }
  });
  it('recognizes explicit 4K orientation as a custom output without pretending to be the device native screen', () => {
    const portrait = parseWallpaperTarget('做一张4K竖屏壁纸'); expect(portrait.status === 'resolved' && portrait.target).toMatchObject({ width: 2160, height: 3840 });
    const landscape = parseWallpaperTarget('iPhone18Pro UHD landscape wallpaper'); expect(landscape.status === 'resolved' && landscape.target).toMatchObject({ width: 3840, height: 2160 });
    expect(landscape.status === 'resolved' && landscape.target.deviceId).toBeUndefined();
    expect(parseWallpaperTarget('4K壁纸').status).toBe('unknown');
  });
  it('accepts a repeated identical resolution in a goal and its instructions without hiding distinct targets', () => {
    expect(parseWallpaperTarget('制作1080×2400壁纸，最终宽1080高2400').status).toBe('resolved');
    expect(parseWallpaperTarget('制作1080×2400壁纸，另外制作1440×3200').status).toBe('invalid');
  });
  it('treats conflicting numeric overrides as custom and preserves explicit orientation', () => {
    const changed = parseWallpaperTarget('iPhone18Pro，1080x2400'); expect(changed.status).toBe('resolved');
    if (changed.status === 'resolved') { expect(changed.target).toMatchObject(custom(1080, 2400)); expect(changed.target.deviceId).toBeUndefined(); expect(changed.device).toBeUndefined(); }
    const matched = parseWallpaperTarget('iPhone18Pro 1206x2622'); expect(matched.status === 'resolved' && matched.target.deviceId).toBe('iphone-18-pro');
    const landscape = parseWallpaperTarget('iPhone18Pro 横屏壁纸'); expect(landscape.status === 'resolved' && landscape.target).toMatchObject({ width: 2622, height: 1206 });
    const customLandscape = parseWallpaperTarget('宽1080高1920，横屏'); expect(customLandscape.status === 'resolved' && customLandscape.target).toMatchObject({ width: 1920, height: 1080, label: '自定义 1920×1080' });
  });
  it.each(['横屏和竖屏', '横向 portrait', 'landscape 纵向'])('does not choose between conflicting directions %s', text => expect(parseWallpaperTarget(`iPhone18Pro ${text}`).status).toBe('invalid'));
  it.each(['留边', '不裁剪', '不裁切', '完整保留画面'])('recognizes an explicit fit instruction %s for devices and custom pixels', instruction => {
    for (const input of [`iPhone18Pro ${instruction}`, `1920x1080 ${instruction}`]) { const result = parseWallpaperTarget(input); expect(result.status === 'resolved' && result.target.fit).toBe('contain'); }
    const bodyOnly = parseWallpaperTarget('iPhone18Pro 保留主体，背景可以调整'); expect(bodyOnly.status === 'resolved' && bodyOnly.target.fit).toBe('cover');
  });
  it('does not interpret a request without borders as contain, and accepts conversational no-crop wording', () => {
    for (const input of ['iPhone18Pro 不留边', 'iPhone18Pro 不要留边']) { const result = parseWallpaperTarget(input); expect(result.status === 'resolved' && result.target.fit).toBe('cover'); }
    const noCrop = parseWallpaperTarget('1170x2532，不要裁剪'); expect(noCrop.status === 'resolved' && noCrop.target.fit).toBe('contain');
    expect(parseWallpaperTarget('1170x2532mm').status).toBe('unknown');
  });
  it.each(['64x64', '4000x4000', '8192x1953', '1920x1080'])('admits bounded exact pixels %s', text => expect(parseWallpaperTarget(text).status).toBe('resolved'));
  it.each(['63x1024', '8193x1000', '4001x4000', '0x1024', '-1080x1920', '1170.5x2532', '1e3x2e3', '1080x1920 和 1440x3200'])('rejects invalid or multiple pixel targets %s', text => expect(parseWallpaperTarget(text).status).toBe('invalid'));
  it.each(['6.7英寸', '我的手机是2K屏', '机身71.9mm×150mm', 'iPhone', '17', '火星牌手机'])('does not infer pixel dimensions from insufficient text: %s', text => expect(parseWallpaperTarget(text).status).not.toBe('resolved'));
});

describe('strict target restoration and model-independent output intent', () => {
  it('restores only bounded typed values and returns an independent canonical object', () => {
    const input = { ...custom(), label: ' 自定义壁纸 ' }, read = readWallpaperTarget(input); expect(read).toEqual({ ...custom(), label: '自定义壁纸' }); expect(read).not.toBe(input);
    for (const value of [null, [], '1170x2532', {}, { width: '1170', height: 2532, fit: 'cover' }, { ...custom(), fit: 'stretch' }, { ...custom(), width: NaN }, { ...custom(), deviceId: 'missing' }, { ...custom(), label: 'bad\u0000label' }, { ...custom(), hidden: true }]) expect(readWallpaperTarget(value)).toBeUndefined();
  });
  it('accepts selected device portrait or landscape but never labels custom overrides as official', () => {
    const deviceId = 'iphone-18-pro'; expect(readWallpaperTarget({ width: 1206, height: 2622, fit: 'contain', deviceId })).toBeDefined(); expect(readWallpaperTarget({ width: 2622, height: 1206, fit: 'cover', deviceId })).toBeDefined();
    expect(wallpaperTargetIssue({ ...custom(), deviceId })).toContain('机型');
  });
  it('keeps the foundation useful and the native request size separate from final output pixels', () => {
    const target = custom(1320, 2868); expect(wallpaperPrompt(target)).toContain('1320 × 2868'); expect(wallpaperPrompt(target)).toContain('时钟'); expect(wallpaperPrompt(target)).toContain('手机边框');
    const [width, height] = wallpaperGenerationSize(target, 'gpt-image-2.6-sunburst').split('x').map(Number);
    expect(Math.abs(width / height - target.width / target.height)).toBeLessThan(Math.abs(1024 / 1536 - target.width / target.height));
    expect(wallpaperGenerationSize(custom(2868, 1320), 'gpt-image-1.5')).toBe('1536x1024'); expect(wallpaperGenerationSize(target, 'gpt-image-1')).toBe('1024x1536');
    expect(wallpaperGenerationSize(custom(2048, 2048))).toBe('1024x1024'); expect(wallpaperGenerationSize(target, 'dall-e-3')).toBe('1024x1024');
    expect(() => wallpaperPrompt(custom(9000, 100))).toThrow(); expect(() => wallpaperGenerationSize(custom(9000, 100))).toThrow();
  });
  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare'])('%s stays inside the conservative native budget for every catalogue size and direction', model => {
    const targets = [...WALLPAPER_DEVICES.map(device => custom(device.width, device.height)), custom(64, 8192), custom(4000, 4000)];
    for (const target of targets) for (const value of [target, { ...target, width: target.height, height: target.width }]) {
      const [width, height] = wallpaperGenerationSize(value, model).split('x').map(Number);
      expect(width % 16).toBe(0); expect(height % 16).toBe(0); expect(width).toBeLessThanOrEqual(3840); expect(height).toBeLessThanOrEqual(3840); expect(width * height).toBeLessThanOrEqual(3_686_400);
      expect(width / height).toBeGreaterThanOrEqual(1 / 3); expect(width / height).toBeLessThanOrEqual(3);
      const clampedRatio = Math.min(3, Math.max(1 / 3, value.width / value.height)); expect(Math.abs(width / height - clampedRatio)).toBeLessThan(0.025);
    }
  });
});
