import type { ImageAdjustments } from "@/types/image";

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  grayscale: false,
  brightness: 0,
  contrast: 0,
};

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampAdjustment(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(-100, Math.round(value)));
}

export function normalizeImageAdjustments(
  adjustments?: Partial<ImageAdjustments>
): ImageAdjustments {
  return {
    grayscale: adjustments?.grayscale ?? DEFAULT_IMAGE_ADJUSTMENTS.grayscale,
    brightness: clampAdjustment(adjustments?.brightness ?? DEFAULT_IMAGE_ADJUSTMENTS.brightness),
    contrast: clampAdjustment(adjustments?.contrast ?? DEFAULT_IMAGE_ADJUSTMENTS.contrast),
  };
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = url;
  });
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("圖片調整輸出失敗"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.92
    );
  });
}

export async function applyImageAdjustments(
  imageUrl: string,
  adjustmentsInput?: Partial<ImageAdjustments>
): Promise<string> {
  const adjustments = normalizeImageAdjustments(adjustmentsInput);
  const source = await loadImageElement(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, source.naturalWidth);
  canvas.height = Math.max(1, source.naturalHeight);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("無法建立圖片調整畫布");

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const brightnessOffset = (adjustments.brightness / 100) * 255;
  const contrastValue = adjustments.contrast;
  const contrastFactor =
    (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));

  for (let i = 0; i < data.length; i += 4) {
    let red = data[i] ?? 0;
    let green = data[i + 1] ?? 0;
    let blue = data[i + 2] ?? 0;

    if (adjustments.grayscale) {
      const gray = red * 0.299 + green * 0.587 + blue * 0.114;
      red = gray;
      green = gray;
      blue = gray;
    }

    red = contrastFactor * (red + brightnessOffset - 128) + 128;
    green = contrastFactor * (green + brightnessOffset - 128) + 128;
    blue = contrastFactor * (blue + brightnessOffset - 128) + 128;

    data[i] = clampByte(red);
    data[i + 1] = clampByte(green);
    data[i + 2] = clampByte(blue);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToObjectUrl(canvas);
}
