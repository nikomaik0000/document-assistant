import type { NextConfig } from "next";

/**
 * 全站皆為 Client-side Only（無登入、無資料庫、無 API）。
 * 採用 static export，方便部署到任何靜態主機（Vercel / Netlify / GitHub Pages 皆可）。
 * 之後若加入需要 server 的功能（例如未來的桌面版 Tauri 整合），再評估是否移除此設定。
 */
const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true, // static export 不支援 next/image 的伺服器端最佳化
  },
};

export default nextConfig;
