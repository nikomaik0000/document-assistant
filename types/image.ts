/**
 * 圖片處理狀態。
 * Phase 1A 僅會用到 "ready"；"processing" / "corrected" / "failed"
 * 保留給 Phase 1B（OpenCV 自動校正）使用，現在先定義好型別以避免之後大改。
 */
export type ImageStatus = "ready" | "processing" | "corrected" | "failed";

export interface DocumentImage {
  id: string;
  file: File;
  fileName: string;
  /** 原圖的 object URL，供縮圖與預覽使用 */
  originalUrl: string;
  /** 校正後圖片的 object URL，Phase 1B 才會賦值 */
  correctedUrl?: string;
  width: number;
  height: number;
  sizeBytes: number;
  status: ImageStatus;
  /** 若自動校正失敗，記錄原因以顯示提示訊息（Phase 1B） */
  statusMessage?: string;
  createdAt: number;
}

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const ACCEPTED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
] as const;
