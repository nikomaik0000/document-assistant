/**
 * lib/scanner 模組對外的型別定義。
 * 這一層刻意與 types/image.ts（React 端使用的 DocumentImage）分開，
 * 讓掃描模組保持獨立，未來可抽出成獨立套件或搬進 Worker 都不需要動到 React 型別。
 */

export interface Corners {
  topLeftCorner: { x: number; y: number };
  topRightCorner: { x: number; y: number };
  bottomLeftCorner: { x: number; y: number };
  bottomRightCorner: { x: number; y: number };
}

/**
 * 校正結果為 discriminated union：
 * - "corrected"：成功偵測並校正，附上結果畫布與角點
 * - "not-detected"：圖片讀取成功，但找不到文件邊界（沿用原圖，不算錯誤）
 * - "error"：處理過程發生例外（如圖片格式無法解碼），沿用原圖並記錄原因
 *
 * 後兩種情況都不會拋出例外，呼叫端只需依 kind 決定是否更新 correctedUrl，
 * 對應原始需求「OpenCV 找不到文件時保留原圖、不要讓程式崩潰」。
 */
export type ScanResult =
  | { kind: "corrected"; canvas: HTMLCanvasElement; corners: Corners }
  | { kind: "not-detected"; message: string }
  | { kind: "error"; message: string };
