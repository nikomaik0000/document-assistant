/**
 * 文字辨識（OCR）核心邏輯。
 * 依需求範圍：只做辨識，不做翻譯、摘要、關鍵字搜尋等後續處理，
 * 讓這支檔案未來要接上那些功能時，職責單純、容易擴充。
 *
 * === Debug Log ===
 * 每個步驟都有明確的 console.log 標記（Loading worker / Recognizing image /
 * Recognition complete...），失敗時用 console.error 印出完整的原始 Exception
 * （name / message / stack，以及物件本身），不會只顯示一句「辨識失敗」，
 * 方便直接從瀏覽器 Console 找到真正的 Root Cause。
 */
import { getOcrWorker } from "./worker";

export interface OcrOutcome {
  status: "success" | "error";
  /** 辨識出的文字（已去除前後空白），status 為 "success" 時一定有值 */
  text?: string;
  /** status 為 "error" 時的提示訊息，供 UI 直接顯示 */
  message?: string;
}

const OCR_ERROR_MESSAGE = "辨識失敗，請重新嘗試。";

function ocrLog(...args: unknown[]) {
  console.log("[OCR]", ...args);
}

/** 把任意型別的 error 攤開成看得懂的資訊，印到 console.error，不吞任何細節 */
function logFullError(step: string, error: unknown) {
  console.error(`[OCR] ✗ 失敗於：${step}`);
  if (error instanceof Error) {
    console.error("[OCR] error.name:", error.name);
    console.error("[OCR] error.message:", error.message);
    console.error("[OCR] error.stack:", error.stack);
  }
  // 不管是不是 Error 實例，都把原始物件整個印出來，
  // 因為 Tesseract.js / Emscripten 有些例外是純字串或普通物件，不是 Error 實例
  console.error("[OCR] raw error object:", error);
  try {
    console.error("[OCR] JSON.stringify(error):", JSON.stringify(error));
  } catch {
    // error 物件無法序列化（例如含有循環參照），忽略即可，上面已經印過原始物件
  }
}

/**
 * 對指定圖片（object URL）執行 OCR，回傳辨識出的文字。
 * 不會拋出例外：任何失敗都會回傳 status "error" + message，UI 端只要照顯示即可，
 * 不會讓整個 App crash。完整的原始錯誤一律印在 console.error，方便除錯。
 */
export async function recognizeText(
  imageUrl: string
): Promise<OcrOutcome> {
  ocrLog("========== OCR 開始 ==========");
  ocrLog("Target image URL:", imageUrl);

  if (!imageUrl) {
    const message = "沒有可辨識的圖片網址。";
    logFullError("輸入檢查", new Error(message));
    return { status: "error", message: OCR_ERROR_MESSAGE };
  }

  try {
    const worker = await getOcrWorker();
    ocrLog("Recognizing image...");
    const result = await worker.recognize(imageUrl);
    ocrLog("✓ Recognition complete");

    const text = (result?.data?.text ?? "").trim();
    ocrLog("OCR Result length:", text.length, "characters");
    ocrLog("OCR Result preview:", text.slice(0, 200));
    ocrLog("========== OCR 結束（成功） ==========");
    return { status: "success", text };
  } catch (error) {
    logFullError("Loading worker / recognize()", error);
    ocrLog("========== OCR 結束（失敗） ==========");
    return { status: "error", message: OCR_ERROR_MESSAGE };
  }
}
