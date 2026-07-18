/**
 * 純瀏覽器端的下載觸發工具，跟業務邏輯無關，JPG／PDF 下載都共用這支。
 */

export function triggerUrlDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerUrlDownload(url, filename);
  // 稍微延遲再釋放，確保瀏覽器已經把下載請求接手過去
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
