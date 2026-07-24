/**
 * 圖片處理狀態。
 * Phase 1A 僅會用到 "ready"；"processing" / "corrected" / "failed"
 * 保留給 Phase 1B（OpenCV 自動校正）使用，現在先定義好型別以避免之後大改。
 */
export type ImageStatus = "ready" | "processing" | "corrected" | "failed";

export interface Point {
  x: number;
  y: number;
}

/** 四個角點座標，皆為原始圖片（原始解析度）的像素座標 */
export interface ImageCorners {
  topLeftCorner: Point;
  topRightCorner: Point;
  bottomLeftCorner: Point;
  bottomRightCorner: Point;
}

export interface ImageAdjustments {
  grayscale: boolean;
  brightness: number;
  contrast: number;
}

export interface DocumentImage {
  id: string;
  file: File;
  fileName: string;
  /** 原圖的 object URL，供縮圖與預覽使用 */
  originalUrl: string;
  /** 校正後圖片的 object URL，Phase 1B 才會賦值 */
  correctedUrl?: string;
  /**
   * 校正時使用的四個角點（原始圖片像素座標）。自動偵測成功時由演算法填入，
   * 使用者透過「調整裁切範圍」手動校正後也會更新到這裡，供下次開啟編輯畫面時使用。
   */
  corners?: ImageCorners;
  imageAdjustments?: ImageAdjustments;
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
