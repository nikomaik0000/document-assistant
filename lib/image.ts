import { ACCEPTED_IMAGE_TYPES, DocumentImage } from "@/types/image";

/**
 * 產生穩定且唯一的圖片 id。
 * 使用 crypto.randomUUID()（所有現代瀏覽器皆支援），
 * 避免依賴額外套件（如 uuid）。
 */
export function generateImageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // 極少數情況下 crypto.randomUUID 不存在的 fallback
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 讀取圖片檔案的實際像素尺寸。
 * 使用 createImageBitmap，效能優於建立 <img> 元素。
 */
export async function readImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

/**
 * 將檔案轉換為 DocumentImage 物件，包含建立 object URL 與讀取尺寸。
 * 呼叫端負責在圖片移除時呼叫 URL.revokeObjectURL 釋放記憶體。
 */
export async function createDocumentImage(file: File): Promise<DocumentImage> {
  const originalUrl = URL.createObjectURL(file);
  try {
    const { width, height } = await readImageDimensions(file);
    return {
      id: generateImageId(),
      file,
      fileName: file.name,
      originalUrl,
      width,
      height,
      sizeBytes: file.size,
      status: "ready",
      createdAt: Date.now(),
    };
  } catch (error) {
    // 讀取尺寸失敗時，釋放已建立的 URL 避免記憶體洩漏，並往外拋出讓呼叫端處理
    URL.revokeObjectURL(originalUrl);
    throw error;
  }
}

export function isAcceptedImageFile(file: File): boolean {
  if ((ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return true;
  }
  // HEIC/HEIF 檔案在部分瀏覽器（尤其是 Safari 以外）可能沒有正確的 MIME type，
  // 因此額外用副檔名判斷作為 fallback。
  const lower = file.name.toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"].some((ext) =>
    lower.endsWith(ext)
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function revokeDocumentImageUrls(image: DocumentImage): void {
  URL.revokeObjectURL(image.originalUrl);
  if (image.correctedUrl) {
    URL.revokeObjectURL(image.correctedUrl);
  }
}
