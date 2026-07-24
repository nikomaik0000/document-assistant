"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentImage, ImageCorners, Point } from "@/types/image";
import { applyManualCrop } from "@/lib/scanner";
import { useImageStore } from "@/hooks/useImageStore";
import {
  applyImageAdjustments,
  normalizeImageAdjustments,
} from "@/lib/imageAdjustments";
import type { ImageAdjustments } from "@/types/image";

interface CropEditorModalProps {
  image: DocumentImage;
  onClose: () => void;
}

const HANDLE_SIZE = 30;

const CORNER_LABELS: Record<keyof ImageCorners, string> = {
  topLeftCorner: "左上角",
  topRightCorner: "右上角",
  bottomLeftCorner: "左下角",
  bottomRightCorner: "右下角",
};

type EdgeKey = "top" | "right" | "bottom" | "left";

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

export default function CropEditorModal({ image, onClose }: CropEditorModalProps) {
  const { updateProcessingResult } = useImageStore();

  const [corners, setCorners] = useState<ImageCorners>(
    () => image.corners ?? defaultCorners(image.width, image.height)
  );
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(() =>
    normalizeImageAdjustments(image.imageAdjustments)
  );
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingCornerRef = useRef<keyof ImageCorners | null>(null);
  const draggingShapeRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCorners: ImageCorners;
  } | null>(null);
  const draggingEdgeRef = useRef<{
    edge: EdgeKey;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCorners: ImageCorners;
  } | null>(null);
  const initialCornersRef = useRef<ImageCorners>(image.corners ?? defaultCorners(image.width, image.height));
  const initialAdjustmentsRef = useRef<ImageAdjustments>(
    normalizeImageAdjustments(image.imageAdjustments)
  );
  const previewLoopRef = useRef<{
    pending: boolean;
    next: { corners: ImageCorners; adjustments: ImageAdjustments } | null;
  }>({
    pending: false,
    next: null,
  });

  const displayScale = containerSize.width > 0 ? containerSize.width / image.width : 0;

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
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const runPreviewLoop = useCallback(async () => {
    if (previewLoopRef.current.pending) return;
    previewLoopRef.current.pending = true;

    while (previewLoopRef.current.next) {
      const target = previewLoopRef.current.next;
      previewLoopRef.current.next = null;

      const outcome = await applyManualCrop(image.originalUrl, target.corners);

      if (outcome.status === "corrected" && outcome.correctedUrl) {
        const adjustedUrl = await applyImageAdjustments(
          outcome.correctedUrl,
          target.adjustments
        );
        URL.revokeObjectURL(outcome.correctedUrl);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return adjustedUrl;
        });
      }
    }

    previewLoopRef.current.pending = false;
  }, [image.originalUrl]);

  const schedulePreviewUpdate = useCallback(
    (nextCorners: ImageCorners, nextAdjustments: ImageAdjustments = adjustments) => {
      previewLoopRef.current.next = {
        corners: nextCorners,
        adjustments: nextAdjustments,
      };
      void runPreviewLoop();
    },
    [adjustments, runPreviewLoop]
  );

  // 使用原始解析度產生預覽，避免畫面預覽與套用後品質不一致。
  useEffect(() => {
    schedulePreviewUpdate(corners, adjustments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    draggingShapeRef.current = null;
    draggingEdgeRef.current = null;
  }

  function translateCorners(startCorners: ImageCorners, dx: number, dy: number): ImageCorners {
    const points = Object.values(startCorners);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const clampedDx = clamp(dx, -minX, image.width - maxX);
    const clampedDy = clamp(dy, -minY, image.height - maxY);

    return {
      topLeftCorner: {
        x: startCorners.topLeftCorner.x + clampedDx,
        y: startCorners.topLeftCorner.y + clampedDy,
      },
      topRightCorner: {
        x: startCorners.topRightCorner.x + clampedDx,
        y: startCorners.topRightCorner.y + clampedDy,
      },
      bottomLeftCorner: {
        x: startCorners.bottomLeftCorner.x + clampedDx,
        y: startCorners.bottomLeftCorner.y + clampedDy,
      },
      bottomRightCorner: {
        x: startCorners.bottomRightCorner.x + clampedDx,
        y: startCorners.bottomRightCorner.y + clampedDy,
      },
    };
  }

  function handleShapePointerDown(e: React.PointerEvent<SVGPolygonElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingShapeRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCorners: corners,
    };
  }

  function handleShapePointerMove(e: React.PointerEvent<SVGPolygonElement>) {
    const drag = draggingShapeRef.current;
    const el = containerRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    e.preventDefault();

    const rect = el.getBoundingClientRect();
    const dx = ((e.clientX - drag.startClientX) / rect.width) * image.width;
    const dy = ((e.clientY - drag.startClientY) / rect.height) * image.height;
    const next = translateCorners(drag.startCorners, dx, dy);
    setCorners(next);
    schedulePreviewUpdate(next);
  }

  function translateEdge(startCorners: ImageCorners, edge: EdgeKey, dx: number, dy: number) {
    const next = {
      topLeftCorner: { ...startCorners.topLeftCorner },
      topRightCorner: { ...startCorners.topRightCorner },
      bottomLeftCorner: { ...startCorners.bottomLeftCorner },
      bottomRightCorner: { ...startCorners.bottomRightCorner },
    };

    if (edge === "top") {
      const minY = Math.min(startCorners.topLeftCorner.y, startCorners.topRightCorner.y);
      const maxY = Math.max(startCorners.topLeftCorner.y, startCorners.topRightCorner.y);
      const offsetY = clamp(dy, -minY, image.height - maxY);
      next.topLeftCorner.y = startCorners.topLeftCorner.y + offsetY;
      next.topRightCorner.y = startCorners.topRightCorner.y + offsetY;
    }

    if (edge === "bottom") {
      const minY = Math.min(startCorners.bottomLeftCorner.y, startCorners.bottomRightCorner.y);
      const maxY = Math.max(startCorners.bottomLeftCorner.y, startCorners.bottomRightCorner.y);
      const offsetY = clamp(dy, -minY, image.height - maxY);
      next.bottomLeftCorner.y = startCorners.bottomLeftCorner.y + offsetY;
      next.bottomRightCorner.y = startCorners.bottomRightCorner.y + offsetY;
    }

    if (edge === "left") {
      const minX = Math.min(startCorners.topLeftCorner.x, startCorners.bottomLeftCorner.x);
      const maxX = Math.max(startCorners.topLeftCorner.x, startCorners.bottomLeftCorner.x);
      const offsetX = clamp(dx, -minX, image.width - maxX);
      next.topLeftCorner.x = startCorners.topLeftCorner.x + offsetX;
      next.bottomLeftCorner.x = startCorners.bottomLeftCorner.x + offsetX;
    }

    if (edge === "right") {
      const minX = Math.min(startCorners.topRightCorner.x, startCorners.bottomRightCorner.x);
      const maxX = Math.max(startCorners.topRightCorner.x, startCorners.bottomRightCorner.x);
      const offsetX = clamp(dx, -minX, image.width - maxX);
      next.topRightCorner.x = startCorners.topRightCorner.x + offsetX;
      next.bottomRightCorner.x = startCorners.bottomRightCorner.x + offsetX;
    }

    return next;
  }

  function handleEdgePointerDown(edge: EdgeKey) {
    return (e: React.PointerEvent<SVGLineElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingEdgeRef.current = {
        edge,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCorners: corners,
      };
    };
  }

  function handleEdgePointerMove(e: React.PointerEvent<SVGLineElement>) {
    const drag = draggingEdgeRef.current;
    const el = containerRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    e.preventDefault();

    const rect = el.getBoundingClientRect();
    const dx = ((e.clientX - drag.startClientX) / rect.width) * image.width;
    const dy = ((e.clientY - drag.startClientY) / rect.height) * image.height;
    const next = translateEdge(drag.startCorners, drag.edge, dx, dy);
    setCorners(next);
    schedulePreviewUpdate(next);
  }

  async function handleApply() {
    setIsApplying(true);
    setError(null);
    try {
      const outcome = await applyManualCrop(image.originalUrl, corners);
      if (outcome.status === "corrected" && outcome.correctedUrl) {
        const adjustedUrl = await applyImageAdjustments(outcome.correctedUrl, adjustments);
        URL.revokeObjectURL(outcome.correctedUrl);
        updateProcessingResult({
          id: image.id,
          status: "corrected",
          correctedUrl: adjustedUrl,
          corners: outcome.corners ?? corners,
          imageAdjustments: adjustments,
        });
        onClose();
      } else {
        setError(outcome.message ?? "文件校正失敗，請重新嘗試。");
      }
    } finally {
      setIsApplying(false);
    }
  }

  function handleReset() {
    const resetCorners = initialCornersRef.current;
    const resetAdjustments = initialAdjustmentsRef.current;
    setCorners(resetCorners);
    setAdjustments(resetAdjustments);
    schedulePreviewUpdate(resetCorners, resetAdjustments);
  }

  function updateAdjustments(patch: Partial<ImageAdjustments>) {
    setAdjustments((prev) => {
      const next = normalizeImageAdjustments({ ...prev, ...patch });
      schedulePreviewUpdate(corners, next);
      return next;
    });
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
  const edgeLines = [
    {
      edge: "top" as const,
      from: corners.topLeftCorner,
      to: corners.topRightCorner,
      cursorClass: "cursor-ns-resize",
    },
    {
      edge: "right" as const,
      from: corners.topRightCorner,
      to: corners.bottomRightCorner,
      cursorClass: "cursor-ew-resize",
    },
    {
      edge: "bottom" as const,
      from: corners.bottomLeftCorner,
      to: corners.bottomRightCorner,
      cursorClass: "cursor-ns-resize",
    },
    {
      edge: "left" as const,
      from: corners.topLeftCorner,
      to: corners.bottomLeftCorner,
      cursorClass: "cursor-ew-resize",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`document-correction-title-${image.id}`}
        className="flex max-h-[92vh] w-full max-w-[min(1400px,calc(100vw-32px))] flex-col overflow-hidden rounded-card bg-surface shadow-softHover"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id={`document-correction-title-${image.id}`} className="text-sm font-medium text-ink">
            文件校正
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-ink-faint hover:bg-card hover:text-ink"
            aria-label="關閉文件校正"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-xs text-ink-muted">
            拖曳角點、邊線或中央區域調整範圍，也可調整黑白、亮度與對比。
          </p>

          <div className="mt-3 flex w-full flex-wrap items-center justify-start gap-x-6 gap-y-2 rounded-control bg-card px-4 py-2 md:flex-nowrap">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={adjustments.grayscale}
                onChange={(event) => updateAdjustments({ grayscale: event.target.checked })}
                className="checkbox-control"
              />
              <span>黑白</span>
            </label>

            <div className="grid grid-cols-[auto_180px_32px] items-center gap-3 text-sm text-ink">
              <label htmlFor={`brightness-${image.id}`} className="font-medium">
                亮度
              </label>
              <input
                id={`brightness-${image.id}`}
                type="range"
                min={-100}
                max={100}
                step={1}
                value={adjustments.brightness}
                onChange={(event) =>
                  updateAdjustments({ brightness: Number(event.target.value) })
                }
                className="w-full min-w-0 accent-ink"
              />
              <span className="text-right">{adjustments.brightness}</span>
            </div>

            <div className="grid grid-cols-[auto_180px_32px] items-center gap-3 text-sm text-ink">
              <label htmlFor={`contrast-${image.id}`} className="font-medium">
                對比
              </label>
              <input
                id={`contrast-${image.id}`}
                type="range"
                min={-100}
                max={100}
                step={1}
                value={adjustments.contrast}
                onChange={(event) =>
                  updateAdjustments({ contrast: Number(event.target.value) })
                }
                className="w-full min-w-0 accent-ink"
              />
              <span className="text-right">{adjustments.contrast}</span>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="h-9 rounded-control border border-border bg-white px-4 text-sm font-medium text-ink transition-colors hover:border-border hover:bg-[#f8f7f5] hover:text-ink active:bg-card focus-visible:ring-2 focus-visible:ring-border"
            >
              重設
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
            <section className="min-w-0">
              <div className="relative flex h-[min(62vh,680px)] min-h-[360px] items-center justify-center overflow-hidden rounded-control bg-[#f8f7f5] p-3 md:min-h-[480px]">
                <span className="absolute left-3 top-3 z-10 rounded-sm bg-white/85 px-2 py-1 text-xs font-medium text-ink">
                  校正前
                </span>
                <div
                  ref={containerRef}
                  className="image-preview-paper relative inline-block max-h-full max-w-full select-none overflow-hidden bg-white"
                  style={{ touchAction: "none" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- object URL 圖片，不適用 next/image */}
                  <img
                    src={image.originalUrl}
                    alt={image.fileName}
                    className="pointer-events-none block max-h-[calc(min(62vh,680px)-24px)] max-w-full select-none object-contain"
                    draggable={false}
                  />

                  {containerSize.width > 0 && (
                    <svg className="absolute inset-0 h-full w-full" aria-hidden>
                      <polygon
                        points={orderedPolygonPoints}
                        fill="rgba(61, 59, 55, 0.18)"
                        stroke="rgba(61, 59, 55, 0.9)"
                        strokeWidth={2}
                        className="cursor-move active:cursor-grabbing"
                        onPointerDown={handleShapePointerDown}
                        onPointerMove={handleShapePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        style={{ touchAction: "none" }}
                      />
                      {edgeLines.map(({ edge, from, to, cursorClass }) => (
                        <line
                          key={edge}
                          x1={from.x * displayScale}
                          y1={from.y * displayScale}
                          x2={to.x * displayScale}
                          y2={to.y * displayScale}
                          stroke="transparent"
                          strokeLinecap="round"
                          strokeWidth={24}
                          className={cursorClass}
                          onPointerDown={handleEdgePointerDown(edge)}
                          onPointerMove={handleEdgePointerMove}
                          onPointerUp={handlePointerUp}
                          onPointerCancel={handlePointerUp}
                          style={{ touchAction: "none" }}
                        />
                      ))}
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
              </div>
            </section>

            <section className="min-w-0">
              <div className="relative flex h-[min(62vh,680px)] min-h-[360px] items-center justify-center overflow-hidden rounded-control bg-[#f8f7f5] p-3 md:min-h-[480px]">
                <span className="absolute left-3 top-3 z-10 rounded-sm bg-white/85 px-2 py-1 text-xs font-medium text-ink">
                  校正後
                </span>
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- object URL 圖片，不適用 next/image
                  <img
                    src={previewUrl}
                    alt="校正後預覽"
                    className="image-preview-paper max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-ink-faint">準備預覽中…</span>
                )}
              </div>
            </section>
          </div>
        </div>

        {error && <p className="px-6 pb-3 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
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
            {isApplying ? "套用中…" : "套用"}
          </button>
        </div>
      </div>
    </div>
  );
}
