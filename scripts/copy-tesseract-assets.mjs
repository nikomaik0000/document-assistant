// 將 Tesseract.js 需要的靜態資源（worker script、OCR 核心 wasm、語言資料）
// 複製到 public/tesseract/，讓 OCR 全程使用本專案自己 host 的檔案，執行期不需要
// 連到任何外部 CDN（tesseract.js 預設會去 jsdelivr 抓這些檔案，這裡改成用
// npm 套件的方式先下載好、複製成靜態資源，跟 copy-opencv-assets.mjs 是同樣的做法）。
//
// 不把這些檔案提交進 git（見 .gitignore），每次 `npm install` 後由這支
// postinstall script 自動從 node_modules 複製一份。
//
// 只複製 LSTM-only 的核心變體（simd / relaxedsimd / 一般版本三選一由瀏覽器自動偵測），
// 因為 Tesseract.js createWorker 預設的 OEM 就是 LSTM_ONLY，不需要完整的 legacy 引擎。

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const targetRoot = path.join(projectRoot, "public", "tesseract");

async function copyIfExists(source, target) {
  if (!existsSync(source)) {
    console.warn("[copy-tesseract-assets] 找不到檔案，略過：", source);
    return;
  }
  await copyFile(source, target);
}

async function main() {
  await mkdir(path.join(targetRoot, "core"), { recursive: true });
  await mkdir(path.join(targetRoot, "lang-data"), { recursive: true });

  // worker script
  await copyIfExists(
    path.join(projectRoot, "node_modules", "tesseract.js", "dist", "worker.min.js"),
    path.join(targetRoot, "worker.min.js")
  );

  // OCR 核心（wasm），只要 LSTM-only 的三種變體（一般 / SIMD / relaxed SIMD）
  const coreDir = path.join(projectRoot, "node_modules", "tesseract.js-core");
  const coreFiles = [
    "tesseract-core-lstm.js",
    "tesseract-core-lstm.wasm",
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-simd-lstm.js",
    "tesseract-core-simd-lstm.wasm",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-relaxedsimd-lstm.js",
    "tesseract-core-relaxedsimd-lstm.wasm",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
  ];
  for (const file of coreFiles) {
    await copyIfExists(path.join(coreDir, file), path.join(targetRoot, "core", file));
  }

  // 語言資料（繁體中文＋英文），用 LSTM_ONLY 預設會用到的 4.0.0_best_int 版本
  const langs = [
    { pkg: "@tesseract.js-data/eng", file: "eng.traineddata.gz" },
    { pkg: "@tesseract.js-data/chi_tra", file: "chi_tra.traineddata.gz" },
  ];
  for (const { pkg, file } of langs) {
    const source = path.join(projectRoot, "node_modules", pkg, "4.0.0_best_int", file);
    await copyIfExists(source, path.join(targetRoot, "lang-data", file));
  }

  console.log("[copy-tesseract-assets] 完成複製 Tesseract.js 靜態資源到 public/tesseract/");
}

main().catch((error) => {
  console.error("[copy-tesseract-assets] 複製失敗", error);
  process.exitCode = 1;
});
