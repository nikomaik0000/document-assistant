# Changelog

## 文件偵測演算法重寫 - 改為純 OpenCV.js 自行實作（2026-07-18）

停用 jscanify，`lib/scanner/documentScanner.ts` 改為完全自行用 OpenCV.js 原生 API
實作文件偵測與透視校正，`lib/scanner/vendor/` 已移除。

### 為什麼放棄 jscanify（不是調參數就能解決）
jscanify 的 `getCornerPoints` 不驗證輪廓是不是四邊形，只是抓「輪廓上離中心最遠的
象限點」當作四個角：
- 背景複雜、有陰影、形狀不規則（例如便利貼）時，容易連陰影一起框進去，corner
  跑掉，校正後嚴重變形
- 沒有重試機制，Canny 閾值固定，遇到反差不夠強烈的照片（哪怕背景乾淨、理論上該
  很好辨識）反而容易直接偵測失敗

這兩個都是演算法設計本身的限制，不是參數問題，所以照您的指示直接換成自行實作。

### 新演算法（`documentScanner.ts`）
1. 縮小到最大邊長 1000px 做偵測（加速運算、避免手機照片解析度差異影響參數），
   最終校正仍使用原始解析度
2. 灰階 → Gaussian Blur
3. **重試策略**（依序嘗試，前一種失敗才換下一種）：
   - Canny（閾值 60/180，較嚴格）
   - Canny（閾值 25/90，較寬鬆，處理反差較弱的照片）
   - Adaptive Threshold（處理光線不均、有陰影的照片）
   每種都先做 morphology close 補齊邊緣缺口
4. **Contour filtering**：依面積過濾掉太小（雜訊）或大於 98%（幾乎等於整張照片，
   代表沒抓到真正邊界）的候選
5. **Largest quadrilateral selection**：對面積最大的候選依序嘗試 5 組 epsilon 做
   approxPolyDP，只接受「四個頂點、通過凸多邊形檢查」的結果，不是隨便湊四個角
6. **Corner ordering**：sum/diff 排序法（x+y 最小＝左上、最大＝右下；x-y 最大＝
   右上、最小＝左下），不受輪廓點原始順序影響，比 jscanify 的象限法更穩定
7. warpPerspective 用原始解析度校正，維持既有的自動旋轉與失敗提示邏輯

### 驗證（合成測試圖 + 實際跑本專案程式碼，非另外重寫邏輯）
用 Node 直接執行本專案的演算法邏輯（前處理／輪廓篩選／角點排序皆為同一份程式碼），
測了 5 種情境：

| 情境 | 結果 | 角點誤差 |
|---|---|---|
| 清楚歪斜文件 | ✅ 正確偵測 | <1px |
| 低對比度＋雜訊（不該偵測到） | ✅ 正確回報無法辨識 | — |
| 便利貼（小張＋陰影，對應您回報的測試一） | ✅ 正確偵測，無變形 | <1px |
| 白色說明書在木桌（高對比，對應您回報的測試二） | ✅ 正確偵測 | <1px |
| 低對比＋不均勻光影 | ✅ canny-strict 失敗、canny-relaxed 接手成功 | <1px |

最後一項證實重試機制真的有作用（不是寫了用不到的 dead code）。每個「校正後」的
結果都另外用 Python 做像素層級檢查（確認裁切區域顏色跟原始文件顏色一致、沒有背景
穿幫），不是只看座標數字。

### 檔案異動
- 改寫：`lib/scanner/documentScanner.ts`（核心演算法）、`lib/scanner/opencvLoader.ts`
  （移除 jscanify 載入，只保留 OpenCV.js 載入）
- 移除：`lib/scanner/vendor/`（jscanify 相關檔案，不再使用）
- `eslint.config.mjs` 移除已刪除目錄的排除規則
- 沒有改動：UI、下載 JPG、PDF 匯出、OpenCV 載入方式（script 標籤）、npm 相關設定，
  依您指示這次完全沒有動這些部分

### 已用您要求的情境驗證（誠實說明方式）
沙盒沒有真實手機照片可以測，用合成測試圖模擬您回報的兩種情境（便利貼有陰影、
白色說明書在木桌高對比）以及 A4/發票類的一般文件情境，皆通過。合成圖無法完全
代表真實手機照片的雜訊、對焦模糊、反光等因素，如果實際測試某幾類照片還是不穩定，
麻煩提供照片或描述失敗情況（例如是哪個類型、光線如何），我再針對性調整重試策略
的參數或新增偵測方式。

## MVP 完整流程 - 校正可靠性修正 + JPG/PDF 下載（2026-07-17）

這次不再往下拆 Phase，把您列出的完整流程（拖曳 → 自動校正 → 預覽 → 下載 JPG →
輸出 A4 PDF）一次補完。

### 【一】校正可靠性修正
**先做了什麼**：寫了一個 Node 測試環境（`/home/claude/scanner-test`，非本專案的一部分），
用合成的歪斜文件照片實際跑過 jscanify 的角點偵測演算法，藉此找出「校正後看起來跟原圖
一樣」的真正原因，而不是用改程式碰運氣。

**發現的問題**：
1. `findPaperContour` 直接對彩色圖片做 Canny 邊緣偵測，沒有先轉灰階，容易被顏色雜訊干擾
2. 更嚴重的問題：只要 `findPaperContour` 找到「任何」輪廓（哪怕是雜訊或一條不相關的細線），
   `getCornerPoints` 一定會算出四個角、絕對不會回報「找不到」。實測情境：一張對比度低、
   文件幾乎滿版的照片，演算法誤鎖定一條佔畫面僅 0.3% 的雜訊線條當作「文件」，卻回報成功

**修正**：
- `lib/scanner/vendor/jscanify.js`：`findPaperContour` 加入灰階前處理再做 Canny
  （這支檔案這次「有」修改原始邏輯，檔案開頭註解已更新說明差異）
- `lib/scanner/documentScanner.ts`：新增面積合理性檢查——偵測到的四邊形面積若小於
  整張照片的 15%（太小，可能是雜訊）或大於 97%（太大，可能只是抓到整張照片邊框，
  不是真正的文件邊界），一律視為「無法辨識」，不會再誤標成「校正後」
- 統一失敗訊息文字為「無法辨識文件，已使用原圖。」
- `components/ImageCard.tsx`：校正失敗時，縮圖下方改為明顯的紅色橫幅提示（不是先前不
  容易注意到的小灰字），只有真正校正成功時才會出現「校正後／原圖」切換按鈕

**驗證**（用合成測試圖，附驗證數據）：
- 清楚的歪斜文件：偵測角點與實際角點誤差在 1~2 像素內，校正後畫面確認從傾斜變成方正
- 低對比度、幾乎滿版的照片：面積比例 0.3%，正確被新的合理性檢查攔截，回報「無法辨識」

### 【二】校正圖片下載
- `lib/download.ts`：共用的瀏覽器下載觸發工具
- `components/ImageCard.tsx`：每張成功校正的圖片下方新增「下載 JPG」按鈕，下載內容為
  校正後的圖片（`correctedUrl`）。校正失敗的圖片不顯示這個按鈕（因為沒有校正後的版本，
  避免下載到跟按鈕名稱不符的內容）

### 【三】PDF 匯出
- 新增 `lib/pdf/` 模組（獨立於 React，`index.ts` 為唯一對外入口）：
  - `layout.ts`：A4 排版計算（純函式，決定每頁放幾張、每格座標、保持比例置中）
  - `pdfExport.ts`：用 `pdf-lib` 把圖片嵌入 PDF
  - `types.ts`：型別定義
- 排版規則：只有 1 張圖片時整頁滿版；2 張以上時每頁固定 2 張（上下排列），對應原始需求
  預設的「一頁兩張」。保持長寬比、不裁切、四周與圖片間都有留白，最後一頁圖片不足時
  自動留白格
- `components/PdfExportPanel.tsx`：「輸出 A4 PDF」按鈕，使用每張圖片目前可用的最佳版本
  （校正成功用校正後、失敗則用原圖），依畫面目前排序輸出，檔名格式
  `DocumentAssistant_YYYYMMDD_HHmm.pdf`。圖片還在校正中時按鈕會停用並提示

**驗證**（直接測試專案內正式的 `lib/pdf` 原始碼，非另外重寫邏輯）：
- 用 Node 執行實際的 `pdfExport.ts`／`layout.ts`，產生真實 PDF 檔案
- 3 張圖片 → 正確產生 2 頁（2+1，最後一頁留白格），1 張圖片 → 正確產生 1 頁滿版
- 用 `pdftoppm` 把 PDF 頁面實際轉成圖片，量測像素內容：確認兩個格子內都有對應圖片內容
  （不是空白）、長寬比與校正後的圖片一致（誤差 <2%，換算後屬於算圖精度誤差，非拉伸變形）、
  格子之間確實有留白間距

### 【四】UI
- 圖片清單上方新增「共 N 張圖片」與「輸出 A4 PDF」按鈕
- 每張圖片卡片新增「下載 JPG」按鈕（僅校正成功時顯示）

### 已用您要求的完整流程驗證（誠實說明驗證方式）
沙盒環境沒有真實瀏覽器可以實際拖放檔案點擊下載，因此：
- 「自動校正是否真的產生效果」：用 Node + 合成歪斜測試圖，直接跑本專案 vendored 的
  `jscanify.js` 演算法（含這次的修正），確認角點誤差 <2px、結果視覺上確實從傾斜變方正
- 「PDF 是否正確產生」：用 Node 直接執行本專案的 `lib/pdf/pdfExport.ts` 正式程式碼，
  產生真實 PDF 並用 `pdftoppm` 轉成圖片逐像素驗證版面、比例、留白皆正確
- 「JPG 下載」：程式邏輯為標準瀏覽器 `<a download>` 觸發下載，屬低風險標準 API，已透過
  程式碼審查確認邏輯正確（下載對象固定是 `correctedUrl`）
- `npm install` / `npm run dev` / `npm run build`：乾淨環境下皆確認成功

這些驗證涵蓋到「演算法真的有效」與「PDF 真的正確產生」這兩個最容易出錯的核心邏輯，
但沒辦法涵蓋「使用者在瀏覽器實際拖曳檔案」這個互動層。麻煩您本機實測這一步，
如果校正結果不理想或下載有問題，麻煩提供實際照片或錯誤訊息，我再針對性調整。

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
