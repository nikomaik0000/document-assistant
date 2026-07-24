import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Document Assistant",
    short_name: "Document",
    description: "完全本機運作的智慧文件掃描工具。",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f7f5",
    theme_color: "#edebe6",
    icons: [
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
