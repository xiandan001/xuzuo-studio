import type { ArtifactMetadata, ArtifactPreview } from './live-types';
export interface AssetProvenance { builtinId: string; packId: string; origin: 'original' | 'open-source'; author: string; licenseId: string; licenseName: string; licenseUrl: string; sourceUrl: string; usageNote: string; licenseNotice: string; }
export interface BuiltinStudioAsset { id: string; name: string; description: string; collection: string; tags: string[]; width: number; height: number; transparent: boolean; kind: 'image'; mimeType: 'image/png'; path: string; thumbnailPath: string; vectorPath: string; bytes: number; sha256: string; thumbnailBytes: number; thumbnailSha256: string; vectorBytes: number; vectorSha256: string; origin: 'original' | 'open-source'; author: string; licenseId: string; sourceUrl: string; licenseUrl: string; usageNote: string; licenseNotice: string; sourceVersion?: string; }
export interface BuiltinAssetLicense { id: string; name: string; path: string; url: string; notice: string; }
export interface BuiltinAssetCatalog { version: 1; packId: string; updatedAt: string; licenses: BuiltinAssetLicense[]; assets: BuiltinStudioAsset[]; }
export interface StudioAsset { id: string; workspaceId: string; name: string; mimeType: string; bytes: number; kind: ArtifactMetadata['kind']; createdAt: string; favorite: boolean; archivedAt?: string; unavailable?: boolean; categoryId?: string; provenance?: AssetProvenance; }
export type ProjectReference = Pick<ArtifactMetadata, 'id' | 'name' | 'mimeType' | 'bytes' | 'kind' | 'provenance'>;
export interface AssetCategory { id: string; name: string; }
export interface AssetCategoryState { categories: AssetCategory[]; assignments: Record<string, string>; builtinAssignments: Record<string, string>; }
export interface AssetLibraryBridge {
  search?: (input: { workspaceId: string; query: string; limit?: number }) => Promise<{ items: StudioAsset[]; total: number }>;
  thumbnail?: (input: { workspaceId: string; id: string }) => Promise<ArtifactPreview>;
  categories?: (input: { workspaceId: string }) => Promise<AssetCategoryState>;
  saveCategory?: (input: { workspaceId: string; id?: string; name: string }) => Promise<AssetCategoryState>;
  removeCategory?: (input: { workspaceId: string; id: string }) => Promise<AssetCategoryState>;
  assignCategory?: (input: { workspaceId: string; id: string; categoryId?: string; builtin?: boolean }) => Promise<void>;
  importBuiltin?: (input: { workspaceId: string; id: string }) => Promise<StudioAsset>;
  attachBuiltin?: (input: { workspaceId: string; id: string; projectId: string }) => Promise<ArtifactMetadata>;
  saveBuiltin?: (input: { id: string; format?: 'png' | 'bundle' }) => Promise<{ saved: boolean }>;
  openBuiltinLink?: (input: { id: string; kind: 'source' | 'license' }) => Promise<void>;
  list: (input: { workspaceId: string; availabilityIds?: string[] }) => Promise<StudioAsset[]>;
  probe?: (input: { workspaceId: string; ids: string[] }) => Promise<{ id: string; unavailable: boolean }[]>;
  import: (input: { workspaceId: string }) => Promise<StudioAsset[]>;
  update: (input: { workspaceId: string; id: string; favorite?: boolean; archived?: boolean }) => Promise<StudioAsset>;
  preview: (input: { workspaceId: string; id: string }) => Promise<ArtifactPreview>;
  save: (input: { workspaceId: string; id: string }) => Promise<{ saved: boolean }>;
  attach: (input: { workspaceId: string; id: string; projectId: string }) => Promise<ArtifactMetadata>;
}
