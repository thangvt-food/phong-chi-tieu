import React, { useState } from 'react';
import {
  X,
  QrCode,
  CheckCircle2,
  XCircle,
  CircleDot,
  HandCoins,
  Loader2,
  Users,
  UserCheck,
  EyeOff,
  AlertCircle,
} from 'lucide-react';
import { formatMoney, describeSplit } from '../services/api';

function fmtDate(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  return p.length >= 3 ? `${p[2]}/${p[1]}` : iso;
}

export default function MemberDetailModal({
  isOpen,
  onClose,
  calc,
  members = [],
  sharedExpenses = [],
  canAct = false,
  onOpenQr,
  onTogglePaid,
  onRecordPayment,
  saving = false,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [pending, setPending] = useState(false);

  if (!isOpen || !calc) return null;

  const {
    member,
    sharedAmount = 0,
    sharedItems = [],
    personalTotal = 0,
    personalItems = [],
    totalAmount = 0,
    paidAmount = 0,
    remaining = 0,
    isPartial,
    isPaid,
  } = calc;

  const targetAmount = isPaid ? paidAmount : (isPartial ? (totalAmount - paidAmount) : totalAmount);

  const handleConfirmSubmit = async (e) => {
    e.preventDefault();
    const num = parseInt(confirmInput.replace(/\D/g, ''), 10) || 0;
    if (num !== targetAmount) {
      setConfirmError(`Số tiền không khớp! Hãy nhập chính xác ${targetAmount.toLocaleString('vi-VN')}`);
      return;
    }
    setPending(true);
    try {
      const res = await onTogglePaid(calc);
      if (res?.success) setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  };

  const joinedIds = new Set(sharedItems.map((s) => s.expense.id));
  const skipped = (sharedExpenses || []).filter((e) => !joinedIds.has(e.id));

  const statusPill = isPaid ? (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
      Đã nộp đủ
    </span>
  ) : isPartial ? (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
      Trả dở {formatMoney(paidAmount)}/{formatMoney(totalAmount)}
    </span>
  ) : (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
      Chưa nộp
    </span>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                isPaid ? 'bg-emerald-500 text-white' : 'bg-indigo-500 text-white'
              }`}
            >
              {(member.nickname || member.name || 'M').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm truncate">
                {member.name}
                {member.nickname ? ` (${member.nickname})` : ''}
              </h3>
              <div className="mt-0.5">{statusPill}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-3">
          {/* Tổng + tiến độ */}
          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-600">Tổng phải nộp:</span>
              <span className="font-extrabold text-base text-slate-900">
                {formatMoney(totalAmount)}
              </span>
            </div>
            {(isPartial || isPaid) && totalAmount > 0 && (
              <div className="mt-1.5">
                <div className="flex justify-between text-[11px] font-bold text-slate-600 mb-1">
                  <span className="text-emerald-700">Đã trả {formatMoney(paidAmount)}</span>
                  <span className="text-rose-700">Còn {formatMoney(remaining)}</span>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isPaid ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    style={{
                      width: `${Math.min(100, Math.round((paidAmount / totalAmount) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tiền chung từng khoản */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              Tiền chung ({sharedItems.length} khoản • {formatMoney(sharedAmount)})
            </h4>
            {sharedItems.length === 0 ? (
              <p className="text-[11px] text-slate-400 font-medium">
                Không tham gia khoản chung nào kỳ này.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
                {sharedItems.map(({ expense, share }) => (
                  <div key={expense.id} className="py-2 px-2.5 bg-white">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 truncate">
                        {expense.title}
                      </span>
                      <span className="text-xs font-extrabold text-slate-900 shrink-0">
                        {formatMoney(share)}
                      </span>
                    </div>
                    <div className="text-[10px] font-semibold text-slate-400 truncate mt-0.5">
                      {fmtDate(expense.expense_date)}
                      {expense.expense_date ? ' • ' : ''}
                      {describeSplit(expense, members)} • bill {formatMoney(expense.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tiền riêng */}
          {personalItems.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-rose-600" />
                Tiền riêng ({personalItems.length} khoản • +{formatMoney(personalTotal)})
              </h4>
              <div className="divide-y divide-rose-100 rounded-2xl border border-rose-200 overflow-hidden">
                {personalItems.map((item) => (
                  <div key={item.id} className="py-2 px-2.5 bg-rose-50/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 truncate">
                        {item.title}
                      </span>
                      <span className="text-xs font-extrabold text-rose-700 shrink-0">
                        +{formatMoney(item.amount)}
                      </span>
                    </div>
                    {(item.expense_date || item.note) && (
                      <div className="text-[10px] font-semibold text-slate-400 truncate mt-0.5">
                        {fmtDate(item.expense_date)}
                        {item.expense_date && item.note ? ' • ' : ''}
                        {item.note || ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Không tham gia */}
          {skipped.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5" />
                Không tham gia ({skipped.length} khoản)
              </h4>
              <div className="divide-y divide-slate-100 rounded-2xl border border-dashed border-slate-200 overflow-hidden">
                {skipped.map((e) => (
                  <div key={e.id} className="py-1.5 px-2.5 bg-slate-50/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-400 truncate">
                        {e.title}
                      </span>
                      <span className="text-[11px] font-bold text-slate-300 shrink-0 line-through">
                        {formatMoney(e.amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-1.5 shrink-0">
          {canAct ? (
            <button
              onClick={() => { setConfirmOpen(true); setConfirmInput(''); setConfirmError(''); }}
              disabled={saving}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 ${
                isPaid
                  ? 'text-emerald-700 bg-emerald-100 hover:bg-emerald-200'
                  : isPartial
                    ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                    : 'text-rose-600 bg-rose-100 hover:bg-rose-200'
              }`}
            >
              {isPaid ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : isPartial ? (
                <CircleDot className="w-3.5 h-3.5" />
              ) : (
                <XCircle className="w-3.5 h-3.5" />
              )}
              <span>{isPaid ? 'Đã nộp (bấm để hủy)' : isPartial ? 'Thu nốt cho đủ' : 'Đánh dấu đã nộp'}</span>
            </button>
          ) : (
            <span className="text-[11px] font-semibold text-slate-400">
              Bạn không có quyền đổi trạng thái nộp
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {canAct && (
              <button
                onClick={() => onRecordPayment && onRecordPayment(calc)}
                disabled={saving}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 bg-white border border-emerald-200 rounded-xl hover:bg-emerald-50 transition-all active:scale-95 disabled:opacity-50"
              >
                <HandCoins className="w-3.5 h-3.5" /> Thu góp
              </button>
            )}
            <button
              onClick={() => onOpenQr && onOpenQr(calc)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all active:scale-95"
            >
              <QrCode className="w-3.5 h-3.5" /> QR
            </button>
          </div>
        </div>
            {/* Modal xác nhận nhập số tiền */}
      {confirmOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
          onClick={() => { if (!pending) setConfirmOpen(false); }}
        >
          <div 
            className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl border border-slate-100 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  isPaid ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-600"
                }`}>
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900">
                    {isPaid ? "Xác nhận hủy thanh toán" : "Xác nhận xóa hết nợ"}
                  </h4>
                  <p className="text-[11px] text-slate-500">{member.name}</p>
                </div>
              </div>
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmSubmit} className="space-y-3">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                <p>{isPaid ? "Số tiền sẽ hủy về 0 ₫:" : "Số tiền nợ sẽ xóa trắng:"}</p>
                <p className="text-base font-extrabold text-indigo-600">{formatMoney(targetAmount)}</p>
                <p className="text-[10px] text-slate-400">
                  Nhập chính xác số tiền trên để xác nhận thao tác.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nhập số tiền xác nhận:
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={confirmInput}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "");
                    setConfirmInput(raw ? Number(raw).toLocaleString("vi-VN") : "");
                    setConfirmError("");
                  }}
                  placeholder={String(targetAmount)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                />
              </div>

              {confirmError && (
                <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{confirmError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={pending}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={pending || saving}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white rounded-xl shadow-sm transition-colors disabled:opacity-50 ${
                    isPaid ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {pending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Đang lưu…
                    </>
                  ) : (
                    isPaid ? "Xác nhận hủy nộp" : "Xác nhận xóa nợ"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
