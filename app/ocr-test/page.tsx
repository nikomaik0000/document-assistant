"use client";

/**
 * 最小可重現範例（Minimal Reproduction），用來確認 Tesseract.js 7 在
 * Next.js 15 + React 19 的環境本身能不能正常運作，完全不經過本專案既有的
 * OCR / OpenCV / 裁切 / ImageCard / Hook / Store 任何一層。
 *
 * 這支頁面只做：選圖 → createWorker() → recognize() → console.log(text)。
 *
 * 除錯用，之後可以刪除（不影響主流程 app/page.tsx）。
 */
import { useState } from "react";
import { createWorker } from "tesseract.js";

type Status = "idle" | "loading-worker" | "recognizing" | "done" | "error";

export default function OcrTestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [resultText, setResultText] = useState("");

  function log(...args: unknown[]) {
    const line = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    console.log("[ocr-test]", ...args);
    setLogLines((prev) => [...prev, line]);
  }

  async function handleRecognize(mode: "default" | "self-hosted") {
    if (!file) {
      log("沒有選擇檔案");
      return;
    }

    setLogLines([]);
    setResultText("");
    setStatus("loading-worker");

    try {
      if (mode === "default") {
        log("建立 worker：createWorker('eng') ...（完全使用套件預設值，不覆寫任何 path）");
      } else {
        log("建立 worker：createWorker('eng') ...（使用本專案自架的 workerPath/corePath/langPath + workerBlobURL:false）");
      }

      const worker = await createWorker(
        "eng",
        undefined,
        mode === "default"
          ? { logger: (m: unknown) => log("logger:", m) }
          : {
              workerPath: "/tesseract/worker.min.js",
              corePath: "/tesseract/core",
              langPath: "/tesseract/lang-data",
              workerBlobURL: false,
              logger: (m: unknown) => log("logger:", m),
            }
      );
      log("✓ worker 建立成功");

      setStatus("recognizing");
      const url = URL.createObjectURL(file);
      log("recognize()，圖片 URL：", url);
      const { data } = await worker.recognize(url);
      log("✓ recognize 完成");
      log("data.text 長度：", data.text.length);

      setResultText(data.text);
      setStatus("done");

      await worker.terminate();
      URL.revokeObjectURL(url);
    } catch (error) {
      log("✗ 發生例外");
      log("typeof error：", typeof error);
      log("error instanceof Error：", error instanceof Error);
      if (error instanceof Error) {
        log("error.name：", error.name);
        log("error.message：", error.message);
        log("error.stack：", error.stack ?? "(no stack)");
      }
      console.error("[ocr-test] raw error object:", error);
      try {
        log("JSON.stringify(error)：", JSON.stringify(error));
      } catch {
        log("JSON.stringify(error)：（無法序列化）");
      }
      setStatus("error");
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "monospace", maxWidth: 800 }}>
      <h1>OCR 最小重現範例（/ocr-test）</h1>
      <p>不經過本專案的 OpenCV / 裁切 / Store，純測試 Tesseract.js 本身。</p>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button
        onClick={() => handleRecognize("default")}
        disabled={!file || status === "loading-worker" || status === "recognizing"}
        style={{ marginLeft: 12 }}
      >
        {status === "loading-worker"
          ? "Loading worker..."
          : status === "recognizing"
            ? "Recognizing..."
            : "Recognize (套件預設值)"}
      </button>
      <button
        onClick={() => handleRecognize("self-hosted")}
        disabled={!file || status === "loading-worker" || status === "recognizing"}
        style={{ marginLeft: 12 }}
      >
        Recognize (本專案自架路徑)
      </button>

      <p>狀態：{status}</p>

      <h2>Log</h2>
      <pre
        style={{
          background: "#111",
          color: "#0f0",
          padding: 12,
          minHeight: 200,
          whiteSpace: "pre-wrap",
          fontSize: 12,
        }}
      >
        {logLines.join("\n")}
      </pre>

      <h2>OCR Result</h2>
      <textarea
        readOnly
        value={resultText}
        rows={8}
        style={{ width: "100%" }}
      />
    </main>
  );
}
