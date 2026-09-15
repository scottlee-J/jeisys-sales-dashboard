"use client";

// 기간별 실적/forecast 를 선형(라인) 그래프로 보여 준다.
// 각 점 옆에는 항상 실제 수치를 함께 표기한다.
export type ChartPoint = {
  period: string;
  actual: number | null;
  forecast: number | null;
};

// 그래프 내부 좌표계 (화면 크기에 맞춰 자동으로 늘어난다)
const WIDTH = 720;
const HEIGHT = 340;
// 위아래로 붙는 수치가 잘리거나 가로축 이름과 겹치지 않도록 여백을 넉넉히 둔다.
// 원화 표기("₩125.7억")처럼 긴 눈금 값도 잘리지 않도록 왼쪽을 넓게 잡는다.
const PADDING = { top: 36, right: 28, bottom: 52, left: 70 };
const INNER_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;
// 첫 점과 마지막 점의 수치가 세로축 눈금이나 그래프 밖으로 밀려나지 않도록 좌우를 안쪽으로 들여 그린다.
const INSET = 32;
const PLOT_LEFT = PADDING.left + INSET;
const PLOT_RIGHT = WIDTH - PADDING.right - INSET;

export default function Chart({
  points,
  formatValue,
  labels = { actual: "실적", forecast: "forecast" },
  unit,
  showAchievement = false,
}: {
  points: ChartPoint[];
  formatValue: (value: number) => string;
  labels?: { actual: string; forecast: string };
  unit: string;
  // 실적/forecast 달성률(%)을 가로축 아래에 함께 표시할지 여부.
  // (전년 동기 비교처럼 forecast 자리에 다른 값이 들어가는 그래프에서는 의미가 없으므로 기본은 끔)
  showAchievement?: boolean;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-black/15 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
        선택한 조건에 해당하는 데이터가 아직 없습니다.
      </div>
    );
  }

  // 세로 눈금의 최대값 (0 으로 나누지 않도록 최소 1)
  const max = Math.max(
    1,
    ...points.flatMap((p) => [p.actual ?? 0, p.forecast ?? 0]),
  );

  const toX = (index: number) =>
    points.length === 1
      ? (PLOT_LEFT + PLOT_RIGHT) / 2
      : PLOT_LEFT + (index * (PLOT_RIGHT - PLOT_LEFT)) / (points.length - 1);
  const toY = (value: number) =>
    PADDING.top + INNER_HEIGHT - (value / max) * INNER_HEIGHT;

  // 가로 눈금선 4개를 그리기 위한 기준값
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => max * ratio);

  // 기간은 12개까지 모두 표시하고, 그보다 많으면 간격을 두고 표시한다.
  const labelStep = Math.ceil(points.length / 12);

  // 두 선의 수치가 겹치지 않도록, 위에 있는 선의 수치는 위쪽에 아래 선의 수치는 아래쪽에 둔다.
  const labelOffsets = points.map((point) => {
    if (point.actual === null || point.forecast === null) {
      return { actual: -12, forecast: -12 };
    }
    return toY(point.actual) <= toY(point.forecast)
      ? { actual: -12, forecast: 20 }
      : { actual: 20, forecast: -12 };
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 bg-indigo-500" />
            {labels.actual}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 border-t-2 border-dashed border-amber-500" />
            {labels.forecast}
          </span>
        </div>
        <span className="text-black/50 dark:text-white/50">(단위: {unit})</span>
      </div>
      {showAchievement && (
        <div className="flex items-center gap-3 text-[11px] text-black/50 dark:text-white/50">
          <span>달성률(실적/forecast):</span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            100% 이상
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-600 dark:bg-amber-400" />
            70~99%
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-500 dark:bg-red-400" />
            70% 미만
          </span>
        </div>
      )}

      <div className="rounded-lg border border-black/10 bg-black/[0.02] p-2 dark:border-white/15 dark:bg-white/[0.03]">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          role="img"
          aria-label="기간별 실적 및 forecast 추이"
        >
          {/* 가로 눈금선과 세로축 값 */}
          {gridValues.map((value) => (
            <g key={value}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={toY(value)}
                y2={toY(value)}
                className="stroke-black/10 dark:stroke-white/15"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 10}
                y={toY(value) + 4}
                textAnchor="end"
                className="fill-black/50 text-[11px] dark:fill-white/50"
              >
                {formatValue(value)}
              </text>
            </g>
          ))}

          {/* 기간(가로축) 이름 */}
          {points.map((point, index) =>
            index % labelStep === 0 ? (
              <text
                key={point.period}
                x={toX(index)}
                y={HEIGHT - 12}
                textAnchor="middle"
                className="fill-black/70 text-[11px] dark:fill-white/70"
              >
                {point.period}
              </text>
            ) : null,
          )}

          {/* 달성률(실적/forecast, %) — 기간 이름 바로 위에 색으로 구분해 표시 */}
          {showAchievement &&
            points.map((point, index) => {
              if (index % labelStep !== 0) return null;
              if (point.actual === null || point.forecast === null) return null;
              if (point.forecast <= 0) return null;
              const pct = Math.round((point.actual / point.forecast) * 100);
              const colorClass =
                pct >= 100
                  ? "fill-emerald-600 dark:fill-emerald-400"
                  : pct >= 70
                    ? "fill-amber-600 dark:fill-amber-400"
                    : "fill-red-500 dark:fill-red-400";
              return (
                <text
                  key={`achv-${point.period}`}
                  x={toX(index)}
                  y={HEIGHT - 26}
                  textAnchor="middle"
                  className={`text-[10px] font-semibold ${colorClass}`}
                >
                  {pct}%
                </text>
              );
            })}

          <Series
            values={points.map((p) => p.forecast)}
            toX={toX}
            toY={toY}
            colorClass="stroke-amber-500 fill-amber-500"
            dashed
            labelOffsets={labelOffsets.map((offset) => offset.forecast)}
            formatValue={formatValue}
            labelStep={labelStep}
          />
          <Series
            values={points.map((p) => p.actual)}
            toX={toX}
            toY={toY}
            colorClass="stroke-indigo-500 fill-indigo-500"
            labelOffsets={labelOffsets.map((offset) => offset.actual)}
            formatValue={formatValue}
            labelStep={labelStep}
          />
        </svg>
      </div>
    </div>
  );
}

// 하나의 선(실적 또는 forecast)을 그린다.
function Series({
  values,
  toX,
  toY,
  colorClass,
  dashed = false,
  labelOffsets,
  formatValue,
  labelStep,
}: {
  values: (number | null)[];
  toX: (index: number) => number;
  toY: (value: number) => number;
  colorClass: string;
  dashed?: boolean;
  labelOffsets: number[];
  formatValue: (value: number) => string;
  labelStep: number;
}) {
  // 값이 없는 기간에서는 선을 끊어야 하므로 연속 구간별로 나눈다.
  const segments: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push({ index, value });
    }
  });
  if (current.length > 0) segments.push(current);

  return (
    <g className={colorClass}>
      {segments.map((segment, segmentIndex) => (
        <polyline
          key={segmentIndex}
          points={segment
            .map((point) => `${toX(point.index)},${toY(point.value)}`)
            .join(" ")}
          fill="none"
          strokeWidth={2}
          strokeDasharray={dashed ? "5 4" : undefined}
        />
      ))}
      {segments.flat().map((point) => (
        <g key={point.index}>
          <circle cx={toX(point.index)} cy={toY(point.value)} r={3.5} />
          {/* 점이 촘촘하면 수치는 일정 간격으로만 표시해 글자가 겹치지 않게 한다. */}
          {point.index % labelStep === 0 && (
            <text
              x={toX(point.index)}
              y={toY(point.value) + labelOffsets[point.index]}
              textAnchor="middle"
              className="text-[11px] font-medium"
            >
              {formatValue(point.value)}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}
