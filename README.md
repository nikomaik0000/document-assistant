# Document Assistant

完全本機運作（Client-side Only）的智慧文件掃描工具。所有圖片皆於瀏覽器內處理，不會上傳、不會離開使用者的電腦。

## 開發環境

本專案統一使用 **npm**（不使用 pnpm / yarn）。

```bash
npm install       # 安裝相依套件（會自動執行 postinstall，複製 OpenCV.js 到 public/opencv/）
npm run dev       # 啟動開發伺服器（http://localhost:3000）
npm run build     # 產生 production build（static export，輸出到 out/）
npm run lint      # ESLint 檢查
npm run typecheck # TypeScript 型別檢查（tsc --noEmit）
```

Node.js 版本需求：18 以上（開發時使用 Node 22 驗證）。

## 專案結構

```
app/            Next.js App Router 頁面
components/     UI 元件
hooks/          React hooks（狀態管理、與 lib/ 的橋接）
lib/
  image.ts        一般圖片檔案工具函式
  scanner/         文件掃描模組，獨立於 React，之後可重用於 OCR / 浮水印 / 桌面版
    index.ts        對外唯一入口
    documentScanner.ts  角點偵測、透視校正、自動旋轉
    opencvLoader.ts     OpenCV.js / jscanify 的載入邏輯
    vendor/          vendored 的第三方原始碼（jscanify 瀏覽器版，見檔案內註解說明原因）
types/          共用型別定義
scripts/        建置輔助腳本（postinstall 用）
```

## 技術棧與關鍵決策

- Next.js 15（App Router）+ React 19 + TypeScript + Tailwind CSS
- `output: "export"`：全站無後端、無 API，可部署到任何靜態主機
- OpenCV.js（`@techstark/opencv-js`）在執行期以 `<script>` 標籤載入（非透過 webpack 打包），
  詳細原因見 `lib/scanner/opencvLoader.ts` 檔案開頭註解
- jscanify 的瀏覽器版原始碼直接 vendor 進 `lib/scanner/vendor/`（非安裝 npm 套件），
  原因見該檔案開頭註解

## 目前進度

詳見 `CHANGELOG.md`。目前已完成 Phase 1A（上傳／預覽／刪除／排序）與 Phase 1B（OpenCV 自動文件偵測與校正）。
