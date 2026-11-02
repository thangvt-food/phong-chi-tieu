import React, { useState, useEffect } from 'react';
import { X, HandCoins, RotateCcw, Loader2 } from 'lucide-react';
import { formatMoney } from '../services/api';
import { useFeedback } from './Feedback';

export default function PaymentModal({ isOpen, onClose, calc, onConfirm, saving = false }) {
  // NOTE: hook phải chạy trước mọi `return` (Rules of Hooks).
  const { toast, askConfirm } = useFeedback();
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setInput(calc && calc.remaining > 0 ? String(calc.remaining) : '');
    }
  }, [isOpen, calc]);

  if (!isOpen || !calc) return null;

  const { member, totalAmount = 0, paidAmount = 0, remaining = 0 } = calc;

  const submit = async (newPaid) => {
    setPending(true);
    try {
      const res = await onConfirm(newPaid);
      if (res?.success) onClose();
    } finally {
      setPending(false);
    }
  };

  const handleConfirm = () => {
    const add = parseInt(input) || 0;
    if (add <= 0) {
      toast.error('Vui lòng nhập số tiền đã thu (lớn hơn 0)!');
      return;
    }
    if (totalAmount <= 0) {
      toast.error('Thành viên này không nợ gì trong kỳ này!');
      return;
    }
    // Cộng dồn, chặn trần ở tổng phải nộp (không thu thừa)
    const newPaid = Math.min(totalAmount, paidAmount + add);
    return submit(newPaid);
  };

  const handleReset = async () => {
    if (
      await askConfirm({
        title: 'Về 0 ₫',
        message: `Xóa lịch sử đã trả của ${member.nickname || member.name}? (về 0 ₫)`,
        confirmLabel: 'Xóa lịch sử',
        danger: true,
      })
    ) {
      return submit(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-slate-100 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-emerald-600 flex items-center justify-center">
              <HandCoins className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Ghi nhận thanh toán</h3>
              <p className="text-xs font-semibold text-emerald-300">{member.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={pending}
            className="p-1 rounded-full text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Totals */}
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Phải nộp</div>
              <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                {formatMoney(totalAmount)}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="text-[11px] font-bold text-emerald-700 uppercase">Đã trả</div>
              <div className="text-xs font-extrabold text-emerald-900 mt-0.5">
                {formatMoney(paidAmount)}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-rose-50 border border-rose-200">
              <div className="text-[11px] font-bold text-rose-700 uppercase">Còn lại</div>
              <div className="text-xs font-extrabold text-rose-900 mt-0.5">
                {formatMoney(remaining)}
              </div>
            </div>
          </div>

          {/* Progress */}
          {totalAmount > 0 && (
            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.round((paidAmount / totalAmount) * 100))}%` }}
              />
            </div>
          )}

          {/* Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Số tiền thu thêm đợt này:
            </label>
            <input
              type="number"
              min="0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="VD: 100000"
              autoFocus
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-base font-extrabold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => setInput(String(remaining))}
                className="mt-1 text-xs font-bold text-emerald-700 hover:underline"
              >
                Thu hết còn lại ({formatMoney(remaining)})
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100">
            {paidAmount > 0 ? (
              <button
                type="button"
                onClick={handleReset}
                disabled={pending || saving}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors disabled:opacity-50"
              >
                {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Về 0
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending || saving}
                className="flex items-center gap-1.5 px-5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-colors disabled:opacity-50"
              >
                {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {pending ? 'Đang ghi…' : 'Thu thêm'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
