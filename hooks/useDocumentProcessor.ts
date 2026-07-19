"use client";

import { useEffect, useRef } from "react";
import { useImageStore } from "./useImageStore";
import { processDocumentImage } from "@/lib/scanner";

/**
 * 監看圖片清單，對狀態為 "ready" 的圖片依序（Queue）呼叫 lib/scanner 進行自動校正。
 *
 * 刻意不平行處理多張圖片：
 * - OpenCV.js 運算本身吃重 CPU，平行跑多張大圖容易讓分頁明顯卡頓
 * - 依序處理在一次上傳大量圖片時，UI 反應會更穩定，也方便未來顯示處理進度
 *
 * 這個 hook 只負責「橋接」：把 store 的狀態變化與 lib/scanner 的純函式串起來，
 * 實際的偵測／校正邏輯完全在 lib/scanner，元件與這個 hook 都不需要知道 OpenCV 的存在。
 */
export function useDocumentProcessor() {
  const { images, updateProcessingResult } = useImageStore();

  const queueRef = useRef<string[]>([]);
  const queuedIdsRef = useRef<Set<string>>(new Set());
  const processingRef = useRef(false);
  // 讓 processQueue 內部能拿到最新的 images，避免把 images 放進 effect 依賴造成重複觸發
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => {
    for (const image of images) {
      if (image.status === "ready" && !queuedIdsRef.current.has(image.id)) {
        queuedIdsRef.current.add(image.id);
        queueRef.current.push(image.id);
      }
    }

    void processQueue();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  async function processQueue() {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const id = queueRef.current.shift();
        if (!id) continue;

        const image = imagesRef.current.find((img) => img.id === id);
        if (!image) {
          // 使用者可能在排隊期間刪除了這張圖片
          queuedIdsRef.current.delete(id);
          continue;
        }

        updateProcessingResult({ id, status: "processing" });

        const outcome = await processDocumentImage(image.originalUrl);

        if (outcome.status === "corrected") {
          updateProcessingResult({
            id,
            status: "corrected",
            correctedUrl: outcome.correctedUrl,
            corners: outcome.corners,
          });
        } else {
          updateProcessingResult({
            id,
            status: "failed",
            statusMessage: outcome.message,
          });
        }

        queuedIdsRef.current.delete(id);
      }
    } finally {
      processingRef.current = false;
    }
  }
}
