// FD14-F12: mounted with its pointer code switched off.
export function FloatingLines({ interactive = true }: { interactive?: boolean }) {
  return (
    <div
      onPointerMove={(e) => {
        if (!interactive) return;
        e.currentTarget.style.setProperty('--pointer-x', String(e.clientX));
      }}
    />
  );
}
