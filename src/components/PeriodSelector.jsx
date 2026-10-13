import React from 'react';
import { Calendar, CheckCircle2, Clock } from 'lucide-react';

export default function PeriodSelector({
  periods = [],
  selectedPeriodId,
  onSelectPeriod,
}) {
  const currentPeriod = periods.find((p) => p.id === selectedPeriodId) || periods[0];

  return (
    <div className="flex items-center justify-between gap-2 overflow-x-auto py-1 scrollbar-none">
      {/* Month Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        {periods.map((p) => {
          const isSelected = p.id === selectedPeriodId;
          return (
            <button
              key={p.id}
              onClick={() => onSelectPeriod(p.id)}
              className={`px-3 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                isSelected
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {p.title}
            </button>
          );
        })}
      </div>

      {/* Status icon */}
      {currentPeriod && (
        <div className="shrink-0">
          {currentPeriod.status === 'completed' ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold"
              title="Đã hoàn thành"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
              <span className="hidden sm:inline">Hoàn tất</span>
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 text-[11px] font-bold"
              title="Đang thu tiền"
            >
              <Clock className="w-3.5 h-3.5 text-amber-600 stroke-[2.5]" />
              <span className="hidden sm:inline">Đang thu</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
