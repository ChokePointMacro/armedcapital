'use client';

import { useState } from 'react';
import type { StatusPill as StatusPillValue } from '@/types';

// Equirectangular (Plate Carrée) projection.
// Convert (lat, lng) → SVG viewBox coordinates.
const PROJ_W = 800;
const PROJ_H = 400;
const SCALE = PROJ_W / 360; // = PROJ_H / 180 = 2.222…

function project(lat: number, lng: number): [number, number] {
  return [(lng + 180) * SCALE, (90 - lat) * SCALE];
}

// Hand-traced simplified continent silhouettes. Intentionally low-fi —
// dashboard aesthetic is "instrument panel," not cartographic atlas.
// Phase 2 swaps in Mapbox GL with routed shipping lanes through chokepoints.
const CONTINENTS: { name: string; d: string }[] = [
  { name: 'North America',
    d: 'M 33,44 L 200,33 L 289,33 L 278,96 L 233,118 L 222,144 L 211,167 L 178,167 L 138,127 L 111,89 L 67,67 Z' },
  { name: 'South America',
    d: 'M 244,173 L 324,189 L 311,251 L 249,322 L 244,240 L 222,204 Z' },
  { name: 'Eurasia',
    d: 'M 800,44 L 722,122 L 656,151 L 633,178 L 629,198 L 611,178 L 573,182 L 562,147 L 533,147 L 511,167 L 496,167 L 478,129 L 478,118 L 462,111 L 456,118 L 389,118 L 389,89 L 411,67 L 467,44 Z' },
  { name: 'Africa',
    d: 'M 378,122 L 478,122 L 513,173 L 478,249 L 444,278 L 431,249 L 418,189 L 362,167 Z' },
  { name: 'Australia',
    d: 'M 689,227 L 722,227 L 744,267 L 720,284 L 656,278 L 651,249 Z' },
  { name: 'Antarctica',
    d: 'M 0,344 L 800,344 L 800,389 L 0,389 Z' },
];

const STATUS_COLORS: Record<StatusPillValue, { fill: string; glow: string; pulse: boolean }> = {
  green:   { fill: '#34d399', glow: 'rgba(52,211,153,0.55)',  pulse: true },
  yellow:  { fill: '#fbbf24', glow: 'rgba(251,191,36,0.55)',  pulse: true },
  red:     { fill: '#fb7185', glow: 'rgba(251,113,133,0.55)', pulse: true },
  unknown: { fill: '#71717a', glow: 'rgba(113,113,122,0.4)',  pulse: false },
};

export interface ChokepointMapPoint {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  bbox_min_lat: number;
  bbox_min_lng: number;
  bbox_max_lat: number;
  bbox_max_lng: number;
  latest_status: StatusPillValue;
}

export function ChokepointMap({
  chokepoints,
  className = '',
}: {
  chokepoints: ChokepointMapPoint[];
  className?: string;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div
      className={`relative w-full aspect-[2/1] border border-btc-orange/15 bg-[#0a0a0a]/60 overflow-hidden ${className}`}
    >
      <svg
        viewBox={`0 0 ${PROJ_W} ${PROJ_H}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Lat/lng grid */}
        <g stroke="#f7931a" strokeOpacity="0.05" strokeWidth="0.5">
          {[100, 200, 300].map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2={PROJ_W} y2={y} />
          ))}
          {[100, 200, 300, 400, 500, 600, 700].map((x) => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2={PROJ_H} />
          ))}
        </g>

        {/* Equator emphasis */}
        <line
          x1="0" y1={PROJ_H / 2} x2={PROJ_W} y2={PROJ_H / 2}
          stroke="#f7931a" strokeOpacity="0.10" strokeWidth="0.6" strokeDasharray="4,4"
        />

        {/* Continent silhouettes */}
        <g>
          {CONTINENTS.map((c) => (
            <path
              key={c.name}
              d={c.d}
              fill="#f7931a"
              fillOpacity="0.05"
              stroke="#f7931a"
              strokeOpacity="0.22"
              strokeWidth="0.7"
              strokeLinejoin="round"
            />
          ))}
        </g>

        {/* Chokepoint bboxes — subtle dashed rects */}
        <g>
          {chokepoints.map((cp) => {
            const [x1, y1] = project(cp.bbox_max_lat, cp.bbox_min_lng);
            const [x2, y2] = project(cp.bbox_min_lat, cp.bbox_max_lng);
            const isHovered = hoveredId === cp.id;
            return (
              <rect
                key={`bbox-${cp.id}`}
                x={x1}
                y={y1}
                width={Math.max(x2 - x1, 8)}
                height={Math.max(y2 - y1, 8)}
                fill="none"
                stroke="#f7931a"
                strokeOpacity={isHovered ? 0.5 : 0.12}
                strokeWidth="0.6"
                strokeDasharray="3,2"
              />
            );
          })}
        </g>

        {/* Chokepoint markers */}
        <g>
          {chokepoints.map((cp) => {
            const [cx, cy] = project(cp.center_lat, cp.center_lng);
            const c = STATUS_COLORS[cp.latest_status];
            const isHovered = hoveredId === cp.id;
            // Push label left if marker is in the right third of the canvas
            const labelOnLeft = cx > PROJ_W * 0.7;
            return (
              <g
                key={cp.id}
                onMouseEnter={() => setHoveredId(cp.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Pulsing outer ring (only for live statuses) */}
                {c.pulse && (
                  <circle cx={cx} cy={cy} r="6" fill={c.fill} fillOpacity="0.35">
                    <animate attributeName="r"            values="5;14;5"     dur="2.8s" repeatCount="indefinite" />
                    <animate attributeName="fill-opacity" values="0.35;0;0.35" dur="2.8s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Dashed ring for 'unknown' — visually different from a live state */}
                {!c.pulse && (
                  <circle
                    cx={cx} cy={cy} r="9"
                    fill="none"
                    stroke={c.fill}
                    strokeOpacity="0.5"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                )}

                {/* Inner dot */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 5.5 : 4.5}
                  fill={c.fill}
                  stroke="#0a0a0a"
                  strokeWidth="1.2"
                  style={{ filter: c.pulse ? `drop-shadow(0 0 6px ${c.glow})` : 'none' }}
                />

                {/* Label */}
                <text
                  x={labelOnLeft ? cx - 9 : cx + 9}
                  y={cy + 3.5}
                  fill="#e5e5e5"
                  fillOpacity={isHovered ? 1 : 0.55}
                  fontSize="9"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  textAnchor={labelOnLeft ? 'end' : 'start'}
                  style={{
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                >
                  {cp.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Bottom-right legend */}
      <div className="absolute bottom-3 right-3 flex items-center gap-2.5 text-[9px] font-mono uppercase tracking-widest text-gray-500 pointer-events-none">
        <span className="text-btc-orange/40">Equirectangular</span>
        <span className="text-btc-orange/30">·</span>
        <span>Phase 2 — routed lanes pending</span>
      </div>
    </div>
  );
}

export default ChokepointMap;
