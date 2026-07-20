/**
 * lib/ocr 對外的唯一入口。React 端只應該 import 這支檔案。
 *
 * 保持獨立成一個模組（跟 lib/scanner、lib/pdf 同樣的架構慣例），方便下一階段
 * 加入 AI 摘要、翻譯、關鍵字搜尋等功能時，可以直接在 lib/ocr/ 底下擴充，
 * 不需要更動這次的辨識邏輯本身。
 */
export { recognizeText } from "./recognize";
export type { OcrOutcome } from "./recognize";
