import { useState } from 'react';

// A crosshair on a chart is function (FD14-F23).
export function PriceChart() {
  const [x, setX] = useState(0);
  return (
    <svg onMouseMove={(e) => setX(e.clientX)} style={{ transform: `translateX(${x}px)` }}>
      <line x1={x} x2={x} y1={0} y2={100} />
    </svg>
  );
}
