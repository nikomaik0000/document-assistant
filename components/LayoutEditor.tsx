"use client";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { useId, useMemo, useRef, useState } from "react";
import { useImageStore } from "@/hooks/useImageStore";
import {
  layoutPresets,
  useLayoutEditorStore,
} from "@/hooks/useLayoutEditorStore";
import { stampPresets } from "@/lib/stamps";
import type { PdfPageStamp } from "@/lib/pdf";
import type { DocumentImage } from "@/types/image";

interface LayoutEditorProps {
  onClose: () => void;
}

const A4_PORTRAIT = { width: 595.28, height: 841.89 };
const A4_LANDSCAPE = { width: 841.89, height: 595.28 };

function getImageUrl(image: DocumentImage): string {
  return image.status === "corrected" && image.correctedUrl
    ? image.correctedUrl
    : image.originalUrl;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function countStepDecimals(step: number): number {
  const stepText = String(step);
  if (!stepText.includes(".")) return 0;
  return stepText.split(".")[1]?.length ?? 0;
}

function formatNumberValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function stepNumberValue(
  value: number,
  direction: -1 | 1,
  min: number,
  max: number,
  step: number
): number {
  const decimals = countStepDecimals(step);
  const nextValue = value + direction * step;
  return clampNumber(Number(nextValue.toFixed(decimals)), min, max);
}

function SortablePreviewImage({ image }: { image: DocumentImage }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: image.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={clsx(
        "relative min-h-0 overflow-hidden rounded-control border border-border bg-white",
        isDragging && "z-20 opacity-80 shadow-softHover"
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute left-1.5 top-1.5 z-10 flex h-8 min-w-8 cursor-grab items-center justify-center rounded-full bg-white/95 px-2 text-sm text-ink-muted shadow-soft active:cursor-grabbing"
        aria-label="拖曳調整圖片順序"
        title="拖曳調整圖片順序"
      >
        ⠿
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- object URL preview */}
      <img
        src={getImageUrl(image)}
        alt={image.fileName}
        className="h-full w-full object-contain"
      />
    </div>
  );
}

export default function LayoutEditor({ onClose }: LayoutEditorProps) {
  const { images, reorderImages } = useImageStore();
  const [stampDraft, setStampDraft] = useState(stampPresets[0]?.text ?? "");
  const suppressNextPageClickRef = useRef(false);
  const {
    selectedPresetId,
    setSelectedPresetId,
    customRows,
    setCustomRows,
    customColumns,
    setCustomColumns,
    marginPt,
    setMarginPt,
    gapPt,
    setGapPt,
    orientation,
    setOrientation,
    selectedPageIndex,
    setSelectedPageIndex,
    selectedStampId,
    setSelectedStampId,
    pageStamps,
    layoutOptions,
    addPageStamp,
    updatePageStamp,
    removePageStamp,
    copyPageStamp,
    movePageStampLayer,
  } = useLayoutEditorStore();

  const { rows, columns, imagesPerPage } = layoutOptions;
  const pageSize = orientation === "portrait" ? A4_PORTRAIT : A4_LANDSCAPE;
  const pages = useMemo(() => {
    const result: DocumentImage[][] = [];
    for (let i = 0; i < images.length; i += imagesPerPage) {
      result.push(images.slice(i, i + imagesPerPage));
    }
    return result.length > 0 ? result : [[]];
  }, [images, imagesPerPage]);
  const currentPageIndex = Math.min(selectedPageIndex, pages.length - 1);
  const currentPageImages = pages[currentPageIndex] ?? [];
  const selectedStamp =
    pageStamps[currentPageIndex]?.find((stamp) => stamp.id === selectedStampId) ??
    null;
  const stampTextValue = selectedStamp?.text ?? stampDraft;
  const presetSelectValue = stampPresets.some((preset) => preset.text === stampTextValue)
    ? stampTextValue
    : "";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = images.findIndex((image) => image.id === active.id);
    const newIndex = images.findIndex((image) => image.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderImages(arrayMove(images, oldIndex, newIndex).map((image) => image.id));
  }

  function changePage(pageIndex: number) {
    setSelectedPageIndex(clampNumber(pageIndex, 0, pages.length - 1));
    setSelectedStampId(null);
  }

  function handleStampPointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    stampId: string
  ) {
    event.stopPropagation();
    setSelectedPageIndex(currentPageIndex);
    setSelectedStampId(stampId);
    suppressNextPageClickRef.current = true;

    const pageElement = event.currentTarget.closest<HTMLElement>("[data-a4-page]");
    if (!pageElement) return;
    const pointerArea: HTMLElement = pageElement;
    pointerArea.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    let didMove = false;

    function handlePointerMove(moveEvent: PointerEvent) {
      const rect = pointerArea.getBoundingClientRect();
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      didMove ||= distance > 4;
      updatePageStamp(currentPageIndex, stampId, {
        x: clamp01((moveEvent.clientX - rect.left) / rect.width),
        y: clamp01((moveEvent.clientY - rect.top) / rect.height),
      });
    }

    function handlePointerUp() {
      setSelectedPageIndex(currentPageIndex);
      setSelectedStampId(stampId);
      pointerArea.removeEventListener("pointermove", handlePointerMove);
      pointerArea.removeEventListener("pointerup", handlePointerUp);
      pointerArea.removeEventListener("pointercancel", cleanup);
      window.setTimeout(() => {
        suppressNextPageClickRef.current = false;
      }, didMove ? 80 : 0);
    }

    function cleanup() {
      pointerArea.removeEventListener("pointermove", handlePointerMove);
      pointerArea.removeEventListener("pointerup", handlePointerUp);
      pointerArea.removeEventListener("pointercancel", cleanup);
      window.setTimeout(() => {
        suppressNextPageClickRef.current = false;
      }, 0);
    }

    pointerArea.addEventListener("pointermove", handlePointerMove);
    pointerArea.addEventListener("pointerup", handlePointerUp);
    pointerArea.addEventListener("pointercancel", cleanup);
  }

  function handleAddStamp() {
    const createdStampId = addPageStamp(currentPageIndex, stampTextValue);
    if (createdStampId) {
      setStampDraft(stampTextValue);
    }
  }

  function handlePresetChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextText = event.target.value;
    setStampDraft(nextText);
    if (selectedStamp) {
      updatePageStamp(currentPageIndex, selectedStamp.id, { text: nextText });
    }
  }

  function handleStampTextChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextText = event.target.value;
    setStampDraft(nextText);
    if (selectedStamp) {
      updatePageStamp(currentPageIndex, selectedStamp.id, { text: nextText });
    }
  }

  if (images.length === 0) return null;

  return (
    <section className="relative rounded-panel border border-border bg-surface p-5 pt-6 shadow-soft">
      <button
        type="button"
        onClick={onClose}
        aria-label="關閉版面編輯器"
        className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink-faint transition-colors hover:bg-border hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
          <path
            d="M7 7l10 10M17 7 7 17"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="grid gap-5 lg:grid-cols-[minmax(236px,300px)_minmax(360px,1fr)_minmax(236px,300px)] xl:grid-cols-[320px_minmax(420px,1fr)_320px]">
        <div className="order-2 space-y-5 px-1 py-5 sm:px-3 lg:order-1 lg:px-6">
          <PanelTitle>版面編輯器</PanelTitle>
          <label className="block space-y-2 text-sm font-medium text-ink">
            <span>每頁版面</span>
            <SelectControl
              value={selectedPresetId}
              onChange={(event) => setSelectedPresetId(event.target.value)}
            >
              {layoutPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </SelectControl>
          </label>

          {selectedPresetId === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="列數" value={customRows} min={1} max={6} step={1} onChange={setCustomRows} />
              <NumberField label="欄數" value={customColumns} min={1} max={4} step={1} onChange={setCustomColumns} />
            </div>
          )}

          <NumberField
            label="頁面留白"
            value={marginPt}
            min={0}
            max={90}
            step={1}
            onChange={setMarginPt}
          />
          <NumberField
            label="圖片間距"
            value={gapPt}
            min={0}
            max={60}
            step={1}
            onChange={setGapPt}
          />

          <div className="grid grid-cols-2 gap-2 rounded-control bg-card p-1">
            <button
              type="button"
              onClick={() => setOrientation("portrait")}
              className={clsx(
                "h-12 rounded-control px-3 text-sm font-medium",
                orientation === "portrait" ? "bg-white text-ink shadow-soft" : "text-ink-muted"
              )}
            >
              直向
            </button>
            <button
              type="button"
              onClick={() => setOrientation("landscape")}
              className={clsx(
                "h-12 rounded-control px-3 text-sm font-medium",
                orientation === "landscape" ? "bg-white text-ink shadow-soft" : "text-ink-muted"
              )}
            >
              橫向
            </button>
          </div>
        </div>

        <div className="order-1 min-w-0 py-4 lg:order-2">
          <PageNavigation
            currentPage={currentPageIndex}
            totalPages={pages.length}
            onChangePage={changePage}
          />

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={currentPageImages.map((image) => image.id)}
              strategy={rectSortingStrategy}
            >
              <div className="flex h-[min(70vh,760px)] min-h-[420px] items-center justify-center overflow-hidden bg-card/40 p-3">
                <div
                  data-a4-page
                  onClick={() => {
                    if (suppressNextPageClickRef.current) {
                      suppressNextPageClickRef.current = false;
                      return;
                    }
                    setSelectedStampId(null);
                  }}
                  className="relative grid bg-white shadow-soft [container-type:size]"
                  style={{
                    aspectRatio: `${pageSize.width} / ${pageSize.height}`,
                    width:
                      orientation === "portrait"
                        ? "min(100%, calc(70vh * 595.28 / 841.89))"
                        : "min(100%, calc(70vh * 841.89 / 595.28))",
                    maxHeight: "100%",
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                    padding: `${(marginPt / pageSize.width) * 100}cqw`,
                    gap: `${(gapPt / pageSize.width) * 100}cqw`,
                  }}
                >
                  {Array.from({ length: imagesPerPage }).map((_, slot) => {
                    const image = currentPageImages[slot];
                    return image ? (
                      <SortablePreviewImage key={image.id} image={image} />
                    ) : (
                      <div
                        key={`empty-${currentPageIndex}-${slot}`}
                        className="rounded-control border border-dashed border-border"
                      />
                    );
                  })}

                  {(pageStamps[currentPageIndex] ?? [])
                    .slice()
                    .sort((a, b) => a.zIndex - b.zIndex)
                    .map((stamp) => (
                      <PageStampButton
                        key={stamp.id}
                        stamp={stamp}
                        pageWidth={pageSize.width}
                        selected={selectedStampId === stamp.id}
                        onPointerDown={(event) => handleStampPointerDown(event, stamp.id)}
                        onSelect={() => setSelectedStampId(stamp.id)}
                      />
                    ))}
                </div>
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div className="order-3 space-y-6 px-1 py-5 sm:px-3 lg:order-3 lg:px-6">
          <PanelTitle>文字印章</PanelTitle>
          <div>
            <div className="grid grid-cols-[minmax(0,1fr)_64px] gap-3">
              <SelectControl
                value={presetSelectValue}
                onChange={handlePresetChange}
                controlClassName="pl-5 pr-10"
                iconClassName="right-4 h-4 w-4"
              >
                <option value="" disabled>
                  選擇常用印章
                </option>
                {stampPresets.map((preset) => (
                  <option key={preset.id} value={preset.text}>
                    {preset.label}
                  </option>
                ))}
              </SelectControl>
              <button
                type="button"
                onClick={handleAddStamp}
                className="h-12 rounded-control bg-accent-soft px-3 text-sm font-medium text-ink transition-opacity hover:opacity-80"
              >
                新增
              </button>
            </div>
          </div>

          <label className="block">
            <textarea
              value={stampTextValue}
              onChange={handleStampTextChange}
              rows={3}
              className="max-h-[112px] min-h-[92px] w-full resize-y rounded-control border border-border bg-white px-5 py-4 text-sm font-medium leading-relaxed text-ink"
            />
          </label>

          {selectedStamp && (
            <StampEditor
              stamp={selectedStamp}
              onUpdate={(patch) =>
                updatePageStamp(currentPageIndex, selectedStamp.id, patch)
              }
              onCopy={() => copyPageStamp(currentPageIndex, selectedStamp.id)}
              onRemove={() => removePageStamp(currentPageIndex, selectedStamp.id)}
              onMoveForward={() =>
                movePageStampLayer(currentPageIndex, selectedStamp.id, "forward")
              }
              onMoveBackward={() =>
                movePageStampLayer(currentPageIndex, selectedStamp.id, "backward")
              }
            />
          )}
        </div>
      </div>
    </section>
  );
}

function PageNavigation({
  currentPage,
  totalPages,
  onChangePage,
}: {
  currentPage: number;
  totalPages: number;
  onChangePage: (pageIndex: number) => void;
}) {
  const isFirst = currentPage === 0;
  const isLast = currentPage === totalPages - 1;

  return (
    <div className="mb-3 flex items-center justify-center gap-1">
      <PageButton
        label="第一頁"
        disabled={isFirst}
        onClick={() => onChangePage(0)}
        icon="first"
      />
      <PageButton
        label="上一頁"
        disabled={isFirst}
        onClick={() => onChangePage(currentPage - 1)}
        icon="previous"
      />
      <span className="min-w-20 text-center text-sm font-semibold text-ink">
        {currentPage + 1} / {totalPages}
      </span>
      <PageButton
        label="下一頁"
        disabled={isLast}
        onClick={() => onChangePage(currentPage + 1)}
        icon="next"
      />
      <PageButton
        label="最後一頁"
        disabled={isLast}
        onClick={() => onChangePage(totalPages - 1)}
        icon="last"
      />
    </div>
  );
}

function PanelTitle({ children }: { children: string }) {
  return (
    <div className="border-b border-border pb-3">
      <h3 className="font-serif-zh text-base font-normal tracking-[0.08em] text-ink sm:text-lg">
        {children}
      </h3>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="block text-sm font-medium tracking-[0.04em] text-ink">
      {children}
    </span>
  );
}

function SelectControl({
  value,
  onChange,
  children,
  controlClassName,
  iconClassName,
}: {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  controlClassName?: string;
  iconClassName?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={onChange}
        className={clsx(
          "h-12 w-full appearance-none rounded-control border border-border bg-white py-0 pl-4 pr-12 text-sm text-ink",
          controlClassName
        )}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        className={clsx(
          "pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#dbdbdb]",
          iconClassName
        )}
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M7 10l5 5 5-5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  icon: "first" | "previous" | "next" | "last";
}) {
  const isBack = icon === "first" || icon === "previous";
  const hasBar = icon === "first" || icon === "last";

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-control text-[#dbdbdb] transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        {hasBar && (
          <path
            d={isBack ? "M6 5v14" : "M18 5v14"}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        )}
        <path
          d={isBack ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function PageStampButton({
  stamp,
  pageWidth,
  selected,
  onPointerDown,
  onSelect,
}: {
  stamp: PdfPageStamp;
  pageWidth: number;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerDown={onPointerDown}
      className={clsx(
        "absolute whitespace-pre border px-1 text-center leading-[1.25]",
        selected ? "border-accent/60 bg-white/20 shadow-soft" : "border-transparent"
      )}
      style={{
        left: `${stamp.x * 100}%`,
        top: `${stamp.y * 100}%`,
        color: stamp.color,
        opacity: stamp.opacity,
        fontSize: `${(stamp.fontSize / pageWidth) * 100}cqw`,
        fontWeight: stamp.bold ? 700 : 400,
        transform: `translate(-50%, -50%) rotate(${stamp.rotation}deg) scale(${stamp.scale})`,
        transformOrigin: "center",
        zIndex: 30 + stamp.zIndex,
      }}
      title="拖曳文字印章"
    >
      {stamp.text}
    </button>
  );
}

function StampEditor({
  stamp,
  onUpdate,
  onCopy,
  onRemove,
  onMoveForward,
  onMoveBackward,
}: {
  stamp: PdfPageStamp;
  onUpdate: (patch: Partial<PdfPageStamp>) => void;
  onCopy: () => void;
  onRemove: () => void;
  onMoveForward: () => void;
  onMoveBackward: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="rounded-card bg-card px-3 py-5">
          <div className="mx-auto grid w-full max-w-[280px] grid-cols-2 grid-rows-2 gap-x-4 gap-y-4">
            <CompactNumberField
              label="旋轉"
              value={stamp.rotation}
              min={-180}
              max={180}
              step={1}
              onChange={(value) => onUpdate({ rotation: value })}
            />
            <CompactNumberField
              label="縮放"
              value={stamp.scale}
              min={0.2}
              max={4}
              step={0.1}
              onChange={(value) => onUpdate({ scale: value })}
            />
            <CompactNumberField
              label="透明"
              value={Math.round(stamp.opacity * 100)}
              min={0}
              max={100}
              step={1}
              onChange={(value) => onUpdate({ opacity: clampNumber(value, 0, 100) / 100 })}
            />
            <CompactNumberField
              label="大小"
              value={stamp.fontSize}
              min={8}
              max={96}
              step={1}
              onChange={(value) => onUpdate({ fontSize: value })}
            />
          </div>

          <div className="mx-auto mt-6 grid h-12 w-full max-w-[280px] grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center gap-x-4 text-sm font-medium text-ink">
            <label className="flex min-w-0 items-center justify-center gap-2">
              <span className="whitespace-nowrap">文字顏色</span>
              <input
                type="color"
                value={stamp.color}
                onChange={(event) => onUpdate({ color: event.target.value })}
                className="stamp-color-input h-6 w-6 cursor-pointer rounded-none border border-border bg-transparent"
              />
            </label>
            <div className="h-6 w-px bg-border" aria-hidden="true" />
            <label className="flex min-w-0 cursor-pointer items-center justify-center gap-2">
              <span className="whitespace-nowrap">粗體</span>
              <input
                type="checkbox"
                checked={stamp.bold}
                onChange={(event) => onUpdate({ bold: event.target.checked })}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-none border border-ink bg-white text-transparent peer-checked:text-ink-muted"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                  <path
                    d="M5 12.5l4 4L19 6.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <SectionLabel>操作</SectionLabel>
        <div className="grid grid-cols-4 gap-3">
          <button
            type="button"
            onClick={onMoveForward}
            aria-label="上層"
            className="flex h-12 items-center justify-center rounded-control bg-accent-soft text-ink transition-opacity hover:opacity-80"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path
                d="M5 15 12 8l7 7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onMoveBackward}
            aria-label="下層"
            className="flex h-12 items-center justify-center rounded-control bg-accent-soft text-ink transition-opacity hover:opacity-80"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path
                d="m5 9 7 7 7-7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="button" onClick={onCopy} className="h-12 rounded-control bg-accent-soft px-2 text-sm font-medium text-accent transition-opacity hover:opacity-80">
            複製
          </button>
          <button type="button" onClick={onRemove} className="h-12 rounded-control border border-danger/30 bg-white px-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5">
            刪除
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const inputId = useId();

  return (
    <div className="block space-y-1.5 text-sm font-medium text-ink">
      <label htmlFor={inputId}>{label}</label>
      <NumberStepper
        id={inputId}
        ariaLabel={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        inputClassName="h-12 px-3 pr-10 text-left text-sm"
        buttonClassName="right-4"
      />
    </div>
  );
}

function CompactNumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const inputId = useId();

  return (
    <div className="grid h-12 min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-2 text-sm font-medium text-ink-muted">
      <label
        htmlFor={inputId}
        className="flex h-12 w-9 shrink-0 items-center justify-center text-center leading-[1.35]"
      >
        <span className="flex flex-col items-center justify-center leading-[1.35]">
          {label.split("").map((character) => (
            <span key={character} className="block">
              {character}
            </span>
          ))}
        </span>
      </label>
      <NumberStepper
        id={inputId}
        ariaLabel={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        inputClassName="h-12 min-w-0 px-3 pr-8 text-left text-sm"
        buttonClassName="right-2"
      />
    </div>
  );
}

function NumberStepper({
  id,
  ariaLabel,
  value,
  min,
  max,
  step,
  onChange,
  inputClassName,
  buttonClassName,
}: {
  id: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  inputClassName: string;
  buttonClassName: string;
}) {
  function handleStep(direction: -1 | 1) {
    onChange(stepNumberValue(value, direction, min, max, step));
  }

  return (
    <span className="relative block h-12 min-w-0">
      <input
        id={id}
        type="number"
        aria-label={ariaLabel}
        value={formatNumberValue(value)}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
        className={clsx(
          "number-input-native w-full rounded-control border border-border bg-white text-ink shadow-none",
          inputClassName
        )}
      />
      <span
        className={clsx(
          "absolute top-1/2 flex w-6 -translate-y-1/2 flex-col items-center justify-center overflow-hidden text-[#dbdbdb]",
          buttonClassName
        )}
      >
        <button
          type="button"
          aria-label="增加數值"
          onClick={() => handleStep(1)}
          disabled={value >= max}
          className="flex h-3.5 w-6 items-center justify-center disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg viewBox="0 0 12 8" className="h-2 w-2.5" aria-hidden="true">
            <path d="M6 1 1.5 6.5h9L6 1Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="減少數值"
          onClick={() => handleStep(-1)}
          disabled={value <= min}
          className="flex h-3.5 w-6 items-center justify-center disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg viewBox="0 0 12 8" className="h-2 w-2.5" aria-hidden="true">
            <path d="M6 7 1.5 1.5h9L6 7Z" fill="currentColor" />
          </svg>
        </button>
      </span>
    </span>
  );
}
