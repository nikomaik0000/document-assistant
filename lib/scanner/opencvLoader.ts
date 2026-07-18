/**
 * OpenCV.js（@techstark/opencv-js）的懶載入器。
 *
 * === 載入方式（重要，說明過去踩過的坑）===
 * 一開始用 `await import("@techstark/opencv-js")` 動態載入，但實測會在瀏覽器
 * 打包後出現 `.default` 是 undefined 的問題：這個套件的原始檔是一個約 26MB、
 * 層層嵌套 UMD 判斷式的 Emscripten 產物，webpack 對這種檔案的 CJS/ESM interop
 * 判斷不穩定。
 *
 * 解法：完全不透過 webpack 打包這個檔案，改成執行期用純 <script> 標籤載入
 * （這也是 OpenCV.js 官方文件建議的瀏覽器用法）。這個 opencv.js 檔案是
 * scripts/copy-opencv-assets.mjs 在 postinstall 時自動從 node_modules
 * 複製到 public/opencv/opencv.js 的靜態資源。
 *
 * 它的 UMD 包裝在偵測到「純瀏覽器、沒有 module/exports」的情境下，會自動把
 * 結果掛到 `window.cv`，掛上去的值是一個 Promise，所以載入 script 之後
 * 還要再 await 一次，拿到真正 ready 的物件。
 *
 * 文件偵測（角點偵測、透視校正）的演算法本身在 documentScanner.ts，
 * 是本專案直接用 OpenCV.js 的原生 API 自行實作，不依賴任何第三方文件
 * 掃描套件（先前用過 jscanify，因為它的角點演算法在複雜背景下不夠穩定，
 * 已改為自行實作，詳見 documentScanner.ts 開頭的說明）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvNamespace = any;

declare global {
  interface Window {
    cv?: CvNamespace;
  }
}

const OPENCV_SCRIPT_URL = "/opencv/opencv.js";

let cvPromise: Promise<CvNamespace> | null = null;

function loadScriptTag(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${url}"]`
    );
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () =>
          reject(new Error(`載入 ${url} 失敗`))
        );
      }
      return;
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`載入 ${url} 失敗`));
    document.head.appendChild(script);
  });
}

/**
 * 取得已初始化的 OpenCV.js 命名空間（window.cv）。
 * 對外唯一應該呼叫的函式；載入細節完全封裝在這裡。
 */
export async function getOpenCv(): Promise<CvNamespace> {
  if (typeof window === "undefined") {
    throw new Error("OpenCV.js 只能在瀏覽器環境載入");
  }

  if (!cvPromise) {
    cvPromise = (async () => {
      await loadScriptTag(OPENCV_SCRIPT_URL);

      const pending = window.cv;
      if (!pending) {
        throw new Error("opencv.js 已載入，但未在 window.cv 找到匯出內容");
      }

      const cv: CvNamespace =
        typeof pending.then === "function" ? await pending : pending;

      if (!cv || typeof cv.Mat !== "function") {
        throw new Error("OpenCV.js 初始化後仍缺少必要的 API（cv.Mat）");
      }

      window.cv = cv;
      return cv;
    })();
  }

  return cvPromise;
}
