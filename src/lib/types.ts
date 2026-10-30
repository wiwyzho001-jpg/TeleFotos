export interface TeleFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  folderPath: string; // virtual folder path (e.g. "/" or "/Documents")
  messageId: number;
  channelId: string;
  uploadedAt: number;
  localUri?: string; // Device-only MediaStore URI, never uploaded in the catalog.
  deviceFolder?: string;
  deviceSourceKey?: string;
  contentHash?: string;
  capturedAt?: number; // Original file modification date; EXIF extraction can override it.
  albumNames?: string[]; // References only: albums never duplicate Telegram media.
  albumCoverFor?: string[]; // This media is the selected cover for these albums.
  starred?: boolean;
  trashed?: boolean;
  archived?: boolean;
  lastOpenedAt?: number;
  thumbnailUrl?: string;
  offline?: boolean;
}

export interface SelectedFile {
  name: string;
  size: number;
  path: string;
  data?: Uint8Array;
  type: string;
  capturedAt?: number;
  deviceSourceKey?: string;
  contentHash?: string;
  starred?: boolean;
  albumNames?: string[];
  temporary?: boolean;
  thumbnailData?: string;
}

export interface UploadItem {
  accountPhone?: string;
  wifiOnly?: boolean;
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  file?: SelectedFile | File;
  folderPath?: string;
  error?: string;
  /** Live transfer speed in bytes/second — updated during upload */
  speed?: number;
  /** Estimated seconds remaining — updated during upload */
  eta?: number;
  /** Bytes uploaded so far — updated during upload */
  uploadedBytes?: number;
}
