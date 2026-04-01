"use client";

import { MarkupTool, MarkupStyle } from "@/lib/types";

export const PLAN_SCALES: { label: string; feetPerInch: number }[] = [
  { label: '1"=10\'', feetPerInch: 10 },
  { label: '1"=20\'', feetPerInch: 20 },
  { label: '1"=30\'', feetPerInch: 30 },
  { label: '1"=40\'', feetPerInch: 40 },
  { label: '1"=50\'', feetPerInch: 50 },
  { label: '1"=100\'', feetPerInch: 100 },
  { label: '1"=200\'', feetPerInch: 200 },
];

const COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#000000', // black
  '#ffffff', // white
];

const TOOLS: { id: MarkupTool; icon: string; title: string }[] = [
  { id: 'none',      icon: '↖',  title: 'Select / Pan' },
  { id: 'rectangle', icon: '▭',  title: 'Rectangle' },
  { id: 'circle',    icon: '○',  title: 'Circle' },
  { id: 'line',      icon: '∕',  title: 'Line (drag)' },
  { id: 'polyline',  icon: '〜', title: 'Polyline (click pts, dbl-click finish)' },
  { id: 'measure',   icon: '⟺', title: 'Measure (click pts, dbl-click finish)' },
];

interface Props {
  activeTool: MarkupTool;
  onToolChange: (tool: MarkupTool) => void;
  style: MarkupStyle;
  onStyleChange: (partial: Partial<MarkupStyle>) => void;
  measureUnit: 'ft' | 'm';
  onMeasureUnitChange: (unit: 'ft' | 'm') => void;
  planScale: string;
  onPlanScaleChange: (scale: string) => void;
  onClearMarkup: () => void;
}

export default function MarkupToolbox({
  activeTool,
  onToolChange,
  style,
  onStyleChange,
  measureUnit,
  onMeasureUnitChange,
  planScale,
  onPlanScaleChange,
  onClearMarkup,
}: Props) {
  const hasFill = activeTool === 'rectangle' || activeTool === 'circle';
  const showStyle = activeTool !== 'none';
  const showMeasure = activeTool === 'measure';

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[600] pointer-events-none">
      <div className="pointer-events-auto bg-white/95 backdrop-blur rounded-xl shadow-xl border border-gray-200 px-2 py-2 flex flex-col gap-2 min-w-max">

        {/* Tool row */}
        <div className="flex gap-1 items-center">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={t.title}
              onClick={() => onToolChange(activeTool === t.id && t.id !== 'none' ? 'none' : t.id)}
              className={[
                'w-9 h-9 rounded-lg text-base font-medium transition-colors leading-none',
                activeTool === t.id
                  ? 'bg-orange-500 text-white shadow-inner'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
              ].join(' ')}
            >
              {t.icon}
            </button>
          ))}
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <button
            title="Clear all markup"
            onClick={onClearMarkup}
            className="w-9 h-9 rounded-lg text-sm bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            🗑
          </button>
        </div>

        {/* Style row */}
        {showStyle && (
          <div className="flex gap-2 items-center flex-wrap">
            {/* Color swatches */}
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  title={c}
                  onClick={() => onStyleChange({ color: c })}
                  className="w-5 h-5 rounded-full transition-transform"
                  style={{
                    background: c,
                    border: style.color === c ? '2px solid #f97316' : '2px solid #d1d5db',
                    transform: style.color === c ? 'scale(1.2)' : 'scale(1)',
                  }}
                />
              ))}
            </div>

            <div className="w-px h-5 bg-gray-200" />

            {/* Line widths */}
            {([1, 2, 3, 5] as const).map((w) => (
              <button
                key={w}
                title={`${w}px`}
                onClick={() => onStyleChange({ lineWidth: w })}
                className={[
                  'w-8 h-8 rounded flex items-center justify-center transition-colors',
                  style.lineWidth === w ? 'bg-orange-100' : 'hover:bg-gray-100',
                ].join(' ')}
              >
                <div
                  className="rounded-full"
                  style={{
                    background: style.lineWidth === w ? '#f97316' : '#374151',
                    height: `${Math.min(w + 1, 6)}px`,
                    width: '18px',
                  }}
                />
              </button>
            ))}

            {/* Fill opacity — only for rect / circle */}
            {hasFill && (
              <>
                <div className="w-px h-5 bg-gray-200" />
                <select
                  value={style.fillOpacity}
                  onChange={(e) => onStyleChange({ fillOpacity: parseFloat(e.target.value) })}
                  className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white"
                >
                  <option value="0">No fill</option>
                  <option value="0.1">10% fill</option>
                  <option value="0.2">20% fill</option>
                  <option value="0.3">30% fill</option>
                  <option value="0.5">50% fill</option>
                </select>
              </>
            )}
          </div>
        )}

        {/* Measure options */}
        {showMeasure && (
          <div className="flex gap-2 items-center text-xs text-gray-600">
            <span className="font-medium">Unit:</span>
            {(['ft', 'm'] as const).map((u) => (
              <button
                key={u}
                onClick={() => onMeasureUnitChange(u)}
                className={[
                  'px-2 py-0.5 rounded font-medium transition-colors',
                  measureUnit === u
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 hover:bg-gray-200',
                ].join(' ')}
              >
                {u}
              </button>
            ))}
            <span className="font-medium ml-2">Scale:</span>
            <select
              value={planScale}
              onChange={(e) => onPlanScaleChange(e.target.value)}
              className="border border-gray-200 rounded px-1.5 py-0.5 bg-white"
            >
              {PLAN_SCALES.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
