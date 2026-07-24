import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Document Assistant",
  description: "完全本機運作的智慧文件掃描工具，掃描、校正、匯出 PDF，全程不離開您的瀏覽器。",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "512x512", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "512x512", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
