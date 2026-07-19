/**
 * 手動調整裁切範圍（Phase 2B）。
 *
 * 這支檔案刻意獨立於 documentScanner.ts（自動偵測演算法）之外：
 * - 不呼叫、也不修改 documentScanner.ts 的任何邏輯，符合「不要修改 OpenCV
 *   偵測流程」的要求
 * - 只做「給定四個角點座標，重新做一次透視校正」這件事，跟自動偵測（找輪廓、
 *   評分、挑最佳候選）完全無關，使用者是手動決定角點，不需要再跑一次偵測
 *
 * warpPerspective／自動旋轉的邏輯跟 documentScanner.ts 內部的版本相同（同樣的
 * getPerspectiveTransform 數學），這裡刻意重新寫一份小函式而不是從
 * documentScanner.ts 匯出共用，同樣是為了這次「不修改該檔案」的要求；
 * 兩份邏輯都很短，之後如果要合併成共用工具函式也很容易。
 */
import { getOpenCv } from "./opencvLoader";
import type { Corners } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvNamespace = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvMat = any;

export interface ManualCropOutcome {
  status: "corrected" | "error";
  correctedUrl?: string;
  corners?: Corners;
  message?: string;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片解碼失敗"));
    img.src = url;
  });
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeOutputSize(corners: Corners): { width: number; height: number } {
  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = corners;
  const topWidth = distance(topLeftCorner, topRightCorner);
  const bottomWidth = distance(bottomLeftCorner, bottomRightCorner);
  const leftHeight = distance(topLeftCorner, bottomLeftCorner);
  const rightHeight = distance(topRightCorner, bottomRightCorner);
  return {
    width: Math.round(Math.max(topWidth, bottomWidth)),
    height: Math.round(Math.max(leftHeight, rightHeight)),
  };
}

function autoRotateToPortrait(canvas: HTMLCanvasElement): HTMLCanvasElement {
  if (canvas.width <= canvas.height) return canvas;
  const rotated = document.createElement("canvas");
  rotated.width = canvas.height;
  rotated.height = canvas.width;
  const ctx = rotated.getContext("2d");
  if (!ctx) return canvas;
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return rotated;
}

/** 對任意來源 Mat（可以是原始解析度，也可以是縮小過的預覽用 Mat）做透視校正 */
export function warpPerspectiveFromMat(
  cv: CvNamespace,
  src: CvMat,
  corners: Corners,
  width: number,
  height: number
): HTMLCanvasElement {
  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = corners;

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    topLeftCorner.x, topLeftCorner.y,
    topRightCorner.x, topRightCorner.y,
    bottomRightCorner.x, bottomRightCorner.y,
    bottomLeftCorner.x, bottomLeftCorner.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    width, 0,
    width, height,
    0, height,
  ]);

  const transform = cv.getPerspectiveTransform(srcTri, dstTri);
  const dst = new cv.Mat();
  cv.warpPerspective(
    src,
    dst,
    transform,
    new cv.Size(width, height),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar()
  );

  const canvas = document.createElement("canvas");
  cv.imshow(canvas, dst);

  srcTri.delete();
  dstTri.delete();
  transform.delete();
  dst.delete();

  return canvas;
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("無法將校正結果輸出為圖片"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.92
    );
  });
}

/**
 * 用使用者手動調整過的四個角點（原始圖片像素座標），重新對原圖做一次透視校正。
 * 不會拋出例外：失敗時回傳 status "error" + message，呼叫端可以顯示提示並保留原本結果。
 */
export async function applyManualCrop(
  imageUrl: string,
  corners: Corners
): Promise<ManualCropOutcome> {
  let img: HTMLImageElement;
  try {
    img = await loadImageElement(imageUrl);
  } catch {
    return { status: "error", message: "圖片讀取失敗，請重新嘗試。" };
  }

  let src: CvMat | null = null;
  try {
    const cv = await getOpenCv();
    src = cv.imread(img);

    const { width, height } = computeOutputSize(corners);
    if (width < 10 || height < 10) {
      return { status: "error", message: "裁切範圍過小，請重新調整四個角點。" };
    }

    const canvas = warpPerspectiveFromMat(cv, src, corners, width, height);
    const rotated = autoRotateToPortrait(canvas);
    const correctedUrl = await canvasToObjectUrl(rotated);

    return { status: "corrected", correctedUrl, corners };
  } catch (error) {
    console.error("[manualCrop] 手動校正失敗", error);
    return { status: "error", message: "重新校正時發生錯誤，請重新嘗試。" };
  } finally {
    src?.delete();
  }
}
