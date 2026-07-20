/**
 * 純 OpenCV.js 自行實作的文件偵測與透視校正。
 *
 * 為什麼不用 jscanify：見 git log 中「文件偵測演算法重寫」的說明——它的角點
 * 演算法不驗證輪廓是否為四邊形，背景複雜或反差不夠時都不穩定。
 *
 * 這一版（Phase 2A）的改動：不再是「用第一種前處理方式找到符合條件的四邊形
 * 就直接採用」，而是把每種前處理方式找到的候選四邊形全部收集起來，
 * 用評分機制挑出最合理的一個。原因：不同照片適合的前處理方式不同
 * （例如深色背景適合 Canny，文件與背景顏色接近時 adaptiveThreshold 或
 * Otsu 表現更好），先找到的不一定是最好的，光「找到一個四邊形」不代表
 * 它就是正確的文件邊界。
 *
 * 演算法流程：
 * 1. 縮小圖片到固定最大邊長（加速運算、讓參數不受手機照片解析度影響）
 * 2. 灰階 → 高斯模糊
 * 3. 六種前處理方式各自找輪廓（見 buildPreprocessAttempts）：
 *    - Canny 嚴格閾值 / 寬鬆閾值 / 更寬鬆閾值（處理不同對比度）
 *    - Adaptive Threshold（處理光線不均、有陰影）
 *    - Otsu Threshold（處理文件與背景顏色接近、全域對比尚可的情況）
 *    - CLAHE（局部對比度增強）+ Canny（處理全域對比度不足、光線平淡的照片，
 *      例如淺色文件放在淺色桌面上，直接用原圖跑 Canny 常常完全找不到邊緣）
 *    每種都做 morphology close（補齊邊緣缺口）+ open（去除細小雜訊）
 * 4. 每種方式都用面積過濾候選輪廓、對面積最大的幾個嘗試多組 epsilon 做
 *    approxPolyDP，收集所有「四頂點、凸多邊形」的候選（不是找到就停）
 * 5. 對收集到的所有候選評分（見 scoreCandidate），依：
 *    - 是否接近四邊形（凸多邊形，已在收集階段過濾）
 *    - 面積是否合理（相對整張照片的比例）
 *    - 長寬比是否合理（排除異常細長的結果）
 *    - 四個角的內角是否接近 90 度（角度偏差越小分數越高，避免嚴重變形）
 *    - 前處理方式的可信度（Canny 嚴格 > 寬鬆 > Otsu ≈ Adaptive > 更寬鬆）
 *    - epsilon 是否夠小（越不需要簡化，代表輪廓本身越乾淨）
 *    取分數最高的當作最終結果
 * 6. sum/diff 排序法決定四個角的左上/右上/左下/右下
 * 7. 座標縮放回原始解析度，getPerspectiveTransform + warpPerspective 校正
 * 8. 直接輸出校正結果，保留文件原始方向（不強制轉成直式）：warpPerspective
 *    的輸出寬高就是依四個角點算出來的實際比例，寬 > 高就是橫式（例如身分證、
 *    健保卡、名片這類橫式證件／卡片），高 > 寬就是直式（例如 A4 文件、收據），
 *    不會為了配合 A4 的直式版面而把橫式文件硬轉成直式——這類卡片被強制轉向
 *    反而會讓上面的文字方向不對、OCR 幾乎無法辨識
 *
 * 任何一步找不到合理結果都不會拋錯，只會回傳 not-detected，
 * 呼叫端會 fallback 使用原圖，畫面不會中斷。
 */
import { getOpenCv } from "./opencvLoader";
import type { Corners, ScanResult } from "./types";

const NOT_DETECTED_MESSAGE = "無法辨識文件，已使用原圖。";

/** 偵測用的縮圖最大邊長；校正時仍使用原始解析度，只有偵測階段用縮圖加速 */
const DETECTION_MAX_DIMENSION = 1000;

/** 候選輪廓面積佔縮圖總面積的合理範圍，過濾雜訊與「整張照片邊框」 */
const MIN_CONTOUR_AREA_RATIO = 0.05;
const MAX_CONTOUR_AREA_RATIO = 0.92;

/** 長寬比超過這個倍數視為異常（例如誤判成一條窄帶），直接排除 */
const MAX_ASPECT_RATIO = 6;

/** 四個角的內角與 90 度的最大容許偏差，超過視為過度變形，直接排除 */
const MAX_ANGLE_DEVIATION_DEGREES = 40;

/** approxPolyDP 嘗試的 epsilon（乘上輪廓周長），由嚴格到寬鬆 */
const APPROX_EPSILON_RATIOS = [0.02, 0.01, 0.015, 0.03, 0.05, 0.08];

/** 每種前處理方式最多收集幾個面積最大的候選輪廓來嘗試 approxPolyDP */
const MAX_CANDIDATE_CONTOURS = 6;

type Point = { x: number; y: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvNamespace = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvMat = any;

interface QuadCandidate {
  points: Point[];
  method: string;
  methodPriority: number;
  epsilonRank: number;
}

interface ScoredCandidate {
  candidate: QuadCandidate;
  corners: Corners;
  score: number;
}

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
 * 這個方法保證輸出永遠是「左上→右上→右下→左下」的順時針順序，
 * 不會因為輪廓點的原始順序（順時針／逆時針／從哪個角開始）而讓
 * warpPerspective 的來源角與目標角對不上，導致校正後圖片翻轉或扭曲。
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

/** 計算三點構成的夾角（角度），用來檢查四個角是否接近 90 度 */
function angleAtVertex(prev: Point, vertex: Point, next: Point): number {
  const v1 = { x: prev.x - vertex.x, y: prev.y - vertex.y };
  const v2 = { x: next.x - vertex.x, y: next.y - vertex.y };
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 === 0 || mag2 === 0) return 90;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function maxAngleDeviation(corners: Corners): number {
  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = corners;
  const angles = [
    angleAtVertex(bottomLeftCorner, topLeftCorner, topRightCorner),
    angleAtVertex(topLeftCorner, topRightCorner, bottomRightCorner),
    angleAtVertex(topRightCorner, bottomRightCorner, bottomLeftCorner),
    angleAtVertex(bottomRightCorner, bottomLeftCorner, topLeftCorner),
  ];
  return Math.max(...angles.map((a) => Math.abs(a - 90)));
}

function matToPoints(mat: CvMat): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < mat.rows; i++) {
    points.push({ x: mat.data32S[i * 2], y: mat.data32S[i * 2 + 1] });
  }
  return points;
}

/**
 * 每種前處理方式回傳一個二值化／邊緣 Mat，附上信心優先度（數字越大越可信，
 * 用於評分時的 tie-break，本身不是硬性篩選條件）。呼叫端負責 delete 回傳的 Mat。
 *
 * 額外用 CLAHE（局部對比度增強）處理過的灰階圖再跑一次 Canny：
 * 全域對比不足、光線平淡的照片（例如淺色文件放在同樣偏淺色的桌面上），
 * 直接對原圖做 Canny／threshold 往往完全找不到夠強的邊緣，CLAHE 能局部拉開
 * 對比，讓原本很微弱的文件邊界變得可偵測。
 */
function buildPreprocessAttempts(
  cv: CvNamespace,
  blurred: CvMat,
  claheBlurred: CvMat
): { name: string; priority: number; useOpen: boolean; run: () => CvMat }[] {
  return [
    {
      name: "canny-strict",
      priority: 5,
      useOpen: false,
      run: () => {
        const edges = new cv.Mat();
        cv.Canny(blurred, edges, 60, 180);
        return edges;
      },
    },
    {
      name: "canny-relaxed",
      priority: 4,
      useOpen: false,
      run: () => {
        const edges = new cv.Mat();
        cv.Canny(blurred, edges, 25, 90);
        return edges;
      },
    },
    {
      name: "otsu-threshold",
      priority: 3,
      useOpen: true,
      run: () => {
        const thresh = new cv.Mat();
        cv.threshold(blurred, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
        return thresh;
      },
    },
    {
      name: "adaptive-threshold",
      priority: 3,
      useOpen: true,
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
    {
      name: "canny-clahe",
      priority: 3,
      useOpen: false,
      run: () => {
        const edges = new cv.Mat();
        cv.Canny(claheBlurred, edges, 40, 120);
        return edges;
      },
    },
    {
      name: "canny-loose",
      priority: 2,
      useOpen: false,
      run: () => {
        const edges = new cv.Mat();
        cv.Canny(blurred, edges, 10, 45);
        return edges;
      },
    },
  ];
}

/**
 * 在縮圖座標系上收集所有前處理方式找到的候選四邊形（不會提早停止），
 * 交給 correctDocument 統一評分挑選最佳結果。
 */
function collectQuadCandidates(cv: CvNamespace, detectMat: CvMat): QuadCandidate[] {
  const gray = new cv.Mat();
  cv.cvtColor(detectMat, gray, cv.COLOR_RGBA2GRAY);
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  const claheFilter = new cv.CLAHE(3.0, new cv.Size(8, 8));
  const claheGray = new cv.Mat();
  claheFilter.apply(gray, claheGray);
  claheFilter.delete();
  gray.delete();
  const claheBlurred = new cv.Mat();
  cv.GaussianBlur(claheGray, claheBlurred, new cv.Size(5, 5), 0);
  claheGray.delete();

  const imageArea = detectMat.cols * detectMat.rows;
  const minArea = imageArea * MIN_CONTOUR_AREA_RATIO;
  const maxArea = imageArea * MAX_CONTOUR_AREA_RATIO;
  const closeKernel = cv.Mat.ones(5, 5, cv.CV_8U);
  const openKernel = cv.Mat.ones(3, 3, cv.CV_8U);

  const allCandidates: QuadCandidate[] = [];

  for (const attempt of buildPreprocessAttempts(cv, blurred, claheBlurred)) {
    const raw = attempt.run();

    // morphology close 補齊邊緣缺口。open 只對二值化方法（otsu／adaptive threshold）
    // 套用：這類方法容易產生小雜訊斑塊，open 能清掉；但 Canny 系列產生的是本來就很細的
    // 邊緣線，實測 open 會直接把這些細邊緣整條抹掉，導致原本能用的候選消失，因此跳過。
    const closed = new cv.Mat();
    cv.morphologyEx(raw, closed, cv.MORPH_CLOSE, closeKernel);
    raw.delete();

    let processed = closed;
    if (attempt.useOpen) {
      const opened = new cv.Mat();
      cv.morphologyEx(closed, opened, cv.MORPH_OPEN, openKernel);
      closed.delete();
      processed = opened;
    }

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(
      processed,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );
    processed.delete();
    hierarchy.delete();

    const areaCandidates: { contour: CvMat; area: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area >= minArea && area <= maxArea) {
        areaCandidates.push({ contour, area });
      } else {
        contour.delete();
      }
    }
    contours.delete();
    areaCandidates.sort((a, b) => b.area - a.area);

    for (const { contour } of areaCandidates.slice(0, MAX_CANDIDATE_CONTOURS)) {
      const perimeter = cv.arcLength(contour, true);
      for (let epsilonRank = 0; epsilonRank < APPROX_EPSILON_RATIOS.length; epsilonRank++) {
        const epsilonRatio = APPROX_EPSILON_RATIOS[epsilonRank]!;
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, epsilonRatio * perimeter, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const points = matToPoints(approx);
          const area = quadrilateralArea(points);
          if (area >= minArea && area <= maxArea) {
            allCandidates.push({
              points,
              method: attempt.name,
              methodPriority: attempt.priority,
              epsilonRank,
            });
          }
          approx.delete();
          break;
        }
        approx.delete();
      }
      contour.delete();
    }
  }

  closeKernel.delete();
  openKernel.delete();
  blurred.delete();
  claheBlurred.delete();
  return allCandidates;
}

/**
 * 檢查候選四邊形有幾個角「貼著照片邊界」。如果 3 個以上的角都幾乎貼齊照片邊緣，
 * 代表這個「四邊形」很可能只是照片本身的外框（或非常靠近外框的雜訊/暗角），
 * 不是真正的文件邊界——真實文件照片很少會拍到緊貼四個邊框、幾乎零留白的程度。
 * 這是實測發現的真實失誤模式：CLAHE 等前處理方式偶爾會把照片邊框本身當成
 * 最強的邊緣，如果只靠面積比例（例如 90%）過濾，這種情況常常剛好躲在門檻內。
 */
function countBoundaryTouchingCorners(
  points: Point[],
  width: number,
  height: number
): number {
  const marginX = width * 0.012;
  const marginY = height * 0.012;
  return points.filter(
    (p) => p.x <= marginX || p.x >= width - marginX || p.y <= marginY || p.y >= height - marginY
  ).length;
}

/**
 * 對候選四邊形評分。回傳 null 代表這個候選不合理（硬性條件不通過），
 * 不列入比較。
 */
function scoreCandidate(
  candidate: QuadCandidate,
  imageWidth: number,
  imageHeight: number
): ScoredCandidate | null {
  const corners = orderCorners(candidate.points);
  if (!corners) return null;

  const { width, height } = computeOutputSize(corners);
  if (width < 10 || height < 10) return null;

  const aspectRatio = Math.max(width, height) / Math.min(width, height);
  if (aspectRatio > MAX_ASPECT_RATIO) return null;

  const deviation = maxAngleDeviation(corners);
  if (deviation > MAX_ANGLE_DEVIATION_DEGREES) return null;

  // 座標理論上一定落在縮圖範圍內（來自 findContours 的結果），這裡是防呆檢查
  const margin = 2;
  const outOfBounds = candidate.points.some(
    (p) =>
      p.x < -margin ||
      p.y < -margin ||
      p.x > imageWidth + margin ||
      p.y > imageHeight + margin
  );
  if (outOfBounds) return null;

  if (countBoundaryTouchingCorners(candidate.points, imageWidth, imageHeight) >= 3) {
    return null;
  }

  const areaRatio = quadrilateralArea(candidate.points) / (imageWidth * imageHeight);

  let score = 0;
  score += areaRatio * 20; // 面積佔比小幅加分（同樣合理時偏好涵蓋範圍較大的結果），
  // 權重刻意壓低：實測發現面積權重太高時，評分會偏好「幾乎等於整張照片邊框」的
  // 誤判結果（尤其是搭配 CLAHE 找到的候選），角度與方法可信度應該是更重要的依據。
  score -= deviation * 2; // 角度偏差扣分，越接近矩形分數越高
  score += candidate.methodPriority * 4; // 前處理方式的可信度
  score -= candidate.epsilonRank * 1.5; // 越不需要簡化（epsilon 越小）分數越高

  return { candidate, corners, score };
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

    const candidates = collectQuadCandidates(cv, detectMat);
    const detectWidth = detectMat.cols;
    const detectHeight = detectMat.rows;
    if (detectMat !== src) detectMat.delete();

    const scored = candidates
      .map((c) => scoreCandidate(c, detectWidth, detectHeight))
      .filter((s): s is ScoredCandidate => s !== null)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best) {
      return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
    }

    const cornersInFullRes: Corners = {
      topLeftCorner: { x: best.corners.topLeftCorner.x / scale, y: best.corners.topLeftCorner.y / scale },
      topRightCorner: { x: best.corners.topRightCorner.x / scale, y: best.corners.topRightCorner.y / scale },
      bottomLeftCorner: { x: best.corners.bottomLeftCorner.x / scale, y: best.corners.bottomLeftCorner.y / scale },
      bottomRightCorner: { x: best.corners.bottomRightCorner.x / scale, y: best.corners.bottomRightCorner.y / scale },
    };

    const { width, height } = computeOutputSize(cornersInFullRes);
    if (width < 10 || height < 10) {
      return { kind: "not-detected", message: NOT_DETECTED_MESSAGE };
    }

    const canvas = warpPerspective(cv, src, cornersInFullRes, width, height);

    return { kind: "corrected", canvas, corners: cornersInFullRes };
  } catch (error) {
    console.error("[documentScanner] 校正失敗", error);
    return { kind: "error", message: NOT_DETECTED_MESSAGE };
  } finally {
    src?.delete();
  }
}
