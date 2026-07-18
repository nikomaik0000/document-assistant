/**
 * lib/pdf 模組對外的型別定義，與 React 無關。
 */

export interface PdfSourceImage {
  /** 圖片來源網址（object URL），會被重新繪製成 JPEG 後嵌入 PDF */
  url: string;
}

export interface PageCellRect {
  x: number;
  /** 距離頁面「底部」的距離（pdf-lib 座標系原點在左下角） */
  yFromBottom: number;
  width: number;
  height: number;
}
