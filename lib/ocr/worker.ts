/**
 * Tesseract.js worker 的懶初始化與 singleton 管理。
 *
 * 依需求「初始化 Worker 僅建立一次」：第一次呼叫 getOcrWorker() 才會真的建立
 * worker，之後所有辨識請求都重複使用同一個 worker、同一份已載入的語言資料，
 * 不會每次辨識都重新初始化。
 *
 * 全程在瀏覽器端執行、不需要任何後端 API：
 * worker script、OCR 核心（wasm）、語言資料（繁體中文＋英文）都是本專案自行
 * host 的靜態資源（見 scripts/copy-tesseract-assets.mjs，npm install 時
 * 自動從 node_modules 複製到 public/tesseract/），不會連到外部 CDN，
 * 也完全不會把圖片上傳到任何伺服器——圖片是直接在瀏覽器記憶體裡處理的
 * object URL，從頭到尾沒有網路傳輸圖片內容這件事。
 *
 * === Root Cause（實際在 Console 看到的錯誤，非推測）===
 * Console 顯示：
 *   Uncaught NetworkError: Failed to execute 'importScripts' on
 *   'WorkerGlobalScope': The script at '.../tesseract/worker.min.js' failed to load.
 *
 * 追到 tesseract.js 原始碼 `src/worker/browser/spawnWorker.js`：
 *
 *   module.exports = ({ workerPath, workerBlobURL }) => {
 *     if (Blob && URL && workerBlobURL) {
 *       const blob = new Blob([`importScripts("${workerPath}");`], {...});
 *       worker = new Worker(URL.createObjectURL(blob));   // <-- 用 blob URL 建立 worker
 *     } else {
 *       worker = new Worker(workerPath);                   // <-- 直接建立
 *     }
 *   };
 *
 * `workerBlobURL` 預設是 true。也就是說 Tesseract.js 預設不會直接
 * `new Worker(workerPath)`，而是先建立一個小的 blob worker，內容就是
 * `importScripts("http://localhost:3000/tesseract/worker.min.js");`，
 * 再用這個 blob: URL 建立 Worker。
 *
 * 這個「blob 包一層再 importScripts」的技巧，是設計來繞過「跨網域 CDN
 * workerPath」的限制（`new Worker(跨網域網址)` 會被瀏覽器擋，但 blob worker
 * 內的 importScripts() 可以載入跨網域腳本，等於用 blob 這個 same-origin 的
 * 外殼去載入別的網域的腳本）。
 *
 * 我們的 worker.min.js 是自己 host 的 same-origin 資源（/tesseract/worker.min.js），
 * 根本不需要這個繞過技巧 —— 而這個多一層的 blob-wrapper + importScripts，
 * 正是 Console 錯誤訊息的來源。
 *
 * 修正：明確關閉 `workerBlobURL`，讓它變成單純、直接的
 * `new Worker("http://localhost:3000/tesseract/worker.min.js")`，
 * 不需要透過 blob 這一層間接載入。
 *
 * === Debug Log ===
 * 建立 worker 前，把實際會用到的絕對網址（workerPath／corePath／langPath，
 * 用跟 tesseract.js 內部 resolvePaths 相同的方式：`new URL(path, location.href)`）
 * 印到 console，不用再靠猜測。同時接上 Tesseract.js 官方支援的 `logger` 回呼，
 * worker 內部每個階段（載入 core、載入語言資料、initialize api、recognize）
 * 都會即時回報狀態。
 *
 * === 另一個已修正的問題 ===
 * 原本 worker 初始化失敗後，`workerPromise` 會永久卡在「已 reject」的狀態，
 * 之後不管按幾次「辨識文字」都會立即失敗、必須重新整理頁面。這次改成失敗時
 * 清空 workerPromise，下一次呼叫會重新嘗試建立 worker。
 */
import { createWorker, type Worker } from "tesseract.js";

const WORKER_PATH = "/tesseract/worker.min.js";
const CORE_PATH = "/tesseract/core";
const LANG_PATH = "/tesseract/lang-data";

let workerPromise: Promise<Worker> | null = null;

function ocrLog(...args: unknown[]) {
  console.log("[OCR]", ...args);
}

/** 把相對路徑轉成絕對網址，方便印出來核對，邏輯跟 tesseract.js 內部一致 */
function toAbsoluteUrl(path: string): string {
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return path;
  }
}

async function initWorker(): Promise<Worker> {
  const resolvedWorkerPath = toAbsoluteUrl(WORKER_PATH);
  const resolvedCorePath = toAbsoluteUrl(CORE_PATH);
  const resolvedLangPath = toAbsoluteUrl(LANG_PATH);

  ocrLog("Loading worker...");
  ocrLog("  workerPath (resolved):", resolvedWorkerPath);
  ocrLog("  corePath   (resolved):", resolvedCorePath);
  ocrLog("  langPath   (resolved):", resolvedLangPath);
  ocrLog("  workerBlobURL: false（直接 new Worker(workerPath)，不透過 blob 中介）");

  const worker = await createWorker(["eng", "chi_tra"], undefined, {
    workerPath: WORKER_PATH,
    corePath: CORE_PATH,
    langPath: LANG_PATH,
    // 見檔案開頭的說明：預設 true 會透過 blob + importScripts 間接載入 worker，
    // 我們的 worker script 是 same-origin 自己 host 的，不需要這個繞過機制，
    // 這正是先前 Console 出現的 importScripts 錯誤的來源。
    workerBlobURL: false,
    logger: (m: { status?: string; progress?: number }) => {
      const pct =
        typeof m.progress === "number" ? ` ${Math.round(m.progress * 100)}%` : "";
      ocrLog(`${m.status ?? "(no status)"}${pct}`);
    },
  });

  ocrLog("✓ Worker ready (eng + chi_tra loaded, api initialized)");
  return worker;
}

export function getOcrWorker(): Promise<Worker> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("OCR 只能在瀏覽器環境執行"));
  }

  if (!workerPromise) {
    workerPromise = initWorker().catch((error) => {
      ocrLog("✗ Worker 初始化失敗，下次呼叫會重新嘗試");
      console.error("[OCR] Worker init error:", error);
      // 重要：清空 cache，讓下一次呼叫可以重新嘗試，而不是永遠卡在失敗的 Promise
      workerPromise = null;
      throw error;
    });
  }

  return workerPromise;
}

/** 供除錯用：強制重置 worker（例如使用者想在畫面上提供「重試」按鈕時可用） */
export function resetOcrWorker(): void {
  workerPromise = null;
}
