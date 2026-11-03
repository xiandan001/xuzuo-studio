import type { StudioAsset } from '../asset-types';

export function studioAssetCandidates(assets: StudioAsset[], workspaceId: string, imagesOnly: boolean, query: string, categoryId: string, assignments: Record<string, string>) {
  const term = query.trim().toLocaleLowerCase();
  return assets.filter(asset => asset.workspaceId === workspaceId && !asset.archivedAt && (!imagesOnly || asset.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) && `${asset.name} ${asset.mimeType}`.toLocaleLowerCase().includes(term) && (categoryId === 'all' || categoryId === 'none' ? categoryId !== 'none' || !(assignments[asset.id] || asset.categoryId) : (assignments[asset.id] || asset.categoryId) === categoryId));
}

export function studioAssetImageUrl(value?: string) {
  return value && /^data:image\/(?:png|jpeg|webp);base64,/i.test(value) ? value : undefined;
}
