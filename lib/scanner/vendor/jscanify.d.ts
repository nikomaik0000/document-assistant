/**
 * 型別宣告，對應同目錄下 vendored 的 jscanify.js（原套件無官方型別定義）。
 */

interface JscanifyCorners {
  topLeftCorner: { x: number; y: number };
  topRightCorner: { x: number; y: number };
  bottomLeftCorner: { x: number; y: number };
  bottomRightCorner: { x: number; y: number };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvMat = any;
type JscanifyImage = HTMLImageElement | HTMLCanvasElement;

declare class jscanify {
  constructor();
  findPaperContour(img: CvMat): CvMat;
  getCornerPoints(contour: CvMat): JscanifyCorners;
  highlightPaper(
    image: JscanifyImage,
    options?: { color?: string; thickness?: number }
  ): HTMLCanvasElement;
  extractPaper(
    image: JscanifyImage,
    resultWidth: number,
    resultHeight: number,
    cornerPoints?: JscanifyCorners
  ): HTMLCanvasElement | null;
}

export default jscanify;
