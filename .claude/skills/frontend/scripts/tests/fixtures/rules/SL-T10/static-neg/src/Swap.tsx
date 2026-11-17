// Functional control icons on actions (the owner's XRPL use, FD14-F11): no marketing glyph.
import { ChevronDown, Copy, X } from 'lucide-react';
// import { Sparkles } from 'lucide-react';

export function Swap() {
  return (
    <form>
      <button type="button" aria-label="Choose token"><ChevronDown /></button>
      <button type="button" aria-label="Copy address"><Copy /></button>
      <button type="button" aria-label="Close"><X /></button>
    </form>
  );
}
