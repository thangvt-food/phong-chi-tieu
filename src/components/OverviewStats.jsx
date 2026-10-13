import React from 'react';
import { DollarSign, Users, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatMoney } from '../services/api';

export default function OverviewStats({
  totalAllExpenses,
  sharedPerMember,
  paidCount,
  partialCount = 0,
  totalMembers,
  totalCollected,
  remaining,
}) {
  const percentPaid =
    totalAllExpenses > 0 ? Math.round((totalCollected / totalAllExpenses) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-sm space-y-2.5">
      {/* 4 Metrics in tight grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {/* Total */}
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-slate-600 text-xs font-semibold">
            <DollarSign className="w-3.5 h-3.5 text-indigo-600 stroke-[2.5]" />
            <span>Tổng chi</span>
          </div>
          <span className="text-sm sm:text-base font-extrabold text-slate-900 mt-1">
            {formatMoney(totalAllExpenses)}
          </span>
        </div>

        {/* Shared per person */}
        <div className="p-2 rounded-xl bg-indigo-50/50 border border-indigo-100 flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-indigo-800 text-xs font-semibold">
            <Users className="w-3.5 h-3.5 text-indigo-600 stroke-[2.5]" />
            <span>Bình quân/người</span>
          </div>
          <span className="text-sm sm:text-base font-extrabold text-indigo-950 mt-1">
            {formatMoney(sharedPerMember)}
          </span>
        </div>

        {/* Collected */}
        <div className="p-2 rounded-xl bg-emerald-50/50 border border-emerald-100 flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-800 text-xs font-semibold">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
              <span>Đã thu</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-bold bg-emerald-100 px-1.5 py-0.2 rounded">
                {paidCount}/{totalMembers}
              </span>
              {partialCount > 0 && (
                <span
                  className="text-[11px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded"
                  title="Số người đang trả dở"
                >
                  +{partialCount} dở
                </span>
              )}
            </div>
          </div>
          <span className="text-sm sm:text-base font-extrabold text-emerald-900 mt-1">
            {formatMoney(totalCollected)}
          </span>
        </div>

        {/* Remaining */}
        <div className="p-2 rounded-xl bg-rose-50/50 border border-rose-100 flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-rose-800 text-xs font-semibold">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 stroke-[2.5]" />
            <span>Còn thiếu</span>
          </div>
          <span className="text-sm sm:text-base font-extrabold text-rose-900 mt-1">
            {formatMoney(remaining)}
          </span>
        </div>
      </div>

      {/* Slim progress bar */}
      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
        <div
          className="bg-indigo-600 h-full rounded-full transition-all duration-300"
          style={{ width: `${percentPaid}%` }}
        />
      </div>
    </div>
  );
}
