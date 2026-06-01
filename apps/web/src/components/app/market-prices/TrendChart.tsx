"use client";

import { useState } from "react";
import { TREND_DATA } from "@/constants/marketPrices";

export default function TrendChart() {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const data = TREND_DATA;
  const maxTotal = Math.max(...data.map(d => d.medianTotal));
  const minTotal = Math.min(...data.map(d => d.medianTotal));
  const maxSdm = Math.max(...data.map(d => d.medianSdm));

  const W = 800;
  const H = 300;
  const PAD = { top: 30, right: 20, bottom: 60, left: 60 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const yMin = Math.floor(Math.min(minTotal, 200) / 100) * 100;
  const yMax = Math.ceil(maxTotal / 100) * 100 + 100;

  const xStep = chartW / (data.length - 1);

  function toX(i: number) {
    return PAD.left + i * xStep;
  }
  function toY(val: number) {
    return PAD.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
  }

  const totalPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(d.medianTotal)}`).join(" ");
  const sdmPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(d.medianSdm)}`).join(" ");

  // Y축 눈금
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += 200) {
    yTicks.push(v);
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[600px]"
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {/* 배경 그리드 */}
        {yTicks.map(v => (
          <g key={v}>
            <line
              x1={PAD.left} y1={toY(v)}
              x2={W - PAD.right} y2={toY(v)}
              stroke="#eadfc9" strokeWidth={1}
            />
            <text
              x={PAD.left - 8} y={toY(v) + 4}
              textAnchor="end" fontSize={10} fill="#7a8290"
            >
              {v.toLocaleString()}만원
            </text>
          </g>
        ))}

        {/* 총비용 라인 */}
        <path d={totalPath} fill="none" stroke="#36534E" strokeWidth={2.5} strokeLinejoin="round" />
        {/* 스드메 라인 */}
        <path d={sdmPath} fill="none" stroke="#8c6f50" strokeWidth={2} strokeLinejoin="round" strokeDasharray="6,3" />

        {/* 데이터 포인트 */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={toX(i)} cy={toY(d.medianTotal)} r={hoveredIdx === i ? 5 : 3} fill="#36534E" />
            <circle cx={toX(i)} cy={toY(d.medianSdm)} r={hoveredIdx === i ? 4 : 2.5} fill="#8c6f50" />

            {/* 투명 히트 영역 */}
            <rect
              x={toX(i) - xStep / 2}
              y={PAD.top}
              width={xStep}
              height={chartH}
              fill="transparent"
              onMouseEnter={() => setHoveredIdx(i)}
              onTouchStart={() => setHoveredIdx(i)}
            />

            {/* X축 라벨 (격월) */}
            {i % 2 === 0 && (
              <text
                x={toX(i)} y={H - PAD.bottom + 20}
                textAnchor="middle" fontSize={9} fill="#7a8290"
                transform={`rotate(-30, ${toX(i)}, ${H - PAD.bottom + 20})`}
              >
                {d.month}
              </text>
            )}
          </g>
        ))}

        {/* 호버 툴팁 */}
        {hoveredIdx !== null && (
          <g>
            <line
              x1={toX(hoveredIdx)} y1={PAD.top}
              x2={toX(hoveredIdx)} y2={PAD.top + chartH}
              stroke="#9a9188" strokeWidth={1} strokeDasharray="3,3"
            />
            <rect
              x={Math.min(toX(hoveredIdx) - 60, W - PAD.right - 130)}
              y={PAD.top - 5}
              width={130} height={52} rx={8}
              fill="white" stroke="#eadfc9" strokeWidth={1}
              style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.08))" }}
            />
            <text
              x={Math.min(toX(hoveredIdx) - 52, W - PAD.right - 122)}
              y={PAD.top + 12}
              fontSize={10} fill="#7a8290"
            >
              {data[hoveredIdx].month}
            </text>
            <text
              x={Math.min(toX(hoveredIdx) - 52, W - PAD.right - 122)}
              y={PAD.top + 27}
              fontSize={11} fill="#36534E" fontWeight={600}
            >
              총비용 {data[hoveredIdx].medianTotal.toLocaleString()}만원
            </text>
            <text
              x={Math.min(toX(hoveredIdx) - 52, W - PAD.right - 122)}
              y={PAD.top + 42}
              fontSize={11} fill="#8c6f50" fontWeight={600}
            >
              스드메 {data[hoveredIdx].medianSdm.toLocaleString()}만원
            </text>
          </g>
        )}

        {/* 범례 */}
        <g transform={`translate(${PAD.left + 10}, ${PAD.top - 15})`}>
          <line x1={0} y1={0} x2={16} y2={0} stroke="#36534E" strokeWidth={2.5} />
          <text x={20} y={4} fontSize={10} fill="#7a8290">총비용 중위값</text>
          <line x1={100} y1={0} x2={116} y2={0} stroke="#8c6f50" strokeWidth={2} strokeDasharray="4,2" />
          <text x={120} y={4} fontSize={10} fill="#7a8290">스드메 중위값</text>
        </g>
      </svg>
    </div>
  );
}
