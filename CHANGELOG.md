# Changelog

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
