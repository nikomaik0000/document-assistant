/**
 * OpenCV.js（@techstark/opencv-js）與 jscanify 的懶載入器。
 *
 * === 載入 OpenCV.js 的方式（重要，說明過去踩過的坑）===
 *
 * 一開始的作法是用 `await import("@techstark/opencv-js")` 動態載入，
 * 但實測會在瀏覽器打包後出現 `.default` 是 undefined 的問題。
 *
 * 原因：實際用 Node 執行 `require("@techstark/opencv-js")` 後發現，
 * 這個套件的 module.exports 本身就是一個 Promise（resolve 後才是
 * 真正可用的 cv 物件），而不是單純的物件或 function。它的原始檔是
 * 一個相當巨大（約 26MB）、層層嵌套 UMD 判斷式的 Emscripten 產物，
 * webpack 對這種檔案的 CJS/ESM interop 判斷不穩定，導致動態 import
 * 打包後 `.default` 有時候會拿不到正確的值。
 *
 * 解法：完全不透過 webpack 打包這個檔案，改成執行期用純 <script> 標籤
 * 載入（這也是 OpenCV.js 官方文件建議的瀏覽器用法）。這個檔案的 UMD
 * 包裝在偵測到「純瀏覽器、沒有 module/exports」的情境下，會自動把
 * 結果掛到 `window.cv`（見它原始碼的 `else if (typeof window === 'object')
 * { root.cv = factory(); }` 分支）。掛上去的值同樣是一個 Promise，
 * 所以我們載入 script 之後還要再 await 一次，拿到真正 ready 的物件，
 * 最後覆寫回 window.cv，讓 jscanify（直接參照全域 cv.Mat 等 API）
 * 可以同步使用。
 *
 * 這個 opencv.js 檔案本身不是本專案程式碼，而是建置後從
 * node_modules 複製到 public/opencv/opencv.js 的靜態資源
 * （見 scripts/copy-opencv-assets.mjs，postinstall 時自動執行）。
 */
import type JscanifyCtor from "./vendor/jscanify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvNamespace = any;

declare global {
  interface Window {
    cv?: CvNamespace;
  }
}

const OPENCV_SCRIPT_URL = "/opencv/opencv.js";

let cvPromise: Promise<CvNamespace> | null = null;
let scannerPromise: Promise<InstanceType<typeof JscanifyCtor>> | null = null;

function loadScriptTag(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${url}"]`
    );
    if (existing) {
      // 若已經有人載入過（例如快速連續上傳觸發兩次），等它載完即可
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

async function loadOpenCv(): Promise<CvNamespace> {
  if (typeof window === "undefined") {
    throw new Error("OpenCV.js 只能在瀏覽器環境載入");
  }

  if (!cvPromise) {
    cvPromise = (async () => {
      await loadScriptTag(OPENCV_SCRIPT_URL);

      // script 標籤的 UMD 包裝會把結果掛到 window.cv，
      // 但那個值本身還是一個 Promise，需要再 await 一次。
      const pending = window.cv;
      if (!pending) {
        throw new Error("opencv.js 已載入，但未在 window.cv 找到匯出內容");
      }

      const cv: CvNamespace =
        typeof pending.then === "function" ? await pending : pending;

      if (!cv || typeof cv.Mat !== "function") {
        throw new Error("OpenCV.js 初始化後仍缺少必要的 API（cv.Mat）");
      }

      // 覆寫回 window.cv，讓後續同步存取（例如 vendored 的 jscanify.js
      // 內部直接參照的全域 cv）拿到的是「已經 ready」的物件，而不是 Promise。
      window.cv = cv;
      return cv;
    })();
  }

  return cvPromise;
}

/**
 * 取得已初始化的 jscanify scanner 實例。
 * 對外唯一應該呼叫的函式；OpenCV 的載入細節完全封裝在這裡。
 */
export async function getScanner(): Promise<InstanceType<typeof JscanifyCtor>> {
  if (!scannerPromise) {
    scannerPromise = (async () => {
      await loadOpenCv();
      const JscanifyCtor = (await import("./vendor/jscanify")).default;
      return new JscanifyCtor();
    })();
  }

  return scannerPromise;
}
