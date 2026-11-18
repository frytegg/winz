"use client";

import { useId, useMemo, useState, type PointerEvent } from "react";

import { copy } from "@/lib/copy";
import { bpsToWholePercent, formatTime } from "@/lib/format";
import { axisMaxPercent, type OddsPoint } from "@/lib/merchant/odds-history";

/** The drawing is 320 wide, about the width of the card on a phone, so its text stays near 11px. */
const W = 320;
const H = 176;
const LEFT = 6;
const RIGHT = 34;
const TOP = 26;
const BOTTOM = 26;
const PLOT_W = W - LEFT - RIGHT;
const PLOT_H = H - TOP - BOTTOM;
/** A chart of fewer seconds than this still gets a real width, so a short wait does not look like a spike. */
const MIN_SPAN_MS = 60_000;

function time(t: number): string {
  return formatTime(new Date(t).toISOString());
}

interface LiveChanceChartProps {
  /** What was read, oldest first. */
  points: readonly OddsPoint[];
  /** The auto-pause line, in basis points. */
  thresholdBps: number;
}

/**
 * The live chance over time against the auto-pause line (MD, "Stats"). A single series, so there is
 * no legend box: the card's title names it. The line is the amber of the first team, the pause line a
 * red dash; the grid is a faint white. Hover or drag shows a crosshair and the reading; a table of
 * the latest readings is there for screen readers. No history exists in the API, so the points are
 * the ones seen since the screen was first opened (`use-odds-history.ts`).
 */
export function LiveChanceChart({ points, thresholdBps }: LiveChanceChartProps): React.JSX.Element {
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const highest = points.reduce((max, point) => Math.max(max, point.bps), 0);
    const axisMax = axisMaxPercent(highest, thresholdBps);
    const first = points[0]?.t ?? 0;
    const last = points[points.length - 1]?.t ?? 0;
    const span = Math.max(last - first, MIN_SPAN_MS);
    const x = (t: number): number =>
      points.length < 2 ? LEFT + PLOT_W : LEFT + ((t - first) / span) * PLOT_W;
    const y = (bps: number): number => TOP + PLOT_H - (bps / 100 / axisMax) * PLOT_H;
    const step = axisMax > 30 ? 10 : 5;
    const ticks: number[] = [];
    for (let value = 0; value <= axisMax; value += step) ticks.push(value);
    const path = points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${x(point.t).toFixed(1)} ${y(point.bps).toFixed(1)}`,
      )
      .join(" ");
    return { first, last, x, y, ticks, path, axisMax };
  }, [points, thresholdBps]);

  const latest = points[points.length - 1];
  const thresholdPercent = bpsToWholePercent(thresholdBps);
  const summary =
    latest === undefined
      ? copy.campaignDetail.chartEmpty
      : copy.campaignDetail.chartSummary(bpsToWholePercent(latest.bps), thresholdPercent);

  function nearest(event: PointerEvent<SVGRectElement>): void {
    if (points.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * PLOT_W + LEFT;
    let best = 0;
    let distance = Infinity;
    points.forEach((point, index) => {
      const d = Math.abs(geometry.x(point.t) - px);
      if (d < distance) {
        distance = d;
        best = index;
      }
    });
    setHover(best);
  }

  const hovered = hover === null ? undefined : points[hover];
  const recent = points.slice(-8).reverse();

  return (
    <div>
      <svg
        viewBox={`0 0 ${W.toString()} ${H.toString()}`}
        role="img"
        aria-labelledby={titleId}
        className="block h-auto w-full touch-pan-y select-none"
      >
        <title id={titleId}>{summary}</title>

        {geometry.ticks.map((value) => (
          <g key={value}>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={geometry.y(value * 100)}
              y2={geometry.y(value * 100)}
              className="stroke-white/10"
              strokeWidth={1}
            />
            <text
              x={W}
              y={geometry.y(value * 100) + 4}
              textAnchor="end"
              className="fill-muted"
              fontSize={12}
            >
              {value.toString()}%
            </text>
          </g>
        ))}

        <line
          x1={LEFT}
          x2={W - RIGHT}
          y1={geometry.y(thresholdBps)}
          y2={geometry.y(thresholdBps)}
          className="stroke-danger"
          strokeWidth={1.5}
          strokeDasharray="2 4"
          strokeLinecap="round"
        />
        <text
          x={W - RIGHT}
          y={geometry.y(thresholdBps) - 7}
          textAnchor="end"
          className="fill-muted"
          fontSize={12}
        >
          {copy.campaignDetail.autoPause(thresholdPercent)}
        </text>

        {points.length >= 2 ? (
          <path
            d={geometry.path}
            fill="none"
            className="stroke-team-a"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {latest === undefined ? null : (
          <circle
            cx={geometry.x(latest.t)}
            cy={geometry.y(latest.bps)}
            r={4}
            className="fill-team-a stroke-card"
            strokeWidth={2}
          />
        )}

        {points.length >= 2 ? (
          <>
            {time(geometry.first) === time(geometry.last) ? null : (
              <text x={LEFT} y={H - 6} className="fill-muted" fontSize={12}>
                {time(geometry.first)}
              </text>
            )}
            <text x={W - RIGHT} y={H - 6} textAnchor="end" className="fill-muted" fontSize={12}>
              {time(geometry.last)}
            </text>
          </>
        ) : null}

        {hovered === undefined ? null : (
          <g pointerEvents="none">
            <line
              x1={geometry.x(hovered.t)}
              x2={geometry.x(hovered.t)}
              y1={TOP}
              y2={TOP + PLOT_H}
              className="stroke-white/40"
              strokeWidth={1}
            />
            <circle
              cx={geometry.x(hovered.t)}
              cy={geometry.y(hovered.bps)}
              r={4.5}
              className="fill-team-a stroke-card"
              strokeWidth={2}
            />
            {(() => {
              const label = copy.campaignDetail.chartAt(
                time(hovered.t),
                bpsToWholePercent(hovered.bps),
              );
              const width = label.length * 6.4 + 16;
              const cx = Math.min(
                Math.max(geometry.x(hovered.t), LEFT + width / 2),
                W - RIGHT - width / 2 + 10,
              );
              return (
                <g>
                  <rect
                    x={cx - width / 2}
                    y={2}
                    width={width}
                    height={20}
                    rx={10}
                    className="fill-white-pill"
                  />
                  <text x={cx} y={16} textAnchor="middle" className="fill-ink" fontSize={12}>
                    {label}
                  </text>
                </g>
              );
            })()}
          </g>
        )}

        <rect
          x={LEFT}
          y={0}
          width={PLOT_W}
          height={H - BOTTOM}
          fill="transparent"
          onPointerDown={nearest}
          onPointerMove={nearest}
          onPointerLeave={() => setHover(null)}
          onPointerCancel={() => setHover(null)}
        />
      </svg>

      <table className="sr-only">
        <caption>{copy.campaignDetail.chartTable}</caption>
        <thead>
          <tr>
            <th scope="col">{copy.campaignDetail.chartTime}</th>
            <th scope="col">{copy.campaignDetail.chartValue}</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((point) => (
            <tr key={point.t}>
              <td>{time(point.t)}</td>
              <td>{bpsToWholePercent(point.bps).toString()}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
