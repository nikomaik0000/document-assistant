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
        "group relative flex h-full flex-col overflow-hidden rounded-none border border-border bg-surface shadow-soft transition-shadow",
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

      <div className="relative h-72 w-full bg-card p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- object URL 縮圖，不適用 next/image 最佳化 */}
        <img
          src={displayUrl}
          alt={image.fileName}
          className="h-full w-full object-contain"
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

      <div className="flex items-start justify-between gap-2 border-t border-border px-3 py-2">
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

      <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
        {canRecognizeText ? (
          <button
            type="button"
            onClick={handleRecognizeText}
            disabled={ocrState === "recognizing"}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-none bg-card px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ocrState === "recognizing" && (
              <span
                className="h-3 w-3 animate-spin rounded-full border-2 border-ink-faint/40 border-t-ink-muted"
                aria-hidden
              />
            )}
            {ocrState === "recognizing" ? "辨識中…" : "辨識文字"}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="min-h-11 w-full rounded-none bg-card px-3 py-2 text-sm font-medium text-ink-faint opacity-60"
          >
            辨識文字
          </button>
        )}

        <button
          type="button"
          onClick={() => setIsCropEditorOpen(true)}
          disabled={!canManualCrop}
          className="min-h-11 w-full rounded-none bg-card px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-ink-faint disabled:opacity-60"
        >
          裁切範圍
        </button>
      </div>

      <div className="border-t border-border p-3">
        <textarea
          value={
            ocrState === "success"
              ? ocrText
              : ocrState === "recognizing"
                ? "辨識中，請稍候..."
                : ""
          }
          onChange={(e) => setOcrText(e.target.value)}
          readOnly={ocrState !== "success"}
          placeholder="辨識後的文字會顯示在這裡"
          className="h-32 w-full resize-none overflow-y-auto rounded-none border border-border bg-white p-3 text-sm leading-relaxed text-ink focus:border-accent focus:outline-none"
        />
        {ocrState === "error" && (
          <p className="mt-2 text-xs text-danger">{ocrError}</p>
        )}
        {ocrError && ocrState === "success" && (
          <p className="mt-2 text-xs text-danger">{ocrError}</p>
        )}
      </div>

      <div className="mt-auto space-y-2 border-t border-border p-3">
        <button
          type="button"
          onClick={handleCopyText}
          disabled={ocrState !== "success" || !ocrText.trim()}
          className="min-h-11 w-full rounded-none bg-card px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-ink-faint disabled:opacity-60"
        >
          {copyConfirmed ? "已複製" : "複製文字"}
        </button>
        <button
          type="button"
          onClick={() =>
            hasCorrected &&
            triggerUrlDownload(image.correctedUrl!, jpgFileName(image.fileName))
          }
          disabled={!hasCorrected}
          className="min-h-11 w-full rounded-none bg-card px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-ink-faint disabled:opacity-60"
        >
          下載 JPG
        </button>
      </div>

      {isCropEditorOpen && (
        <CropEditorModal image={image} onClose={() => setIsCropEditorOpen(false)} />
      )}
    </div>
  );
}
