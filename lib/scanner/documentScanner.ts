import { getScanner } from "./opencvLoader";
import type { Corners, ScanResult } from "./types";

const NOT_DETECTED_MESSAGE = "無法辨識文件，已使用原圖。";

/**
 * 偵測到的四邊形若明顯不合理（過小，或幾乎等於整張照片），
 * 就算 jscanify 沒有回報失敗，也視為偵測失敗，不能算是「校正成功」。
 *
 * 這個防呆是必要的：實測（見專案內 /home/claude/scanner-test 的驗證紀錄）
 * 發現 jscanify 的角點計算（getCornerPoints）只要 findPaperContour 有找到
 * 「任何」輪廓（哪怕是雜訊或不相關的細小線條），就一定會算出四個角，
 * 不會主動回報「找不到」。曾經實測出偵測到只佔畫面 0.3% 的雜訊被誤認為文件、
 * 也可能發生偵測範圍幾乎等於整張照片（代表根本沒找到真正的文件邊界，
 * 只是把整張照片的邊框當成輪廓）。這兩種情況都必須攔截，
 * 避免 UI 顯示「校正後」卻其實沒有做到真正的透視校正。
 */
const MIN_DOCUMENT_AREA_RATIO = 0.15;
const MAX_DOCUMENT_AREA_RATIO = 0.97;

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

/** 鞋帶公式計算四邊形面積，用來判斷偵測到的範圍是否合理 */
function quadrilateralArea(corners: Corners): number {
  const points = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ];
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % points.length]!;
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area) / 2;
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
    return { kind: "error", message: NOT_DETECTED_MESSAGE };
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
        return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
      }

      const corners = scanner.getCornerPoints(contour);
      const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = corners;
      if (!topLeftCorner || !topRightCorner || !bottomLeftCorner || !bottomRightCorner) {
        return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
      }

      const { width, height } = computeOutputSize(corners);
      if (width < 10 || height < 10) {
        return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
      }

      // 面積合理性檢查，見檔案開頭常數定義處的說明
      const imageArea = img.naturalWidth * img.naturalHeight;
      const detectedRatio = imageArea > 0 ? quadrilateralArea(corners) / imageArea : 0;
      if (
        detectedRatio < MIN_DOCUMENT_AREA_RATIO ||
        detectedRatio > MAX_DOCUMENT_AREA_RATIO
      ) {
        return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
      }

      const extracted = scanner.extractPaper(img, width, height, corners);
      if (!extracted) {
        return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
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
    return { kind: "error", message: NOT_DETECTED_MESSAGE };
  }
}
