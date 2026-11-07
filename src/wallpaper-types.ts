export interface WallpaperTarget {
  width: number;
  height: number;
  fit: 'cover' | 'contain';
  deviceId?: string;
  label?: string;
}
