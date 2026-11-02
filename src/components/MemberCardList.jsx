import React, { useState } from 'react';
import {
  QrCode,
  CheckCircle2,
  XCircle,
  CircleDot,
  Users,
  HandCoins,
  AlertCircle,
  X,
  History,
  Loader2,
} from 'lucide-react';
import { formatMoney } from '../services/api';
import confetti from 'canvas-confetti';

export default function MemberCardList({
  memberCalculations = [],
  periodId = '',
  myMemberId = '',
  canTickSelf = false,
  canManageAll = false,
  onOpenQr,
  onTogglePaid,
  onRecordPayment,
  onSelectMember,
  onOpenLogs,
  saving = false,
}) {
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [busyId, setBusyId] = useState('');

  const requestToggle = (calc) => {
    const { member, totalAmount, paidAmount = 0, isPaid, isPartial } = calc;
    const amountToClear = isPaid ? paidAmount : (isPartial ? (totalAmount - paidAmount) : totalAmount);
    
    // Mở popup yêu cầu nhập đúng số tiền cần xoá nợ / thanh toán để xác nhận
    setConfirmDialog({
      memberId: member.id,
      memberName: member.nickname || member.name,
      totalAmount,
      currentPaid: isPaid,
      targetAmount: amountToClear,
      isCancelPaid: isPaid,
    });
    setConfirmInput('');
    setConfirmError('');
  };

  const handleConfirmSubmit = async (e) => {
    e.preventDefault();
    if (!confirmDialog) return;
    const num = parseInt(confirmInput.replace(/\D/g, ''), 10) || 0;
    if (num !== confirmDialog.targetAmount) {
      setConfirmError(`Số tiền nhập không khớp! Hãy nhập chính xác ${confirmDialog.targetAmount.toLocaleString('vi-VN')}`);
      return;
    }

    const nextPaid = !confirmDialog.currentPaid;
    const { memberId, totalAmount } = confirmDialog;
    setBusyId(memberId);
    try {
      const res = await onTogglePaid(periodId, memberId, nextPaid, nextPaid ? totalAmount : 0);
      if (res?.success) {
        if (nextPaid) {
          confetti({
            particleCount: 40,
            spread: 60,
            origin: { y: 0.8 },
          });
        }
        setConfirmDialog(null);
      }
    } finally {
      setBusyId('');
    }
  };

  const handleToggle = (memberId, totalAmount, currentPaid) => {
    const nextPaid = !currentPaid;
    // Nộp đủ -> ghi đủ tổng; bỏ nộp -> về 0; đang trả dở bấm -> thu nốt cho đủ
    onTogglePaid(periodId, memberId, nextPaid, nextPaid ? totalAmount : 0);
    if (nextPaid) {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.8 },
      });
    }
  };

  return (
    <div className="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-sm space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
          <Users className="w-4 h-4 text-indigo-600 stroke-[2.5]" />
          <span>Thành viên ({memberCalculations.length})</span>
        </div>
        {onOpenLogs && (
          <button
            onClick={onOpenLogs}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 text-[11px] font-semibold transition-colors"
            title="Xem nhật ký giao dịch tiền & chi tiêu"
          >
            <History className="w-3.5 h-3.5" />
            <span>Lịch sử thu/chi</span>
          </button>
        )}
      </div>

      {/* Compact Member Rows */}
      <div className="divide-y divide-slate-100">
        {memberCalculations.map((calc) => {
          const { member, sharedAmount, sharedItems = [], personalTotal, personalItems, totalAmount, paidAmount = 0, remaining = 0, isPartial, isPaid } = calc;
          // member chỉ tick được dòng của mình; manager+ tick được mọi dòng.
          const canActRow = canManageAll || (canTickSelf && member.id === myMemberId);

          return (
            <div
              key={member.id}
              onClick={() => onSelectMember && onSelectMember(calc)}
              className={`py-2 px-2 rounded-xl flex items-center justify-between gap-2.5 transition-colors cursor-pointer ${
                isPaid ? 'bg-emerald-50/30' : 'hover:bg-slate-50'
              }`}
            >
              {/* Left: Avatar & Info */}
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                    isPaid
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-indigo-100 text-indigo-800'
                  }`}
                >
                  {(member.nickname || member.name || 'M').charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <h3 className="font-bold text-sm text-slate-900 truncate">
                      {member.name}
                    </h3>
                    {member.nickname && (
                      <span className="text-xs font-semibold text-slate-500">
                        ({member.nickname})
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] font-semibold text-slate-500 truncate flex items-center gap-1.5">
                    <span>
                      Chung: {formatMoney(sharedAmount)}
                      {sharedItems.length > 0 && (
                        <span className="text-slate-400"> ({sharedItems.length} khoản)</span>
                      )}
                    </span>
                    {personalTotal > 0 && (
                      <span className="text-rose-600 font-bold">• Riêng: +{formatMoney(personalTotal)}</span>
                    )}
                  </div>
                  {/* Tiến độ trả góp */}
                  {isPartial && (
                    <div className="mt-1 space-y-0.5">
                      <div className="text-[11px] font-bold text-amber-700">
                        Đã trả {formatMoney(paidAmount)} • còn {formatMoney(remaining)}
                      </div>
                      <div className="w-full max-w-[160px] bg-slate-100 h-1 rounded-full overflow-hidden">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all"
                          style={{
                            width: `${totalAmount > 0 ? Math.min(100, Math.round((paidAmount / totalAmount) * 100)) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Amount & Action Icons (bấm nút không mở chi tiết) */}
              <div
                className="flex items-center gap-2 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-right">
                  <span className="font-extrabold text-sm sm:text-base text-slate-900 block leading-tight">
                    {formatMoney(totalAmount)}
                  </span>
                </div>

                {/* Status Toggle Icon Button */}
                {canActRow && (
                  <>
                <button
                  onClick={() => requestToggle(calc)}
                  disabled={saving}
                  className={`p-1.5 rounded-xl transition-all disabled:opacity-50 ${
                    isPaid
                      ? 'text-emerald-600 bg-emerald-100/70 hover:bg-emerald-200'
                      : isPartial
                        ? 'text-amber-600 bg-amber-100/70 hover:bg-amber-200'
                        : 'text-rose-500 bg-rose-50 hover:bg-rose-100'
                  }`}
                  title={
                    isPaid
                      ? 'Bấm để đổi thành: Chưa nộp (về 0)'
                      : isPartial
                        ? `Đang trả dở (${formatMoney(paidAmount)}). Bấm để thu nốt cho đủ`
                        : 'Bấm để đổi thành: Đã nộp đủ'
                  }
                >
                  {isPaid ? (
                    <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                  ) : isPartial ? (
                    <CircleDot className="w-4 h-4 stroke-[2.5]" />
                  ) : (
                    <XCircle className="w-4 h-4 stroke-[2.5]" />
                  )}
                </button>

                {/* Record Partial Payment Button */}
                <button
                  onClick={() => onRecordPayment && onRecordPayment(calc)}
                  disabled={saving}
                  className="p-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-all active:scale-95 disabled:opacity-50"
                  title="Ghi nhận thu từng phần"
                >
                  <HandCoins className="w-4 h-4 stroke-[2.5]" />
                </button>
                  </>
                )}

                {/* VietQR Icon Button */}
                <button
                  onClick={() => onOpenQr(calc)}
                  className="p-1.5 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-all active:scale-95"
                  title="Mở mã VietQR chuyển khoản"
                >
                  <QrCode className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>
          );
        })}
            {/* Modal xác nhận nhập số tiền để xóa nợ / thanh toán */}
      {confirmDialog && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
          onClick={() => { if (busyId === '') setConfirmDialog(null); }}
        >
          <div 
            className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl border border-slate-100 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  confirmDialog.isCancelPaid ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-600"
                }`}>
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900">
                    {confirmDialog.isCancelPaid ? "Xác nhận hủy thanh toán" : "Xác nhận xóa hết nợ"}
                  </h4>
                  <p className="text-[11px] text-slate-500">{confirmDialog.memberName}</p>
                </div>
              </div>
              <button
                onClick={() => setConfirmDialog(null)}
                disabled={busyId !== ''}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmSubmit} className="space-y-3">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                <p>
                  {confirmDialog.isCancelPaid ? "Số tiền sẽ hủy về 0 ₫:" : "Số tiền nợ sẽ xóa trắng:"}
                </p>
                <p className="text-base font-extrabold text-indigo-600">
                  {formatMoney(confirmDialog.targetAmount)}
                </p>
                <p className="text-[10px] text-slate-400">
                  Để tránh bấm nhầm làm xóa trắng nợ, hãy nhập chính xác số tiền trên để xác nhận.
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
                  placeholder={String(confirmDialog.targetAmount)}
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
                  onClick={() => setConfirmDialog(null)}
                  disabled={busyId !== ''}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busyId === confirmDialog.memberId || saving}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white rounded-xl shadow-sm transition-colors disabled:opacity-50 ${
                    confirmDialog.isCancelPaid
                      ? "bg-rose-600 hover:bg-rose-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {busyId === confirmDialog.memberId ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Đang lưu…
                    </>
                  ) : (
                    confirmDialog.isCancelPaid ? "Xác nhận hủy nộp" : "Xác nhận xóa nợ"
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
