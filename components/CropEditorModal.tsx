"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentImage, ImageCorners, Point } from "@/types/image";
import { applyManualCrop } from "@/lib/scanner";
import { useImageStore } from "@/hooks/useImageStore";

interface CropEditorModalProps {
  image: DocumentImage;
  onClose: () => void;
}

const HANDLE_SIZE = 30;
/** 預覽用縮圖最大邊長，越小預覽更新越快，但太小會看不清楚裁切線 */
const PREVIEW_MAX_DIMENSION = 480;

const CORNER_LABELS: Record<keyof ImageCorners, string> = {
  topLeftCorner: "左上角",
  topRightCorner: "右上角",
  bottomLeftCorner: "左下角",
  bottomRightCorner: "右下角",
};

function scalePoint(p: Point, scale: number): Point {
  return { x: p.x * scale, y: p.y * scale };
}

function scaleCorners(corners: ImageCorners, scale: number): ImageCorners {
  return {
    topLeftCorner: scalePoint(corners.topLeftCorner, scale),
    topRightCorner: scalePoint(corners.topRightCorner, scale),
    bottomLeftCorner: scalePoint(corners.bottomLeftCorner, scale),
    bottomRightCorner: scalePoint(corners.bottomRightCorner, scale),
  };
}

/** 沒有既有偵測角點時（例如自動偵測失敗），給一個內縮的預設矩形當起點 */
function defaultCorners(width: number, height: number): ImageCorners {
  const mx = width * 0.08;
  const my = height * 0.08;
  return {
    topLeftCorner: { x: mx, y: my },
    topRightCorner: { x: width - mx, y: my },
    bottomLeftCorner: { x: mx, y: height - my },
    bottomRightCorner: { x: width - mx, y: height - my },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 把原圖縮小成預覽用的小圖，回傳 object URL 與縮放比例，加速即時預覽的運算 */
function buildPreviewSource(
  originalUrl: string,
  naturalWidth: number,
  naturalHeight: number
): Promise<{ url: string; scale: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(naturalWidth * scale);
      canvas.height = Math.round(naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("無法建立預覽畫布"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("預覽圖輸出失敗"));
            return;
          }
          resolve({ url: URL.createObjectURL(blob), scale });
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = originalUrl;
  });
}

export default function CropEditorModal({ image, onClose }: CropEditorModalProps) {
  const { updateProcessingResult } = useImageStore();

  const [corners, setCorners] = useState<ImageCorners>(
    () => image.corners ?? defaultCorners(image.width, image.height)
  );
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<{ url: string; scale: number } | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingCornerRef = useRef<keyof ImageCorners | null>(null);
  const previewLoopRef = useRef<{ pending: boolean; nextCorners: ImageCorners | null }>({
    pending: false,
    nextCorners: null,
  });

  const displayScale = containerSize.width > 0 ? containerSize.width / image.width : 0;

  // 準備預覽用縮圖（只需做一次）
  useEffect(() => {
    let cancelled = false;
    buildPreviewSource(image.originalUrl, image.width, image.height)
      .then((result) => {
        if (cancelled) {
          URL.revokeObjectURL(result.url);
          return;
        }
        setPreviewSource(result);
      })
      .catch(() => {
        if (!cancelled) setError("預覽圖準備失敗，仍可直接按「重新校正」套用。");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.id]);

  // 追蹤圖片實際渲染尺寸，讓角點的螢幕座標與原始像素座標能互相換算
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 清理 preview 相關的 object URL，避免記憶體洩漏
  useEffect(() => {
    return () => {
      if (previewSource) URL.revokeObjectURL(previewSource.url);
    };
  }, [previewSource]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const runPreviewLoop = useCallback(async () => {
    if (previewLoopRef.current.pending || !previewSource) return;
    previewLoopRef.current.pending = true;

    while (previewLoopRef.current.nextCorners) {
      const target = previewLoopRef.current.nextCorners;
      previewLoopRef.current.nextCorners = null;

      const previewCorners = scaleCorners(target, previewSource.scale);
      const outcome = await applyManualCrop(previewSource.url, previewCorners);

      if (outcome.status === "corrected" && outcome.correctedUrl) {
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return outcome.correctedUrl!;
        });
      }
    }

    previewLoopRef.current.pending = false;
  }, [previewSource]);

  const schedulePreviewUpdate = useCallback(
    (nextCorners: ImageCorners) => {
      previewLoopRef.current.nextCorners = nextCorners;
      void runPreviewLoop();
    },
    [runPreviewLoop]
  );

  // 預覽縮圖準備好之後，先跑一次初始預覽
  useEffect(() => {
    if (previewSource) schedulePreviewUpdate(corners);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSource]);

  const updateCornerFromPointer = useCallback(
    (cornerKey: keyof ImageCorners, clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const relX = clamp(clientX - rect.left, 0, rect.width);
      const relY = clamp(clientY - rect.top, 0, rect.height);
      const naturalX = (relX / rect.width) * image.width;
      const naturalY = (relY / rect.height) * image.height;

      setCorners((prev) => {
        const next = { ...prev, [cornerKey]: { x: naturalX, y: naturalY } };
        schedulePreviewUpdate(next);
        return next;
      });
    },
    [image.width, image.height, schedulePreviewUpdate]
  );

  function handlePointerDown(cornerKey: keyof ImageCorners) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingCornerRef.current = cornerKey;
    };
  }

  function handlePointerMove(cornerKey: keyof ImageCorners) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (draggingCornerRef.current !== cornerKey) return;
      e.preventDefault();
      updateCornerFromPointer(cornerKey, e.clientX, e.clientY);
    };
  }

  function handlePointerUp() {
    draggingCornerRef.current = null;
  }

  async function handleApply() {
    setIsApplying(true);
    setError(null);
    try {
      const outcome = await applyManualCrop(image.originalUrl, corners);
      if (outcome.status === "corrected" && outcome.correctedUrl) {
        updateProcessingResult({
          id: image.id,
          status: "corrected",
          correctedUrl: outcome.correctedUrl,
          corners: outcome.corners ?? corners,
        });
        onClose();
      } else {
        setError(outcome.message ?? "重新校正失敗，請重新嘗試。");
      }
    } finally {
      setIsApplying(false);
    }
  }

  function handleReset() {
    const reset = image.corners ?? defaultCorners(image.width, image.height);
    setCorners(reset);
    schedulePreviewUpdate(reset);
  }

  const cornerEntries = useMemo(
    () => Object.entries(corners) as [keyof ImageCorners, Point][],
    [corners]
  );

  const orderedForPolygon: (keyof ImageCorners)[] = [
    "topLeftCorner",
    "topRightCorner",
    "bottomRightCorner",
    "bottomLeftCorner",
  ];
  const orderedPolygonPoints = orderedForPolygon
    .map((key) => `${corners[key].x * displayScale},${corners[key].y * displayScale}`)
    .join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-card bg-surface shadow-softHover">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-ink">調整裁切範圍</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-faint hover:bg-card hover:text-ink"
            aria-label="關閉"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 sm:flex-row">
          {/* 拖曳區：原圖 + 四個可拖曳角點 */}
          <div className="flex-1">
            <p className="mb-2 text-xs text-ink-muted">
              拖曳四個角點以調整文件範圍（Desktop 用滑鼠、手機用手指拖曳）
            </p>
            <div
              ref={containerRef}
              className="relative w-full select-none overflow-hidden rounded-control bg-card"
              style={{ touchAction: "none" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- object URL 圖片，不適用 next/image */}
              <img
                src={image.originalUrl}
                alt={image.fileName}
                className="pointer-events-none block h-auto w-full select-none"
                draggable={false}
              />

              {containerSize.width > 0 && (
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  aria-hidden
                >
                  <polygon
                    points={orderedPolygonPoints}
                    fill="rgba(61, 59, 55, 0.18)"
                    stroke="rgba(61, 59, 55, 0.9)"
                    strokeWidth={2}
                  />
                </svg>
              )}

              {containerSize.width > 0 &&
                cornerEntries.map(([key, point]) => (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={`拖曳調整${CORNER_LABELS[key]}`}
                    onPointerDown={handlePointerDown(key)}
                    onPointerMove={handlePointerMove(key)}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    className="absolute flex cursor-grab items-center justify-center rounded-full border-2 border-white bg-accent shadow-softHover active:cursor-grabbing"
                    style={{
                      width: HANDLE_SIZE,
                      height: HANDLE_SIZE,
                      left: point.x * displayScale - HANDLE_SIZE / 2,
                      top: point.y * displayScale - HANDLE_SIZE / 2,
                      touchAction: "none",
                    }}
                  />
                ))}
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="mt-2 text-xs text-ink-muted underline hover:text-ink"
            >
              重設為自動偵測結果
            </button>
          </div>

          {/* 即時預覽 */}
          <div className="w-full sm:w-56 sm:shrink-0">
            <p className="mb-2 text-xs text-ink-muted">校正後預覽</p>
            <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-control bg-card">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- object URL 圖片，不適用 next/image
                <img
                  src={previewUrl}
                  alt="校正後預覽"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-xs text-ink-faint">準備預覽中…</span>
              )}
            </div>
          </div>
        </div>

        {error && <p className="px-5 text-sm text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-control px-4 py-2 text-sm font-medium text-ink-muted hover:bg-card"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isApplying}
            className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isApplying ? "校正中…" : "重新校正"}
          </button>
        </div>
      </div>
    </div>
  );
}
