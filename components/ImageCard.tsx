"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { DocumentImage } from "@/types/image";
import { formatFileSize } from "@/lib/image";
import { useImageStore } from "@/hooks/useImageStore";

interface ImageCardProps {
  image: DocumentImage;
  index: number;
}

export default function ImageCard({ image, index }: ImageCardProps) {
  const { removeImage } = useImageStore();
  const [showOriginal, setShowOriginal] = useState(false);
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
  const displayUrl = hasCorrected && !showOriginal ? image.correctedUrl! : image.originalUrl;

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
      </div>

      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink" title={image.fileName}>
            {image.fileName}
          </p>
          <p className="text-xs text-ink-faint">
            {image.width}×{image.height} · {formatFileSize(image.sizeBytes)}
          </p>
          {image.status === "failed" && image.statusMessage && (
            <p className="mt-0.5 text-xs text-danger">{image.statusMessage}</p>
          )}
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
    </div>
  );
}
