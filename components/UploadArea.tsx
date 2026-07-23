"use client";

import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import clsx from "clsx";
import { createDocumentImage, isAcceptedImageFile } from "@/lib/image";
import { useImageStore } from "@/hooks/useImageStore";

interface UploadAreaProps {
  /** 精簡模式：已有圖片列表時顯示為較小的附加上傳列，而非置中大區塊 */
  compact?: boolean;
  toolbar?: boolean;
}

export default function UploadArea({ compact = false, toolbar = false }: UploadAreaProps) {
  const { addImages } = useImageStore();
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setError(null);

      const validFiles = acceptedFiles.filter(isAcceptedImageFile);
      const invalidCount =
        fileRejections.length + (acceptedFiles.length - validFiles.length);

      if (invalidCount > 0) {
        setError(
          `已略過 ${invalidCount} 個不支援的檔案格式（僅支援 JPG、PNG、WEBP、HEIC）。`
        );
      }

      if (validFiles.length === 0) return;

      const results = await Promise.allSettled(
        validFiles.map((file) => createDocumentImage(file))
      );

      const created = results
        .filter(
          (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createDocumentImage>>> =>
            r.status === "fulfilled"
        )
        .map((r) => r.value);

      const failedCount = results.length - created.length;
      if (failedCount > 0) {
        setError(
          (prev) =>
            `${prev ? prev + " " : ""}${failedCount} 個檔案讀取失敗，請確認檔案未毀損。`
        );
      }

      if (created.length > 0) {
        addImages(created);
      }
    },
    [addImages]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "image/heic": [".heic"],
      "image/heif": [".heif"],
    },
    multiple: true,
  });

  if (toolbar) {
    return (
      <div className="min-w-0 flex-1 space-y-1">
        <div
          {...getRootProps()}
          className={clsx(
            "flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-control border border-border px-3 text-center text-sm transition-colors sm:text-base",
            "font-serif-zh tracking-[0.12em]",
            isDragActive
              ? "bg-accent-soft text-ink"
              : "bg-white/70 text-ink hover:bg-white"
          )}
        >
          <input {...getInputProps()} />
          <span aria-hidden>＋</span>
          <span className="truncate">
            {isDragActive ? "放開即可上傳" : "拖曳圖片到這裡，或點擊選擇檔案"}
          </span>
        </div>
        {error && <p className="px-1 text-xs text-danger">{error}</p>}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="space-y-2">
        <div
          {...getRootProps()}
          className={clsx(
            "flex cursor-pointer items-center justify-center gap-2 rounded-control border border-border px-4 py-3 text-sm transition-colors",
            isDragActive
              ? "bg-accent-soft text-ink"
              : "bg-surface text-ink hover:bg-accent-soft"
          )}
        >
          <input {...getInputProps()} />
          <span aria-hidden>＋</span>
          <span>拖曳圖片到這裡，或點擊選擇檔案</span>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl space-y-3">
      <div
        {...getRootProps()}
        className={clsx(
          "flex min-h-[280px] cursor-pointer flex-col items-center justify-center gap-4 rounded-panel border border-border px-8 py-14 text-center transition-colors",
          isDragActive
            ? "bg-accent-soft"
            : "bg-surface hover:bg-white"
        )}
      >
        <input {...getInputProps()} />
        <DocumentIcon />
        <div className="space-y-1">
          <p className="text-lg font-medium text-ink">Document Assistant</p>
          <p className="text-sm text-ink-muted">
            {isDragActive ? "放開即可上傳" : "拖曳檔案到這裡"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-faint">
          <span className="h-px w-8 bg-border" />
          <span>或</span>
          <span className="h-px w-8 bg-border" />
        </div>
        <button
          type="button"
          className="rounded-control bg-accent-soft px-5 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-80"
        >
          選擇檔案
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function DocumentIcon() {
  return (
    <svg
      width="48"
      height="48"
      className="h-12 w-12 shrink-0 text-ink-faint"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14 6h14l8 8v28H14V6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M28 6v9h8M19 24h14M19 30h14M19 36h9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
