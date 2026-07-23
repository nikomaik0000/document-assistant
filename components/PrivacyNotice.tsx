export default function PrivacyNotice() {
  return (
    <div className="flex items-center justify-center gap-2 text-center text-xs text-ink-faint">
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4 shrink-0"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4.5 7V5.5a3.5 3.5 0 0 1 7 0V7"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <rect
          x="3"
          y="7"
          width="10"
          height="7"
          rx="1.8"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
      <span>所有圖片皆於您的瀏覽器內完成處理。不會上傳・不會儲存・不會離開您的電腦。</span>
    </div>
  );
}
