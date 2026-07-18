/**
 * 純 OpenCV.js 自行實作的文件偵測與透視校正。
 *
 * 為什麼不用 jscanify 了：
 * jscanify 的角點演算法（getCornerPoints）不會驗證輪廓是不是四邊形，
 * 只是抓「離輪廓中心最遠的象限點」當作四個角。這在背景複雜、文件形狀不規則
 * （例如便利貼）時很容易抓錯角，校正後嚴重變形；而且它的 Canny 閾值固定、
 * 沒有重試機制，遇到光線好但反差不夠強烈的照片反而容易偵測失敗。
 * 這兩個問題調參數效益有限，改為自己實作整條流程，才能真正控制每個環節
 * （前處理、輪廓篩選、四邊形驗證、角點排序、重試策略）。
 *
 * 演算法流程：
 * 1. 縮小圖片到固定最大邊長（加速運算、讓參數不受手機照片解析度影響）
 * 2. 灰階 → 高斯模糊
 * 3. 依序嘗試多組邊緣/二值化參數（重試策略，見 ATTEMPTS）：
 *    - Canny（較嚴格閾值）
 *    - Canny（較寬鬆閾值，第一次失敗時嘗試）
 *    - Adaptive Threshold（處理光線不均、有陰影的情況）
 *    每組都先做 morphology close 補齊邊緣缺口，避免文件邊界因為輕微陰影
 *    或反光而斷裂成好幾段輪廓
 * 4. findContours 找出所有輪廓，依面積過濾掉太小（雜訊）或太大（幾乎等於
 *    整張照片，代表沒抓到真正邊界）的候選
 * 5. 對面積最大的幾個候選依序嘗試不同 epsilon 做 approxPolyDP，
 *    找出第一個「四個頂點、凸多邊形」的結果 —— 這一步取代 jscanify
 *    的簡化 minAreaRect 做法，是真正驗證「這是不是一個四邊形」
 * 6. 用 sum/diff 排序法決定四個角的左上/右上/左下/右下（不受輪廓點順序影響）
 * 7. 座標縮放回原始解析度，用 getPerspectiveTransform + warpPerspective 校正
 * 8. 幾何啟發式自動旋轉（寬 > 高則轉為直式）
 */
import { getOpenCv } from "./opencvLoader";
import type { Corners, ScanResult } from "./types";

const NOT_DETECTED_MESSAGE = "無法辨識文件，已使用原圖。";

/** 偵測用的縮圖最大邊長；校正時仍使用原始解析度，只有偵測階段用縮圖加速 */
const DETECTION_MAX_DIMENSION = 1000;

/** 候選輪廓面積佔縮圖總面積的合理範圍，過濾雜訊與「整張照片邊框」 */
const MIN_CONTOUR_AREA_RATIO = 0.1;
const MAX_CONTOUR_AREA_RATIO = 0.98;

/** approxPolyDP 嘗試的 epsilon（乘上輪廓周長），由嚴格到寬鬆 */
const APPROX_EPSILON_RATIOS = [0.02, 0.01, 0.03, 0.05, 0.08];

/** 每個候選最多嘗試幾個面積最大的輪廓 */
const MAX_CANDIDATE_CONTOURS = 6;

type Point = { x: number; y: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvNamespace = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvMat = any;

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片解碼失敗（可能是不支援的格式）"));
    img.src = url;
  });
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeOutputSize(corners: Corners): { width: number; height: number } {
  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = corners;
  const topWidth = distance(topLeftCorner, topRightCorner);
  const bottomWidth = distance(bottomLeftCorner, bottomRightCorner);
  const leftHeight = distance(topLeftCorner, bottomLeftCorner);
  const rightHeight = distance(topRightCorner, bottomRightCorner);
  return {
    width: Math.round(Math.max(topWidth, bottomWidth)),
    height: Math.round(Math.max(leftHeight, rightHeight)),
  };
}

/** 鞋帶公式計算四邊形面積 */
function quadrilateralArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % points.length]!;
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area) / 2;
}

/**
 * sum/diff 排序法決定四個角，不受輪廓點原本的順序影響：
 * - 左上角：x+y 最小
 * - 右下角：x+y 最大
 * - 右上角：x-y 最大
 * - 左下角：x-y 最小
 */
function orderCorners(points: Point[]): Corners | null {
  if (points.length !== 4) return null;

  let topLeft = points[0]!;
  let bottomRight = points[0]!;
  let topRight = points[0]!;
  let bottomLeft = points[0]!;
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  for (const p of points) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < minSum) {
      minSum = sum;
      topLeft = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      bottomRight = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      topRight = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bottomLeft = p;
    }
  }

  // 四個角必須是四個不同的點，否則代表偵測到的形狀太退化（例如一條線）
  const distinct = new Set([topLeft, topRight, bottomLeft, bottomRight]);
  if (distinct.size !== 4) return null;

  return {
    topLeftCorner: topLeft,
    topRightCorner: topRight,
    bottomLeftCorner: bottomLeft,
    bottomRightCorner: bottomRight,
  };
}

function matToPoints(mat: CvMat): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < mat.rows; i++) {
    points.push({ x: mat.data32S[i * 2], y: mat.data32S[i * 2 + 1] });
  }
  return points;
}

/** 每種前處理方式回傳一個二值化／邊緣 Mat，呼叫端負責 delete */
function buildEdgeAttempts(
  cv: CvNamespace,
  blurred: CvMat
): { name: string; run: () => CvMat }[] {
  return [
    {
      name: "canny-strict",
      run: () => {
        const edges = new cv.Mat();
        cv.Canny(blurred, edges, 60, 180);
        return edges;
      },
    },
    {
      name: "canny-relaxed",
      run: () => {
        const edges = new cv.Mat();
        cv.Canny(blurred, edges, 25, 90);
        return edges;
      },
    },
    {
      name: "adaptive-threshold",
      run: () => {
        const thresh = new cv.Mat();
        cv.adaptiveThreshold(
          blurred,
          thresh,
          255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY_INV,
          25,
          10
        );
        return thresh;
      },
    },
  ];
}

/**
 * 在縮圖座標系上尋找文件四邊形。找不到就回傳 null（呼叫端會視為偵測失敗，
 * 不會強行湊出一個不合理的結果）。
 */
function findDocumentQuad(cv: CvNamespace, detectMat: CvMat): Point[] | null {
  const gray = new cv.Mat();
  cv.cvtColor(detectMat, gray, cv.COLOR_RGBA2GRAY);
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
  gray.delete();

  const imageArea = detectMat.cols * detectMat.rows;
  const minArea = imageArea * MIN_CONTOUR_AREA_RATIO;
  const maxArea = imageArea * MAX_CONTOUR_AREA_RATIO;
  const closeKernel = cv.Mat.ones(5, 5, cv.CV_8U);

  let result: Point[] | null = null;

  for (const attempt of buildEdgeAttempts(cv, blurred)) {
    const edges = attempt.run();
    const closed = new cv.Mat();
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, closeKernel);
    edges.delete();

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(
      closed,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );
    closed.delete();
    hierarchy.delete();

    const candidates: { contour: CvMat; area: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area >= minArea && area <= maxArea) {
        candidates.push({ contour, area });
      } else {
        contour.delete();
      }
    }
    contours.delete();
    candidates.sort((a, b) => b.area - a.area);

    for (const { contour } of candidates.slice(0, MAX_CANDIDATE_CONTOURS)) {
      if (result) {
        contour.delete();
        continue;
      }
      const perimeter = cv.arcLength(contour, true);
      for (const epsilonRatio of APPROX_EPSILON_RATIOS) {
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, epsilonRatio * perimeter, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const points = matToPoints(approx);
          approx.delete();
          const area = quadrilateralArea(points);
          if (area >= minArea && area <= maxArea) {
            result = points;
          }
          break;
        }
        approx.delete();
      }
      contour.delete();
    }

    if (result) break;
  }

  closeKernel.delete();
  blurred.delete();
  return result;
}

function autoRotateToPortrait(canvas: HTMLCanvasElement): HTMLCanvasElement {
  if (canvas.width <= canvas.height) return canvas;

  const rotated = document.createElement("canvas");
  rotated.width = canvas.height;
  rotated.height = canvas.width;
  const ctx = rotated.getContext("2d");
  if (!ctx) return canvas;

  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return rotated;
}

function warpPerspective(
  cv: CvNamespace,
  src: CvMat,
  corners: Corners,
  width: number,
  height: number
): HTMLCanvasElement {
  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = corners;

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    topLeftCorner.x, topLeftCorner.y,
    topRightCorner.x, topRightCorner.y,
    bottomRightCorner.x, bottomRightCorner.y,
    bottomLeftCorner.x, bottomLeftCorner.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    width, 0,
    width, height,
    0, height,
  ]);

  const transform = cv.getPerspectiveTransform(srcTri, dstTri);
  const dst = new cv.Mat();
  cv.warpPerspective(
    src,
    dst,
    transform,
    new cv.Size(width, height),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar()
  );

  const canvas = document.createElement("canvas");
  cv.imshow(canvas, dst);

  srcTri.delete();
  dstTri.delete();
  transform.delete();
  dst.delete();

  return canvas;
}

export async function correctDocument(imageUrl: string): Promise<ScanResult> {
  let img: HTMLImageElement;
  try {
    img = await loadImageElement(imageUrl);
  } catch {
    return { kind: "error", message: NOT_DETECTED_MESSAGE };
  }

  let src: CvMat | null = null;
  let detectMat: CvMat | null = null;

  try {
    const cv = await getOpenCv();

    src = cv.imread(img);

    const scale = Math.min(
      1,
      DETECTION_MAX_DIMENSION / Math.max(src.cols, src.rows)
    );
    if (scale < 1) {
      detectMat = new cv.Mat();
      cv.resize(
        src,
        detectMat,
        new cv.Size(Math.round(src.cols * scale), Math.round(src.rows * scale)),
        0,
        0,
        cv.INTER_AREA
      );
    } else {
      detectMat = src;
    }

    const quadInDetectSpace = findDocumentQuad(cv, detectMat);
    if (detectMat !== src) detectMat.delete();

    if (!quadInDetectSpace) {
      return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
    }

    const quadInFullRes = quadInDetectSpace.map((p) => ({
      x: p.x / scale,
      y: p.y / scale,
    }));

    const corners = orderCorners(quadInFullRes);
    if (!corners) {
      return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
    }

    const { width, height } = computeOutputSize(corners);
    if (width < 10 || height < 10) {
      return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
    }

    const canvas = warpPerspective(cv, src, corners, width, height);
    const rotated = autoRotateToPortrait(canvas);

    return { kind: "corrected", canvas: rotated, corners };
  } catch (error) {
    console.error("[documentScanner] 校正失敗", error);
    return { kind: "error", message: NOT_DETECTED_MESSAGE };
  } finally {
    src?.delete();
  }
}
