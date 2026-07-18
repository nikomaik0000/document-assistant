import type { NextConfig } from "next";

/**
 * 全站皆為 Client-side Only（無登入、無資料庫、無 API）。
 * 採用 static export，方便部署到任何靜態主機（Vercel / Netlify / GitHub Pages 皆可）。
 *
 * 注意：@techstark/opencv-js 完全不經過 webpack 打包，而是由
 * scripts/copy-opencv-assets.mjs 複製到 public/opencv/，在執行期
 * 用 <script> 標籤載入（見 lib/scanner/opencvLoader.ts 的說明），
 * 因此這裡不需要（也不應該）加任何跟它相關的 webpack 設定。
 */
const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true, // static export 不支援 next/image 的伺服器端最佳化
  },
};

export default nextConfig;
