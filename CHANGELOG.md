# Changelog

## Phase 1B 修正 2 - 修復 OpenCV Runtime Error + 統一改用 npm（2026-07-17）

### 問題
上傳圖片後出現：`Cannot read properties of undefined (reading 'Mat')`，位置在
`lib/scanner/opencvLoader.ts` 的 `cvModule.Mat` 判斷式。

### 根本原因（實測，非推測）
用 Node 直接 `require("@techstark/opencv-js")` 驗證後發現：這個套件的
`module.exports` 本身就是一個**貨真價實的 Promise**（resolve 後才是含有
`.Mat` 等 API 的 cv 物件），而不是單純物件或 function。它的原始檔是約
26MB、層層嵌套 UMD 判斷式的 Emscripten 產物。先前用
`await import("@techstark/opencv-js")` 動態載入，經過 webpack 打包後
`.default` 會拿不到正確的值（這類巨大、結構複雜的 CJS/UMD 檔案，
webpack 的 interop 判斷並不穩定），導致 `cvModule` 變成 `undefined`。

### 修正方式
- **不再透過 webpack 打包 OpenCV.js**，改成執行期用純 `<script>` 標籤載入
  （這也是 OpenCV.js 官方文件建議的瀏覽器用法），完全避開 webpack 對這個
  檔案不穩定的 CJS/ESM interop 判斷
- 新增 `scripts/copy-opencv-assets.mjs`，透過 `postinstall` hook 在
  `npm install` 後自動把 `node_modules/@techstark/opencv-js/dist/opencv.js`
  複製到 `public/opencv/opencv.js`（不提交進 git，見 `.gitignore`，每次
  安裝時自動從目前版本重新複製，永遠保持同步）
- `lib/scanner/opencvLoader.ts` 改為：動態插入 `<script src="/opencv/opencv.js">`
  → 該檔案的 UMD 包裝偵測到純瀏覽器環境會把結果掛到 `window.cv`（一樣是
  Promise）→ 再 await 一次拿到真正 ready 的 cv 物件 → 覆寫回
  `window.cv`，供 vendored 的 jscanify.js 同步使用
- `next.config.ts` 移除先前為了打包 `@techstark/opencv-js` 加的 webpack
  fallback 設定（fs/path/crypto），現在完全用不到
- `eslint.config.mjs` 排除整個 `public/**`（自動複製進去的 opencv.js 不該被
  本專案的 lint 規則檢查）

### 驗證（乾淨環境，依您要求的三步驟）
- ✅ `npm install`：成功，postinstall 正確複製 opencv.js（13MB）到 public/opencv/
- ✅ `npm run dev`：成功啟動，實測 `curl` 首頁與 `/opencv/opencv.js` 皆回應 HTTP 200
- ✅ `npm run build`：成功，static export 的 `out/opencv/opencv.js` 確認存在
- ✅ `npx tsc --noEmit` / `npx eslint .`：皆無錯誤

### 已知限制（誠實說明）
目前的沙盒環境沒有真實瀏覽器可以執行「拖一張照片進去、看到自動校正結果」
這個實際操作，且 Playwright 需要下載 Chromium 二進位檔，被沙盒網路限制擋下
（`cdn.playwright.dev` 不在允許清單）。以上驗證已涵蓋建置與伺服器啟動層級，
並且用 Node 直接驗證了 `@techstark/opencv-js` 套件本身的行為（確認它
`module.exports` 是 Promise、resolve 後有 `cv.Mat`），對應了根本原因。但
「瀏覽器內真正執行 WASM 初始化 + jscanify 校正」這一步，麻煩您在本機
`npm run dev` 後實際上傳一張拍歪的文件照片協助驗證，若還有問題請把瀏覽器
Console 的錯誤訊息貼給我。

### 交付方式調整
- 依您指示，之後統一使用 npm（`npm install` / `npm run dev` / `npm run build` /
  `npm run lint`），不再使用 pnpm。已移除 `pnpm-workspace.yaml`（pnpm 專用設定，
  npm 環境下用不到，且 npm 本身預設就會執行相依套件的 postinstall script，
  不需要額外的 build script 允許清單）

## Phase 1B 修正 - 修復 pnpm 環境下的 Build Error（2026-07-17）

### 問題
在 pnpm 環境下 `pnpm install` 會直接失敗（exit code 1），導致 `next dev` / `next build` 出現
`Module not found: Can't resolve '@techstark/opencv-js'`。

### 根本原因
`jscanify` 這個 npm 套件的 `package.json` 把 `canvas`／`jsdom`（Node.js 版本才需要的原生模組）列為一般
`dependencies`，即使我們原本只使用它不依賴這兩者的瀏覽器版本（`jscanify/client`）。pnpm 對套件的
postinstall / build script 有預設安全機制，`canvas` 需要編譯原生模組，觸發了 `ERR_PNPM_IGNORED_BUILDS`，
使整個 `pnpm install` 直接失敗、退出碼為 1，`next dev`／`next build` 內部會重新檢查相依套件安裝狀態，
安裝失敗即中止整個編譯流程。

### 修正方式
- 移除 `jscanify` npm 套件依賴，改為將它「本來就不依賴任何套件」的瀏覽器原始碼直接複製進本專案
  （`lib/scanner/vendor/jscanify.js`，附上來源與授權說明 `jscanify.LICENSE.txt`），從相依樹中徹底移除
  `canvas`／`jsdom`
- 新增 `pnpm-workspace.yaml`，用 `allowBuilds` 明確允許 `sharp`（Next.js 內建、圖片最佳化用）與
  `unrs-resolver`（eslint-config-next 內部用）這兩個合法原生模組的 build script 執行，避免 `pnpm install`
  因 pnpm 11 預設的 `strictDepBuilds` 而中止
- `eslint.config.mjs` 排除 `lib/scanner/vendor/**`，vendored 的第三方程式碼不套用本專案的 lint 規則

### 驗證（皆為乾淨環境重新測試，非沿用舊 node_modules）
- ✅ `pnpm install`：exit code 0
- ✅ `npx tsc --noEmit`：無錯誤
- ✅ `npx eslint .`：無錯誤
- ✅ `pnpm run build`：成功（含 static export）
- ✅ `pnpm run dev`：成功啟動，首頁回應 HTTP 200

## Phase 1B - OpenCV 自動文件偵測與校正（2026-07-17）

### 新增
- `lib/scanner/`：獨立於 React 的文件掃描模組
  - `opencvLoader.ts`：懶載入 `@techstark/opencv-js` 與 `jscanify/client`，singleton，只在需要時才下載／初始化
  - `documentScanner.ts`：角點偵測、透視校正（拉正）、依角點自動裁切、幾何啟發式自動旋轉（校正後寬>高則轉為直式）
  - `index.ts`：對外唯一入口 `processDocumentImage()`，React 端只 import 這支
- `hooks/useDocumentProcessor.ts`：Queue 依序處理待校正圖片，避免平行處理造成 UI 卡頓
- `hooks/useImageStore.tsx`：新增 `UPDATE_PROCESSING_RESULT` action，更新圖片校正狀態／結果
- `components/ImageCard.tsx`：處理中 spinner、校正失敗時顯示提示訊息、原圖／校正後切換按鈕
- `types/jscanify.d.ts`：手動型別宣告（套件本身無官方型別）

### 架構決策
- **jscanify 改用 `jscanify/client` 子路徑，而非直接 `import jscanify`**：套件預設進入點是給 Node.js 用的，依賴 `canvas`／`jsdom`，直接匯入會讓 Next.js 瀏覽器端打包失敗（或被迫打包不必要的 Node 原生模組）。`jscanify/client` 是套件官方提供的純 UMD 瀏覽器版本，無任何相依套件，行為與原本要求的「直接使用 jscanify」一致，只是改用它官方支援的瀏覽器進入點
- **未採用 Web Worker**：查證後發現 jscanify 內部直接使用 `document.createElement('canvas')`，強依賴 DOM，無法在 Worker 中執行。目前改在主執行緒依序（Queue）處理，並將模組介面設計為未來可平移到 Worker 版本而不影響 React 呼叫端
- **自動旋轉為幾何啟發式**：校正後寬度大於高度即轉為直式，非文字方向辨識（需 OCR），為目前範圍內合理的近似解法
- `originalUrl` 與 `correctedUrl` 分別保留，不互相覆蓋，供之後 PDF／OCR／浮水印使用
- Next.js 由 15.1.x 升級至 15.5.20：15.1.x 已無新的安全性修補版本（原本的 15.1.11 之後又發現多個 CVE，修補只延伸到 15.5.x／16.x 系列）

### 已知限制
- HEIC 檔案目前多數瀏覽器的 `<img>` 無法直接解碼，會被視為校正失敗、fallback 為原圖（訊息會顯示「無法讀取圖片」而非「找不到文件」），待 Phase 1B 後續加入 `heic2any` 轉檔可修正
- OpenCV.js 本體約 26MB（wasm），採動態載入不影響首頁效能，但使用者上傳第一張圖片時需要等待下載＋初始化（僅發生一次）
- `npm audit` 目前有一項來自 Next.js 內部依賴 postcss 的中度風險（建置期 XSS，不影響執行期），暫無 15.5.x 內的修補版本，因非執行期風險先不處理，後續有新版本再一併升級

## Phase 1A - 專案骨架 + 上傳 + 圖片列表（2026-07-17）

### 新增
- Next.js 15（App Router）+ TypeScript + Tailwind CSS 專案初始化，設定 `output: "export"` 供純靜態部署
- 設計 tokens（`tailwind.config.ts`）：米白背景、淡灰卡片、圓角、柔和陰影，符合 Apple/Notion 風格
- `types/image.ts`：`DocumentImage` 型別，預留 Phase 1B 校正狀態欄位（`status` / `correctedUrl` / `statusMessage`）
- `lib/image.ts`：圖片檔案處理工具（建立 DocumentImage、讀取尺寸、格式驗證、檔案大小格式化、object URL 釋放）
- `hooks/useImageStore.tsx`：以 Context + useReducer 管理圖片列表狀態（新增／刪除／排序／清空），刪除與清空時自動釋放 object URL
- `components/UploadArea.tsx`：react-dropzone 拖曳與點擊上傳，支援 JPG/PNG/WEBP/HEIC，含 hero 模式與 compact 模式
- `components/PreviewGrid.tsx` + `components/ImageCard.tsx`：dnd-kit 拖曳排序的圖片列表，含縮圖、檔名、尺寸、刪除按鈕
- `components/PrivacyNotice.tsx`：持續顯示的隱私提示
- `components/DocumentAssistantApp.tsx`：整合上傳與列表流程的單頁元件（不跳頁）

### 架構決策
- 圖片校正（OpenCV.js）將於 Phase 1B 以獨立 Web Worker 實作，避免阻塞主執行緒
- 角點偵測邏輯採用 `jscanify` 套件（Phase 1B 導入），加速開發
- PDF 預覽與匯出將共用同一份排版計算邏輯（`lib/pdfLayout.ts`，Phase 1D），避免兩邊邏輯不同步

### 已知限制（Phase 1A 範圍內）
- 圖片上傳後尚未進行自動校正，僅顯示原圖（Phase 1B 加入）
- 尚未支援 PDF 排版預覽與匯出（Phase 1D 加入）
- HEIC 檔案目前僅能顯示縮圖，尚未加入 `heic2any` 轉檔（將於 Phase 1B 隨校正流程一併處理）
