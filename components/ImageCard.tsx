"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { DocumentImage } from "@/types/image";
import { formatFileSize } from "@/lib/image";
import { triggerUrlDownload } from "@/lib/download";
import { useImageStore } from "@/hooks/useImageStore";
import { recognizeText } from "@/lib/ocr";
import CropEditorModal from "./CropEditorModal";

interface ImageCardProps {
  image: DocumentImage;
  index: number;
}

function jpgFileName(originalFileName: string): string {
  const base = originalFileName.replace(/\.[^.]+$/, "");
  return `${base}_corrected.jpg`;
}

type OcrState = "idle" | "recognizing" | "success" | "error";

export default function ImageCard({ image, index }: ImageCardProps) {
  const { removeImage } = useImageStore();
  const [showOriginal, setShowOriginal] = useState(false);
  const [isCropEditorOpen, setIsCropEditorOpen] = useState(false);
  const [ocrState, setOcrState] = useState<OcrState>("idle");
  const [ocrText, setOcrText] = useState("");
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const hasCorrected = image.status === "corrected" && !!image.correctedUrl;
  const hasFailed = image.status === "failed";
  const canManualCrop = image.status === "corrected" || image.status === "failed";
  // 依需求：若尚未校正，也允許直接對原圖辨識文字，只要不是還在自動校正處理中即可
  const canRecognizeText = image.status !== "processing";
  const displayUrl = hasCorrected && !showOriginal ? image.correctedUrl! : image.originalUrl;

  async function handleRecognizeText() {
    setOcrState("recognizing");
    setOcrError(null);
    const targetUrl = image.correctedUrl ?? image.originalUrl;
    const outcome = await recognizeText(targetUrl);
    if (outcome.status === "success") {
      setOcrText(outcome.text ?? "");
      setOcrState("success");
    } else {
      setOcrError(outcome.message ?? "辨識失敗，請重新嘗試。");
      setOcrState("error");
    }
  }

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(ocrText);
      setCopyConfirmed(true);
      setTimeout(() => setCopyConfirmed(false), 2000);
    } catch {
      setOcrError("複製失敗，請手動選取文字複製。");
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        "group relative flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-soft transition-shadow",
        isDragging && "z-10 opacity-90 shadow-softHover"
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute left-2 top-2 flex h-7 w-7 cursor-grab items-center justify-center rounded-full bg-white/90 text-ink-faint shadow-soft active:cursor-grabbing"
        aria-label="拖曳以調整順序"
        title="拖曳以調整順序"
      >
        ⠿
      </div>

      <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-white/90 px-1.5 text-xs font-medium text-ink-muted shadow-soft">
        {index + 1}
      </span>

      <div className="relative aspect-[3/4] w-full bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- object URL 縮圖，不適用 next/image 最佳化 */}
        <img
          src={displayUrl}
          alt={image.fileName}
          className="h-full w-full object-cover"
        />

        {image.status === "processing" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/40 text-white backdrop-blur-[1px]">
            <span
              className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-hidden
            />
            <span className="text-xs font-medium">校正中…</span>
          </div>
        )}

        {hasCorrected && (
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-ink-muted shadow-soft transition-colors hover:text-ink"
          >
            {showOriginal ? "原圖" : "校正後"}
          </button>
        )}

        {hasFailed && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-danger/90 px-2.5 py-2 text-xs font-medium text-white">
            <span aria-hidden>⚠️</span>
            <span>無法辨識文件，已使用原圖。</span>
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink" title={image.fileName}>
            {image.fileName}
          </p>
          <p className="text-xs text-ink-faint">
            {image.width}×{image.height} · {formatFileSize(image.sizeBytes)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => removeImage(image.id)}
          className="shrink-0 rounded-full p-1.5 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
          aria-label={`刪除 ${image.fileName}`}
          title="刪除"
        >
          ✕
        </button>
      </div>

      {canRecognizeText && (
        <div className="border-t border-border px-3 pt-2">
          <button
            type="button"
            onClick={handleRecognizeText}
            disabled={ocrState === "recognizing"}
            className="flex w-full items-center justify-center gap-2 rounded-control border border-border px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ocrState === "recognizing" && (
              <span
                className="h-3 w-3 animate-spin rounded-full border-2 border-ink-faint/40 border-t-ink-muted"
                aria-hidden
              />
            )}
            {ocrState === "recognizing" ? "辨識中…" : "辨識文字"}
          </button>

          {ocrState === "error" && (
            <p className="mt-1.5 text-xs text-danger">{ocrError}</p>
          )}

          {ocrState === "success" && (
            <div className="mt-2 space-y-1.5 pb-1">
              <p className="text-center text-xs text-ink-faint">──── 辨識結果 ────</p>
              <textarea
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
                rows={5}
                className="w-full resize-y rounded-control border border-border p-2 text-xs text-ink focus:border-accent focus:outline-none"
              />
              {ocrError && <p className="text-xs text-danger">{ocrError}</p>}
              <button
                type="button"
                onClick={handleCopyText}
                className="w-full rounded-control bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white"
              >
                {copyConfirmed ? "已複製" : "複製文字"}
              </button>
            </div>
          )}
        </div>
      )}

      {(hasCorrected || canManualCrop) && (
        <div className="flex gap-2 border-t border-border px-3 pb-3 pt-2">
          {hasCorrected && (
            <button
              type="button"
              onClick={() =>
                triggerUrlDownload(image.correctedUrl!, jpgFileName(image.fileName))
              }
              className="flex-1 rounded-control bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white"
            >
              下載 JPG
            </button>
          )}
          {canManualCrop && (
            <button
              type="button"
              onClick={() => setIsCropEditorOpen(true)}
              className="flex-1 rounded-control border border-border px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent"
            >
              調整裁切範圍
            </button>
          )}
        </div>
      )}

      {isCropEditorOpen && (
        <CropEditorModal image={image} onClose={() => setIsCropEditorOpen(false)} />
      )}
    </div>
  );
}
