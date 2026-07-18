// 將 @techstark/opencv-js 的瀏覽器版建置檔複製到 public/opencv/，
// 讓它在執行期以純 <script> 標籤載入，完全繞過 webpack 對這個
// 26MB Emscripten UMD 檔案不穩定的 CJS/ESM interop 判斷。
//
// 不把這個檔案提交進 git（見 .gitignore），每次 `npm install` 後
// 由這支 postinstall script 自動從 node_modules 複製一份，
// 確保永遠跟目前安裝的套件版本一致。

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const source = path.join(
  projectRoot,
  "node_modules",
  "@techstark",
  "opencv-js",
  "dist",
  "opencv.js"
);
const targetDir = path.join(projectRoot, "public", "opencv");
const target = path.join(targetDir, "opencv.js");

async function main() {
  if (!existsSync(source)) {
    console.warn(
      "[copy-opencv-assets] 找不到 @techstark/opencv-js 的建置檔，略過複製：",
      source
    );
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`[copy-opencv-assets] 已複製 opencv.js 到 ${target}`);
}

main().catch((error) => {
  console.error("[copy-opencv-assets] 複製失敗", error);
  process.exitCode = 1;
});
