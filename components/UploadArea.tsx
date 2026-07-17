"use client";

import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import clsx from "clsx";
import { createDocumentImage, isAcceptedImageFile } from "@/lib/image";
import { useImageStore } from "@/hooks/useImageStore";

interface UploadAreaProps {
  /** 精簡模式：已有圖片列表時顯示為較小的附加上傳列，而非置中大區塊 */
  compact?: boolean;
}

export default function UploadArea({ compact = false }: UploadAreaProps) {
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

  if (compact) {
    return (
      <div className="space-y-2">
        <div
          {...getRootProps()}
          className={clsx(
            "flex cursor-pointer items-center justify-center gap-2 rounded-control border border-dashed px-4 py-3 text-sm transition-colors",
            isDragActive
              ? "border-accent bg-accent-soft text-accent"
              : "border-border-strong bg-surface text-ink-muted hover:border-ink-faint"
          )}
        >
          <input {...getInputProps()} />
          <span aria-hidden>＋</span>
          <span>拖曳更多圖片到這裡，或點擊選擇檔案</span>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={clsx(
          "flex min-h-[280px] cursor-pointer flex-col items-center justify-center gap-4 rounded-card border-2 border-dashed px-8 py-16 text-center transition-all",
          isDragActive
            ? "border-accent bg-accent-soft"
            : "border-border-strong bg-surface hover:border-ink-faint hover:shadow-soft"
        )}
      >
        <input {...getInputProps()} />
        <div className="text-4xl" aria-hidden>
          📄
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium text-ink">Document Assistant</p>
          <p className="text-sm text-ink-muted">
            {isDragActive ? "放開即可上傳" : "拖曳檔案到這裡"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-faint">
          <span className="h-px w-8 bg-border" />
          <span>or</span>
          <span className="h-px w-8 bg-border" />
        </div>
        <button
          type="button"
          className="rounded-control bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Choose Files
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
