export function PayoffChart({ width, height }: { width: number; height: number }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`}>
      <text x={width} y={height - 4} textAnchor="end" fontSize={11}>
        price →
      </text>
      <text x={4} y={12} fontSize={11}>
        loss →
      </text>
      <text x={width / 2} y={12} fontSize={11}>
        <tspan>time →</tspan>
      </text>
    </svg>
  );
}
