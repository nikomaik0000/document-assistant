/**
 * lib/pdf 對外的唯一入口，React 端只應該 import 這支檔案。
 */
export { exportImagesToA4Pdf } from "./pdfExport";
export type { PdfSourceImage } from "./types";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** 產生符合 DocumentAssistant_YYYYMMDD_HHmm.pdf 格式的檔名 */
export function generatePdfFileName(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `DocumentAssistant_${y}${m}${d}_${hh}${mm}.pdf`;
}
