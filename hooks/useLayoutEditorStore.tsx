"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { exportImagesToA4Pdf, generatePdfFileName, type PdfLayoutOptions, type PdfPageStamp } from "@/lib/pdf";
import { triggerBlobDownload } from "@/lib/download";
import type { DocumentImage } from "@/types/image";

export interface LayoutPreset {
  id: string;
  label: string;
  imagesPerPage: number;
  rows: number;
  columns: number;
}

export const layoutPresets: LayoutPreset[] = [
  { id: "one", label: "1 張", imagesPerPage: 1, rows: 1, columns: 1 },
  { id: "two-vertical", label: "2 張上下", imagesPerPage: 2, rows: 2, columns: 1 },
  { id: "two-horizontal", label: "2 張左右", imagesPerPage: 2, rows: 1, columns: 2 },
  { id: "four", label: "4 張", imagesPerPage: 4, rows: 2, columns: 2 },
  { id: "six", label: "6 張", imagesPerPage: 6, rows: 3, columns: 2 },
  { id: "eight", label: "8 張", imagesPerPage: 8, rows: 4, columns: 2 },
  { id: "custom", label: "自訂", imagesPerPage: 6, rows: 3, columns: 2 },
];

export type PageStamps = Record<number, PdfPageStamp[]>;

interface LayoutEditorContextValue {
  selectedPresetId: string;
  setSelectedPresetId: (id: string) => void;
  customRows: number;
  setCustomRows: (rows: number) => void;
  customColumns: number;
  setCustomColumns: (columns: number) => void;
  marginPt: number;
  setMarginPt: (margin: number) => void;
  gapPt: number;
  setGapPt: (gap: number) => void;
  orientation: "portrait" | "landscape";
  setOrientation: (orientation: "portrait" | "landscape") => void;
  selectedPageIndex: number;
  setSelectedPageIndex: (pageIndex: number) => void;
  selectedStampId: string | null;
  setSelectedStampId: (stampId: string | null) => void;
  pageStamps: PageStamps;
  layoutOptions: PdfLayoutOptions;
  selectedPreset: LayoutPreset;
  addPageStamp: (pageIndex: number, text: string) => string | null;
  updatePageStamp: (pageIndex: number, stampId: string, patch: Partial<PdfPageStamp>) => void;
  removePageStamp: (pageIndex: number, stampId: string) => void;
  copyPageStamp: (pageIndex: number, stampId: string) => void;
  movePageStampLayer: (pageIndex: number, stampId: string, direction: "forward" | "backward") => void;
  exportPdf: (images: DocumentImage[]) => Promise<void>;
}

const LayoutEditorContext = createContext<LayoutEditorContextValue | null>(null);

function getImageUrl(image: DocumentImage): string {
  return image.status === "corrected" && image.correctedUrl
    ? image.correctedUrl
    : image.originalUrl;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeLayer(stamps: PdfPageStamp[]): PdfPageStamp[] {
  return stamps
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((stamp, index) => ({ ...stamp, zIndex: index }));
}

export function LayoutEditorProvider({ children }: { children: ReactNode }) {
  const [selectedPresetId, setSelectedPresetId] = useState("two-vertical");
  const [customRows, setCustomRowsState] = useState(3);
  const [customColumns, setCustomColumnsState] = useState(2);
  const [marginPt, setMarginPtState] = useState(36);
  const [gapPt, setGapPtState] = useState(16);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [selectedStampId, setSelectedStampId] = useState<string | null>(null);
  const [pageStamps, setPageStamps] = useState<PageStamps>({});

  const selectedPreset =
    layoutPresets.find((preset) => preset.id === selectedPresetId) ?? layoutPresets[1]!;
  const rows = selectedPreset.id === "custom" ? customRows : selectedPreset.rows;
  const columns = selectedPreset.id === "custom" ? customColumns : selectedPreset.columns;
  const imagesPerPage =
    selectedPreset.id === "custom" ? rows * columns : selectedPreset.imagesPerPage;

  const layoutOptions = useMemo<PdfLayoutOptions>(
    () => ({
      imagesPerPage,
      rows,
      columns,
      marginPt,
      gapPt,
      orientation,
    }),
    [columns, gapPt, imagesPerPage, marginPt, orientation, rows]
  );

  const setCustomRows = useCallback((value: number) => {
    setCustomRowsState(clampInt(value, 1, 6));
  }, []);

  const setCustomColumns = useCallback((value: number) => {
    setCustomColumnsState(clampInt(value, 1, 4));
  }, []);

  const setMarginPt = useCallback((value: number) => {
    setMarginPtState(clampInt(value, 0, 90));
  }, []);

  const setGapPt = useCallback((value: number) => {
    setGapPtState(clampInt(value, 0, 60));
  }, []);

  const addPageStamp = useCallback((pageIndex: number, text: string) => {
    if (!text.trim()) return null;
    const stamp: PdfPageStamp = {
      id: crypto.randomUUID(),
      text,
      x: 0.5,
      y: 0.5,
      rotation: 0,
      scale: 1,
      opacity: 0.65,
      fontSize: 18,
      color: "#B3554A",
      bold: true,
      zIndex: pageStamps[pageIndex]?.length ?? 0,
    };
    setPageStamps((current) => ({
      ...current,
      [pageIndex]: normalizeLayer([...(current[pageIndex] ?? []), stamp]),
    }));
    setSelectedPageIndex(pageIndex);
    setSelectedStampId(stamp.id);
    return stamp.id;
  }, [pageStamps]);

  const updatePageStamp = useCallback(
    (pageIndex: number, stampId: string, patch: Partial<PdfPageStamp>) => {
      setPageStamps((current) => ({
        ...current,
        [pageIndex]: normalizeLayer(
          (current[pageIndex] ?? []).map((stamp) =>
            stamp.id === stampId ? { ...stamp, ...patch } : stamp
          )
        ),
      }));
    },
    []
  );

  const removePageStamp = useCallback((pageIndex: number, stampId: string) => {
    setPageStamps((current) => ({
      ...current,
      [pageIndex]: normalizeLayer(
        (current[pageIndex] ?? []).filter((stamp) => stamp.id !== stampId)
      ),
    }));
    setSelectedStampId(null);
  }, []);

  const copyPageStamp = useCallback((pageIndex: number, stampId: string) => {
    setPageStamps((current) => {
      const stamps = current[pageIndex] ?? [];
      const source = stamps.find((stamp) => stamp.id === stampId);
      if (!source) return current;
      const copy: PdfPageStamp = {
        ...source,
        id: crypto.randomUUID(),
        x: Math.min(0.95, source.x + 0.04),
        y: Math.min(0.95, source.y + 0.04),
        zIndex: stamps.length,
      };
      setSelectedStampId(copy.id);
      return {
        ...current,
        [pageIndex]: normalizeLayer([...stamps, copy]),
      };
    });
  }, []);

  const movePageStampLayer = useCallback(
    (pageIndex: number, stampId: string, direction: "forward" | "backward") => {
      setPageStamps((current) => {
        const stamps = normalizeLayer(current[pageIndex] ?? []);
        const index = stamps.findIndex((stamp) => stamp.id === stampId);
        if (index === -1) return current;
        const targetIndex = direction === "forward" ? index + 1 : index - 1;
        if (targetIndex < 0 || targetIndex >= stamps.length) return current;
        const reordered = stamps.slice();
        [reordered[index], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[index]!];
        return {
          ...current,
          [pageIndex]: normalizeLayer(reordered),
        };
      });
    },
    []
  );

  const exportPdf = useCallback(
    async (images: DocumentImage[]) => {
      const sourceImages = images.map((image) => ({ url: getImageUrl(image) }));
      const blob = await exportImagesToA4Pdf(sourceImages, layoutOptions, pageStamps);
      triggerBlobDownload(blob, generatePdfFileName());
    },
    [layoutOptions, pageStamps]
  );

  const value = useMemo(
    () => ({
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
      selectedPreset,
      addPageStamp,
      updatePageStamp,
      removePageStamp,
      copyPageStamp,
      movePageStampLayer,
      exportPdf,
    }),
    [
      selectedPresetId,
      customRows,
      setCustomRows,
      customColumns,
      setCustomColumns,
      marginPt,
      setMarginPt,
      gapPt,
      setGapPt,
      orientation,
      selectedPageIndex,
      selectedStampId,
      pageStamps,
      layoutOptions,
      selectedPreset,
      addPageStamp,
      updatePageStamp,
      removePageStamp,
      copyPageStamp,
      movePageStampLayer,
      exportPdf,
    ]
  );

  return (
    <LayoutEditorContext.Provider value={value}>
      {children}
    </LayoutEditorContext.Provider>
  );
}

export function useLayoutEditorStore(): LayoutEditorContextValue {
  const context = useContext(LayoutEditorContext);
  if (!context) {
    throw new Error("useLayoutEditorStore 必須在 LayoutEditorProvider 內使用");
  }
  return context;
}
