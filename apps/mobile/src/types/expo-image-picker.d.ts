/**
 * Minimal type shim for expo-image-picker.
 * Replace with the real package by running:  pnpm install  (expo-image-picker is in package.json)
 * Once installed, this file can be deleted — the real types ship with the package.
 */
declare module 'expo-image-picker' {
  export type MediaType = 'images' | 'videos' | 'livePhotos';

  export interface ImagePickerAsset {
    uri: string;
    width: number;
    height: number;
    mimeType?: string;
    fileSize?: number;
    fileName?: string;
    exif?: Record<string, unknown>;
  }

  export interface ImagePickerResult {
    canceled: boolean;
    assets: ImagePickerAsset[];
  }

  export interface ImagePickerOptions {
    mediaTypes?: MediaType | MediaType[];
    allowsEditing?: boolean;
    allowsMultipleSelection?: boolean;
    selectionLimit?: number;
    quality?: number;
    exif?: boolean;
  }

  export interface PermissionResponse {
    status: 'granted' | 'denied' | 'undetermined';
    granted: boolean;
    canAskAgain: boolean;
    expires: 'never' | number;
  }

  export function launchCameraAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
  export function launchImageLibraryAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
  export function requestCameraPermissionsAsync(): Promise<PermissionResponse>;
  export function requestMediaLibraryPermissionsAsync(): Promise<PermissionResponse>;
  export function getCameraPermissionsAsync(): Promise<PermissionResponse>;
  export function getMediaLibraryPermissionsAsync(): Promise<PermissionResponse>;
}
