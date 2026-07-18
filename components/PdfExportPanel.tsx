"use client";

import { useState } from "react";
import { useImageStore } from "@/hooks/useImageStore";
import { exportImagesToA4Pdf, generatePdfFileName } from "@/lib/pdf";
import { triggerBlobDownload } from "@/lib/download";

export default function PdfExportPanel() {
  const { images } = useImageStore();
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProcessing = images.some((img) => img.status === "processing");
  const disabled = images.length === 0 || isProcessing || isExporting;

  async function handleExport() {
    setError(null);
    setIsExporting(true);
    try {
      const sourceImages = images.map((img) => ({
        url: img.status === "corrected" && img.correctedUrl ? img.correctedUrl : img.originalUrl,
      }));
      const blob = await exportImagesToA4Pdf(sourceImages);
      triggerBlobDownload(blob, generatePdfFileName());
    } catch (err) {
      console.error("[PdfExportPanel] PDF 匯出失敗", err);
      setError("PDF 匯出失敗，請稍後再試一次。");
    } finally {
      setIsExporting(false);
    }
  }

  if (images.length === 0) return null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleExport}
        disabled={disabled}
        className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white shadow-soft transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isExporting ? "匯出中…" : "輸出 A4 PDF"}
      </button>
      {isProcessing && !isExporting && (
        <p className="text-xs text-ink-faint">還有圖片正在校正中，完成後即可匯出</p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
