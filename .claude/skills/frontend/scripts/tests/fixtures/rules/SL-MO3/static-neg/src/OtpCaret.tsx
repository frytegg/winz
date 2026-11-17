export function OtpCaret() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="animate-caret-blink bg-foreground h-4 w-px duration-1000" />
      <span className="animate-[shimmer_2s_linear_infinite] duration-700">Syncing</span>
    </div>
  );
}
