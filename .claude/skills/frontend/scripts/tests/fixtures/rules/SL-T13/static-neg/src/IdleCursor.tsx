import { useEffect } from 'react';

// Hides the cursor after a pause: it reads no coordinates.
export function IdleCursor() {
  useEffect(() => {
    let timer = 0;
    const onMove = () => {
      document.body.classList.remove('cursor-hidden');
      clearTimeout(timer);
      timer = window.setTimeout(() => document.body.classList.add('cursor-hidden'), 2000);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  return null;
}
