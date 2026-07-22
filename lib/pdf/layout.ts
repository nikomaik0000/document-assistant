import type { PageCellRect, PdfLayoutOptions } from "./types";

/** A4，單位為 pt（72 pt = 1 inch），與 pdf-lib 的座標系一致 */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

export const DEFAULT_MARGIN_PT = 36; // 0.5 inch 四周留白
export const DEFAULT_GAP_PT = 16; // 同一頁多張圖片之間的間距

/**
 * 依照圖片總數決定每頁放幾張：
 * - 只有 1 張時，整頁只放這 1 張（版面最大）
 * - 2 張以上時，每頁固定放 2 張（上下排列），對應原始需求預設的「一頁兩張」
 *
 * 這是刻意簡化過的自動排版規則（不做使用者可調整的 1/2/4 張選項），
 * 之後如果需要更精細的排版控制，可以在這個函式基礎上擴充。
 */
export function decideImagesPerPage(totalImageCount: number): number {
  return totalImageCount <= 1 ? 1 : 2;
}

/**
 * 計算固定 N 宮格（上下排列）在 A4 頁面上的每一格範圍。
 * 回傳的座標是 pdf-lib 使用的「原點在左下角」座標系。
 * 格數固定：最後一頁圖片不足時，剩餘的格子留白（呼叫端只需不畫圖即可）。
 */
export function computeCellRects(imagesPerPage: number): PageCellRect[] {
  return computeLayoutCellRects({
    imagesPerPage,
    rows: imagesPerPage,
    columns: 1,
    marginPt: DEFAULT_MARGIN_PT,
    gapPt: DEFAULT_GAP_PT,
    orientation: "portrait",
  });
}

export function getPageSize(options: PdfLayoutOptions): [number, number] {
  return options.orientation === "landscape"
    ? [A4_HEIGHT_PT, A4_WIDTH_PT]
    : [A4_WIDTH_PT, A4_HEIGHT_PT];
}

export function computeLayoutCellRects(options: PdfLayoutOptions): PageCellRect[] {
  const [pageWidth, pageHeight] = getPageSize(options);
  const contentWidth = pageWidth - options.marginPt * 2;
  const contentHeight = pageHeight - options.marginPt * 2;
  const cellWidth =
    (contentWidth - options.gapPt * (options.columns - 1)) / options.columns;
  const cellHeight =
    (contentHeight - options.gapPt * (options.rows - 1)) / options.rows;

  const cells: PageCellRect[] = [];
  for (let i = 0; i < options.imagesPerPage; i++) {
    const row = Math.floor(i / options.columns);
    const column = i % options.columns;
    const x = options.marginPt + column * (cellWidth + options.gapPt);
    const yFromBottom =
      options.marginPt +
      (options.rows - 1 - row) * (cellHeight + options.gapPt);
    cells.push({ x, yFromBottom, width: cellWidth, height: cellHeight });
  }
  return cells;
}

/**
 * 在指定的格子範圍內，計算保持長寬比、置中、不裁切的實際繪製區域。
 */
export function fitContain(
  cell: PageCellRect,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(cell.width / imageWidth, cell.height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  return {
    x: cell.x + (cell.width - drawWidth) / 2,
    y: cell.yFromBottom + (cell.height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}
