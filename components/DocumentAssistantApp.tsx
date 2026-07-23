"use client";

import { useState } from "react";
import { useImageStore } from "@/hooks/useImageStore";
import { useDocumentProcessor } from "@/hooks/useDocumentProcessor";
import { LayoutEditorProvider, useLayoutEditorStore } from "@/hooks/useLayoutEditorStore";
import UploadArea from "./UploadArea";
import PreviewGrid from "./PreviewGrid";
import PrivacyNotice from "./PrivacyNotice";
import LayoutEditor from "./LayoutEditor";

export default function DocumentAssistantApp() {
  return (
    <LayoutEditorProvider>
      <DocumentAssistantContent />
    </LayoutEditorProvider>
  );
}

function DocumentAssistantContent() {
  const { images } = useImageStore();
  const { exportPdf } = useLayoutEditorStore();
  const [isLayoutEditorOpen, setIsLayoutEditorOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  useDocumentProcessor();
  const hasImages = images.length > 0;
  const isProcessing = images.some((image) => image.status === "processing");

  async function handleExportPdf() {
    if (!hasImages || isProcessing || isExporting) return;
    setExportError(null);
    setIsExporting(true);
    try {
      await exportPdf(images);
    } catch (err) {
      console.error("[DocumentAssistantApp] PDF 匯出失敗", err);
      setExportError("PDF 匯出失敗，請稍後再試一次。");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      {hasImages && (
        <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-[#EEE7DD]/95 shadow-soft backdrop-blur">
          <div className="mx-auto grid max-w-7xl grid-cols-2 items-center gap-3 px-3 py-3 sm:px-6 md:flex">
            <button
              type="button"
              onClick={() => setIsLayoutEditorOpen((open) => !open)}
              className="font-serif-zh min-h-12 shrink-0 rounded-control bg-white px-3 text-sm tracking-[0.12em] text-ink shadow-soft transition-opacity hover:opacity-90 sm:px-6 sm:text-base"
            >
              編輯輸出版面
            </button>
            <div className="col-span-2 row-start-2 md:order-none md:row-auto md:min-w-0 md:flex-1">
              <UploadArea toolbar />
            </div>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isProcessing || isExporting}
              className="font-serif-zh min-h-12 shrink-0 rounded-control bg-white px-3 text-sm tracking-[0.12em] text-ink shadow-soft transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:px-6 sm:text-base"
            >
              {isExporting ? "輸出中" : "輸出 PDF"}
            </button>
          </div>
          {exportError && (
            <p className="mx-auto max-w-7xl px-4 pb-2 text-sm text-danger sm:px-6">
              {exportError}
            </p>
          )}
        </header>
      )}

      <main className={`mx-auto flex min-h-screen max-w-7xl flex-col px-4 sm:px-8 ${hasImages ? "pb-10 pt-40 md:pt-28" : "pb-6 pt-8"}`}>
        <div className={hasImages ? "flex flex-1 flex-col gap-8" : "flex flex-1 items-center justify-center"}>
        {!hasImages ? (
          <UploadArea />
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-ink-muted">共 {images.length} 張圖片</p>
            {isLayoutEditorOpen && (
              <LayoutEditor onClose={() => setIsLayoutEditorOpen(false)} />
            )}
            <PreviewGrid />
          </div>
        )}
        </div>

        <footer className={hasImages ? "pt-10" : "pt-6"}>
          <PrivacyNotice />
        </footer>
      </main>
    </>
  );
}
