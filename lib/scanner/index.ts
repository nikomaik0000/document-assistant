/**
 * lib/scanner 對外的唯一入口。
 * React 端（hooks/components）只應該 import 這支檔案，
 * 不要直接碰 documentScanner.ts / opencvLoader.ts 內部的 cv.Mat、canvas 等細節。
 *
 * 這樣未來要抽換實作（例如換成 Web Worker 版本、加入 OCR 前處理、
 * 或是在 Tauri 桌面版用原生 OpenCV 取代 OpenCV.js）時，
 * 只需要改這一層背後的模組，呼叫端完全不用動。
 */
import { correctDocument } from "./documentScanner";

export interface DocumentCorrectionOutcome {
  status: "corrected" | "unchanged";
  /** 校正成功時的結果圖片 object URL，呼叫端使用完畢須自行 revoke */
  correctedUrl?: string;
  /** 當 status 為 "unchanged" 時，說明原因（供 UI 顯示提示） */
  message?: string;
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
 * 對單張圖片執行自動文件偵測與校正。
 * 永遠不會 reject：任何失敗都會回傳 status "unchanged" + message，
 * 呼叫端沿用原圖即可，符合「不要讓程式崩潰」的需求。
 */
export async function processDocumentImage(
  imageUrl: string
): Promise<DocumentCorrectionOutcome> {
  const result = await correctDocument(imageUrl);

  if (result.kind === "corrected") {
    try {
      const correctedUrl = await canvasToObjectUrl(result.canvas);
      return { status: "corrected", correctedUrl };
    } catch {
      return {
        status: "unchanged",
        message: "校正後圖片輸出失敗，將使用原圖。",
      };
    }
  }

  return { status: "unchanged", message: result.message };
}
