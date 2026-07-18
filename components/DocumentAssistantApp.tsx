"use client";

import { useImageStore } from "@/hooks/useImageStore";
import { useDocumentProcessor } from "@/hooks/useDocumentProcessor";
import UploadArea from "./UploadArea";
import PreviewGrid from "./PreviewGrid";
import PrivacyNotice from "./PrivacyNotice";
import PdfExportPanel from "./PdfExportPanel";

export default function DocumentAssistantApp() {
  const { images } = useImageStore();
  useDocumentProcessor();
  const hasImages = images.length > 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-10 sm:px-8">
      <div className="flex flex-1 flex-col justify-center gap-8">
        {!hasImages ? (
          <UploadArea />
        ) : (
          <div className="space-y-6">
            <UploadArea compact />
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-ink-muted">
                共 {images.length} 張圖片
              </p>
              <PdfExportPanel />
            </div>
            <PreviewGrid />
          </div>
        )}
      </div>

      <footer className="pt-10">
        <PrivacyNotice />
      </footer>
    </main>
  );
}
