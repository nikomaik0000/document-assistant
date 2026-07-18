/*!
 * 此檔案為 vendored 第三方程式碼，非本專案自行撰寫。
 *
 * 來源：npm 套件 jscanify@1.4.2 的 src/jscanify.js
 *       （https://www.npmjs.com/package/jscanify，MIT License，授權全文見同目錄 jscanify.LICENSE.txt）
 *
 * 為什麼用複製檔案而不是直接 `import "jscanify/client"`：
 * jscanify 這個 npm 套件的 package.json 把 `canvas`／`jsdom` 列為一般 dependencies
 * （給它的 Node.js 版本用），即使我們只用到不依賴這兩者的瀏覽器版本（"jscanify/client"），
 * `npm install` / `pnpm install` 仍會嘗試安裝並建置 `canvas`（原生 Node 模組，需要編譯）。
 * 這在 pnpm 的預設安全機制下會直接讓 install 失敗（ERR_PNPM_IGNORED_BUILDS），
 * 因此改為直接把這支「本來就不依賴任何套件」的純瀏覽器版本原始碼複製進本專案，
 * 避免整個相依樹被不必要的原生模組拖累。
 *
 * 這支檔案內容未經修改，僅新增這段註解。若要更新版本，直接替換整支檔案即可。
 *
 * jscanify v1.4.0 | (c) ColonelParrot and other contributors | MIT License
 */

(function (global, factory) {
  typeof exports === "object" && typeof module !== "undefined"
    ? (module.exports = factory())
    : typeof define === "function" && define.amd
      ? define(factory)
      : (global.jscanify = factory());
})(this, function () {
  "use strict";

  /**
   * Calculates distance between two points. Each point must have `x` and `y` property
   * @param {*} p1 point 1
   * @param {*} p2 point 2
   * @returns distance between two points
   */
  function distance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  class jscanify {
    constructor() { }

    /**
     * Finds the contour of the paper within the image
     * @param {*} img image to process (cv.Mat)
     * @returns the biggest contour inside the image
     */
    findPaperContour(img) {
      const imgGray = new cv.Mat();
      cv.Canny(img, imgGray, 50, 200);

      const imgBlur = new cv.Mat();
      cv.GaussianBlur(
        imgGray,
        imgBlur,
        new cv.Size(3, 3),
        0,
        0,
        cv.BORDER_DEFAULT
      );

      const imgThresh = new cv.Mat();
      cv.threshold(
        imgBlur,
        imgThresh,
        0,
        255,
        cv.THRESH_OTSU
      );

      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();

      cv.findContours(
        imgThresh,
        contours,
        hierarchy,
        cv.RETR_CCOMP,
        cv.CHAIN_APPROX_SIMPLE
      );

      let maxArea = 0;
      let maxContourIndex = -1;
      for (let i = 0; i < contours.size(); ++i) {
        let contourArea = cv.contourArea(contours.get(i));
        if (contourArea > maxArea) {
          maxArea = contourArea;
          maxContourIndex = i;
        }
      }

      const maxContour =
        maxContourIndex >= 0 ?
          contours.get(maxContourIndex) :
          null;

      imgGray.delete();
      imgBlur.delete();
      imgThresh.delete();
      contours.delete();
      hierarchy.delete();
      return maxContour;
    }

    /**
     * Highlights the paper detected inside the image.
     * @param {*} image image to process
     * @param {*} options options for highlighting. Accepts `color` and `thickness` parameter
     * @returns `HTMLCanvasElement` with original image and paper highlighted
     */
    highlightPaper(image, options) {
      options = options || {};
      options.color = options.color || "orange";
      options.thickness = options.thickness || 10;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = cv.imread(image);

      const maxContour = this.findPaperContour(img);
      cv.imshow(canvas, img);
      if (maxContour) {
        const {
          topLeftCorner,
          topRightCorner,
          bottomLeftCorner,
          bottomRightCorner,
        } = this.getCornerPoints(maxContour, img);

        if (
          topLeftCorner &&
          topRightCorner &&
          bottomLeftCorner &&
          bottomRightCorner
        ) {
          ctx.strokeStyle = options.color;
          ctx.lineWidth = options.thickness;
          ctx.beginPath();
          ctx.moveTo(...Object.values(topLeftCorner));
          ctx.lineTo(...Object.values(topRightCorner));
          ctx.lineTo(...Object.values(bottomRightCorner));
          ctx.lineTo(...Object.values(bottomLeftCorner));
          ctx.lineTo(...Object.values(topLeftCorner));
          ctx.stroke();
        }
      }

      img.delete();
      return canvas;
    }

    /**
     * Extracts and undistorts the image detected within the frame.
     * 
     * Returns `null` if no paper is detected.
     *  
    * @param {*} image image to process
     * @param {*} resultWidth desired result paper width
     * @param {*} resultHeight desired result paper height
     * @param {*} cornerPoints optional custom corner points, in case automatic corner points are incorrect
     * @returns `HTMLCanvasElement` containing undistorted image
     */
    extractPaper(image, resultWidth, resultHeight, cornerPoints) {
      const canvas = document.createElement("canvas");
      const img = cv.imread(image);
      const maxContour = cornerPoints ? null : this.findPaperContour(img);

      if(maxContour == null && cornerPoints === undefined){
        return null;
      }

      const {
        topLeftCorner,
        topRightCorner,
        bottomLeftCorner,
        bottomRightCorner,
      } = cornerPoints || this.getCornerPoints(maxContour, img);
      let warpedDst = new cv.Mat();

      let dsize = new cv.Size(resultWidth, resultHeight);
      let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        topLeftCorner.x,
        topLeftCorner.y,
        topRightCorner.x,
        topRightCorner.y,
        bottomLeftCorner.x,
        bottomLeftCorner.y,
        bottomRightCorner.x,
        bottomRightCorner.y,
      ]);

      let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        resultWidth,
        0,
        0,
        resultHeight,
        resultWidth,
        resultHeight,
      ]);

      let M = cv.getPerspectiveTransform(srcTri, dstTri);
      cv.warpPerspective(
        img,
        warpedDst,
        M,
        dsize,
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar()
      );

      cv.imshow(canvas, warpedDst);

      img.delete()
      warpedDst.delete()
      return canvas;
    }

    /**
     * Calculates the corner points of a contour.
     * @param {*} contour contour from {@link findPaperContour}
     * @returns object with properties `topLeftCorner`, `topRightCorner`, `bottomLeftCorner`, `bottomRightCorner`, each with `x` and `y` property
     */
    getCornerPoints(contour) {
      let rect = cv.minAreaRect(contour);
      const center = rect.center;

      let topLeftCorner;
      let topLeftCornerDist = 0;

      let topRightCorner;
      let topRightCornerDist = 0;

      let bottomLeftCorner;
      let bottomLeftCornerDist = 0;

      let bottomRightCorner;
      let bottomRightCornerDist = 0;

      for (let i = 0; i < contour.data32S.length; i += 2) {
        const point = { x: contour.data32S[i], y: contour.data32S[i + 1] };
        const dist = distance(point, center);
        if (point.x < center.x && point.y < center.y) {
          // top left
          if (dist > topLeftCornerDist) {
            topLeftCorner = point;
            topLeftCornerDist = dist;
          }
        } else if (point.x > center.x && point.y < center.y) {
          // top right
          if (dist > topRightCornerDist) {
            topRightCorner = point;
            topRightCornerDist = dist;
          }
        } else if (point.x < center.x && point.y > center.y) {
          // bottom left
          if (dist > bottomLeftCornerDist) {
            bottomLeftCorner = point;
            bottomLeftCornerDist = dist;
          }
        } else if (point.x > center.x && point.y > center.y) {
          // bottom right
          if (dist > bottomRightCornerDist) {
            bottomRightCorner = point;
            bottomRightCornerDist = dist;
          }
        }
      }

      return {
        topLeftCorner,
        topRightCorner,
        bottomLeftCorner,
        bottomRightCorner,
      };
    }
  }

  return jscanify;
});
