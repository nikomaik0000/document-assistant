import { PDFDocument } from "pdf-lib";
import { A4_WIDTH_PT, A4_HEIGHT_PT, computeCellRects, decideImagesPerPage, fitContain } from "./layout";
import type { PdfSourceImage } from "./types";

/**
 * 把圖片網址（object URL）重新畫到 canvas 再輸出成 JPEG bytes。
 * 這樣不管原始檔案是 PNG／WEBP 或別的格式，最後都統一成 pdf-lib
 * 可以直接嵌入的 JPEG，不用另外處理各種來源格式的相容性問題。
 */
async function loadAsJpegBytes(
  url: string
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`圖片載入失敗：${url}`));
    el.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法建立畫布以輸出 PDF 用圖片");
  ctx.drawImage(img, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("圖片輸出失敗"))),
      "image/jpeg",
      0.92
    );
  });

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * 將多張圖片依序輸出成一份 A4 PDF：
 * - 保持每張圖片的長寬比，不裁切、不變形
 * - 依圖片總數自動決定每頁放幾張（見 layout.ts 的 decideImagesPerPage）
 * - 四周與圖片之間留白
 *
 * 圖片依傳入陣列的順序排列（呼叫端負責決定順序，通常對應畫面上的排序）。
 */
export async function exportImagesToA4Pdf(
  images: PdfSourceImage[]
): Promise<Blob> {
  if (images.length === 0) {
    throw new Error("沒有可輸出的圖片");
  }

  const pdfDoc = await PDFDocument.create();
  const perPage = decideImagesPerPage(images.length);
  const cells = computeCellRects(perPage);

  for (let i = 0; i < images.length; i += perPage) {
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    const pageImages = images.slice(i, i + perPage);

    for (let slot = 0; slot < pageImages.length; slot++) {
      const source = pageImages[slot]!;
      const cell = cells[slot]!;
      const { bytes, width, height } = await loadAsJpegBytes(source.url);
      const jpg = await pdfDoc.embedJpg(bytes);
      const rect = fitContain(cell, width, height);
      page.drawImage(jpg, rect);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([Uint8Array.from(pdfBytes)], { type: "application/pdf" });
}
