import React from 'react';
import {
  Home,
  Zap,
  Droplets,
  Wifi,
  Trash2,
  ShoppingBag,
  UserCheck,
  Plus,
  Edit2,
  Receipt,
} from 'lucide-react';
import { formatMoney, describeSplit, parseSplitConfig } from '../services/api';
import { EXPENSE_CATEGORIES } from '../constants/banks';

const ICON_MAP = {
  dien: Zap,
  nuoc_uong: Droplets,
  phong: Home,
  mang: Wifi,
  rac: Trash2,
  rieng: UserCheck,
  khac: ShoppingBag,
};

export default function ExpenseList({
  expenses = [],
  members = [],
  canManage = false,
  onAddExpense,
  onEditExpense,
  onDeleteExpense,
}) {
  return (
    <div className="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-sm space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
          <Receipt className="w-4 h-4 text-indigo-600 stroke-[2.5]" />
          <span>Khoản chi ({expenses.length})</span>
        </div>
        {canManage && (
          <button
            onClick={onAddExpense}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-sm transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Thêm</span>
          </button>
        )}
      </div>

      {/* Expenses Rows */}
      {expenses.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-xs font-medium">
          Chưa có khoản chi trong kỳ này.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {expenses.map((exp) => {
            const cat =
              EXPENSE_CATEGORIES.find((c) => c.key === exp.category) ||
              EXPENSE_CATEGORIES[6];
            const IconComponent = ICON_MAP[exp.category] || ShoppingBag;

            const targetMember = exp.target_member_id
              ? members.find((m) => m.id === exp.target_member_id)
              : null;

            const dateDisplay = exp.expense_date
              ? exp.expense_date.split('-').slice(1).reverse().join('/')
              : '';

            return (
              <div
                key={exp.id}
                className="py-2 px-2 rounded-xl flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors"
              >
                {/* Left: Icon & Title */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${cat.color}`}
                  >
                    <IconComponent className="w-3.5 h-3.5" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="text-xs font-bold text-slate-900 truncate">
                        {exp.title}
                      </h4>
                      {targetMember && (
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 shrink-0">
                          {targetMember.nickname || targetMember.name}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5 mt-0.5">
                      {dateDisplay && <span>{dateDisplay}</span>}
                      {exp.note && <span className="truncate max-w-[140px] sm:max-w-xs">• {exp.note}</span>}
                    </div>
                    {(() => {
                      const cfg = parseSplitConfig(exp);
                      const isCustom = cfg.mode !== 'all' && !exp.target_member_id;
                      if (!isCustom) return null;
                      return (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-md px-1.5 py-0.5 max-w-full">
                          <span className="truncate">{describeSplit(exp, members)}</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Right: Amount & Edit/Delete Icons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-extrabold text-xs sm:text-sm text-slate-900">
                    {formatMoney(exp.amount)}
                  </span>

                  <button
                    onClick={() => onEditExpense(exp)}
                    className={`p-1 text-slate-400 hover:text-indigo-600 transition-colors ${canManage ? '' : 'hidden'}`}
                    title="Sửa"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteExpense(exp.id)}
                    className={`p-1 text-slate-400 hover:text-rose-600 transition-colors ${canManage ? '' : 'hidden'}`}
                    title="Xóa"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
