import { getScanner } from "./opencvLoader";
import type { Corners, ScanResult } from "./types";

/**
 * 用兩點距離計算邊長，取上下（或左右）兩邊中較長者，
 * 讓校正後的輸出盡量保留原始解析度，不會因為透視角度而被縮小。
 */
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

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片解碼失敗（可能是不支援的格式）"));
    img.src = url;
  });
}

/**
 * 幾何啟發式自動旋轉：校正後若結果為橫向（寬 > 高），
 * 視為掃描方向錯誤，旋轉 90 度轉為直式。
 *
 * 這不是真正的文字方向辨識（需要 OCR 才能做到），是目前不引入 OCR 前提下
 * 合理的近似解法，多數證件／文件掃描皆為直式。
 */
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

/**
 * 對指定圖片網址（通常是 DocumentImage.originalUrl）執行：
 * 文件邊界偵測 → 透視校正（拉正）→ 自動裁切 → 自動旋轉。
 *
 * 不會拋出例外：任何失敗情況都會回傳 ScanResult 讓呼叫端決定如何 fallback。
 */
export async function correctDocument(imageUrl: string): Promise<ScanResult> {
  let img: HTMLImageElement;
  try {
    img = await loadImageElement(imageUrl);
  } catch {
    return {
      kind: "error",
      message: "無法讀取圖片以進行自動校正，將使用原圖。",
    };
  }

  try {
    const scanner = await getScanner();
    const cv = window.cv;
    if (!cv) throw new Error("OpenCV 尚未初始化");

    const mat = cv.imread(img);
    let contour;
    try {
      contour = scanner.findPaperContour(mat);

      if (!contour) {
        return {
          kind: "not-detected",
          message: "無法自動辨識文件，將使用原圖。",
        };
      }

      const corners = scanner.getCornerPoints(contour);
      const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = corners;
      if (!topLeftCorner || !topRightCorner || !bottomLeftCorner || !bottomRightCorner) {
        return {
          kind: "not-detected",
          message: "無法自動辨識文件的四個角，將使用原圖。",
        };
      }

      const { width, height } = computeOutputSize(corners);
      if (width < 10 || height < 10) {
        return {
          kind: "not-detected",
          message: "偵測到的文件範圍過小，將使用原圖。",
        };
      }

      const extracted = scanner.extractPaper(img, width, height, corners);
      if (!extracted) {
        return {
          kind: "not-detected",
          message: "無法自動辨識文件，將使用原圖。",
        };
      }

      const rotated = autoRotateToPortrait(extracted);

      return {
        kind: "corrected",
        canvas: rotated,
        corners,
      };
    } finally {
      mat.delete();
      contour?.delete();
    }
  } catch (error) {
    console.error("[documentScanner] 校正失敗", error);
    return {
      kind: "error",
      message: "自動校正時發生錯誤，將使用原圖。",
    };
  }
}
