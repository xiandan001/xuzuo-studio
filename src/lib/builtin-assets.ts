import catalog from '../../assets/library/catalog.json';

export type BuiltinAsset = (typeof catalog.assets)[number];
export type BuiltinAssetOrigin = 'all' | 'original' | 'open-source';
export const BUILTIN_ASSETS: BuiltinAsset[] = catalog.assets;
export const BUILTIN_LICENSES = catalog.licenses;
export const BUILTIN_PACK_ID = catalog.packId;
export const BUILTIN_COLLECTIONS = [...new Set(BUILTIN_ASSETS.map(asset => asset.collection))];
const images = import.meta.glob<string>(['../../assets/library/thumbnails/*.png', '../../assets/library/files/*.png'], { eager: true, query: '?url&no-inline', import: 'default' });

export function builtinAssetImage(asset: BuiltinAsset, thumbnail = true): string | undefined {
  return images[`../../assets/library/${thumbnail ? asset.thumbnailPath : asset.path}`];
}
export function builtinAssetLicense(asset: BuiltinAsset) {
  return BUILTIN_LICENSES.find(license => license.id === asset.licenseId);
}
export function filterBuiltinAssets(assets: BuiltinAsset[], options: { query: string; collection: string; origin: BuiltinAssetOrigin; transparent: boolean }) {
  const query = options.query.trim().toLocaleLowerCase();
  return assets.filter(asset => (options.collection === 'all' || asset.collection === options.collection) && (options.origin === 'all' || asset.origin === options.origin) && (!options.transparent || asset.transparent) && `${asset.name} ${asset.description} ${asset.collection} ${asset.tags.join(' ')} ${asset.author}`.toLocaleLowerCase().includes(query));
}
