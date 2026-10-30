import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Building2,
  User,
  CreditCard,
  ExternalLink,
  Download,
  Loader2,
} from 'lucide-react';
import { formatMoney, generateVietQrUrl, defaultTransferCode } from '../services/api';
import { VIETNAM_BANKS } from '../constants/banks';

export default function VietQrModal({
  isOpen,
  onClose,
  calculation,
  settings = {},
  periodTitle = '',
  roomId = '',
}) {
  // NOTE: hook phải chạy trước mọi `return` (Rules of Hooks).
  const [copiedField, setCopiedField] = useState(null);
  const [downloading, setDownloading] = useState(false);

  if (!isOpen || !calculation) return null;

  const { member, sharedAmount, sharedItems = [], personalItems = [], totalAmount, paidAmount = 0, remaining } = calculation;

  const bank = VIETNAM_BANKS.find((b) => b.code === settings.bank_id) || {
    name: settings.bank_id || 'Ngân hàng',
    code: settings.bank_id || 'MB',
  };

  const removeAccents = (str) => {
    return (str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toUpperCase();
  };

  const memberIdentifier = member.nickname || member.name;
  const cleanPrefix = removeAccents(settings.transfer_prefix || 'TIEN PHONG');
  // Mã phòng đứng trước tên người: nhiều phòng dùng chung một STK thì sao kê ngân
  // hàng chỉ phân biệt được nhờ nó.
  const cleanCode = removeAccents(settings.transfer_code || defaultTransferCode(roomId));
  const cleanMember = removeAccents(memberIdentifier);
  const cleanPeriod = removeAccents(periodTitle.replace(/Tháng\s*/i, 'T'));
  const transferContent = `${cleanPrefix} ${cleanCode} ${cleanMember} ${cleanPeriod}`
    .replace(/\s+/g, ' ')
    .trim();

  // Thu đúng số còn thiếu (hỗ trợ trả góp từng phần)
  const amountDue = remaining !== undefined && remaining !== null ? remaining : totalAmount;

  const qrUrl = generateVietQrUrl({
    bankId: settings.bank_id,
    accountNo: settings.account_no,
    accountName: settings.account_name,
    amount: amountDue,
    content: transferContent,
  });

  const handleCopy = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleDownload = async () => {
    if (!qrUrl) return;
    setDownloading(true);
    try {
      const response = await fetch(qrUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const cleanName = removeAccents(memberIdentifier).replace(/\s+/g, '_');
      link.download = `VietQR_${cleanName}_${amountDue}d.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      window.open(qrUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-bold text-sm">Mã VietQR Chuyển Khoản</h3>
            <p className="text-[11px] font-semibold text-indigo-300">{member.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 overflow-y-auto space-y-3">
          {/* QR Image Box */}
          <div className="flex flex-col items-center justify-center p-2.5 bg-slate-50 rounded-2xl border border-slate-200">
            {qrUrl ? (
              <img
                src={qrUrl}
                alt="VietQR"
                className="w-52 h-auto rounded-xl shadow-sm bg-white p-1.5 border border-slate-200"
                loading="eager"
              />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center text-slate-400 text-xs">
                Chưa có cấu hình STK
              </div>
            )}

            {/* Quick Download Button directly under QR */}
            {qrUrl && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="mt-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                )}
                <span>{downloading ? 'Đang tải...' : 'Tải mã QR'}</span>
              </button>
            )}
          </div>

          {/* Bill Breakdown */}
          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
            <div className="flex justify-between text-slate-600 font-medium">
              <span>Chung phòng ({sharedItems.length} khoản):</span>
              <span className="font-bold text-slate-800">{formatMoney(sharedAmount)}</span>
            </div>
            {sharedItems.map(({ expense, share }) => (
              <div key={expense.id} className="flex justify-between text-[11px] text-slate-500 font-medium pl-2">
                <span className="truncate mr-2">• {expense.title}:</span>
                <span className="shrink-0 font-semibold">{formatMoney(share)}</span>
              </div>
            ))}
            {personalItems.map((item) => (
              <div key={item.id} className="flex justify-between text-[11px] text-rose-700 font-semibold pl-2">
                <span>• {item.title}:</span>
                <span>+{formatMoney(item.amount)}</span>
              </div>
            ))}
            <div className="pt-1 border-t border-slate-200 space-y-0.5">
              <div className="flex justify-between items-center text-[11px] font-semibold text-slate-600">
                <span>Tổng phải nộp:</span>
                <span>{formatMoney(totalAmount)}</span>
              </div>
              {paidAmount > 0 && (
                <div className="flex justify-between items-center text-[11px] font-semibold text-emerald-700">
                  <span>Đã trả trước:</span>
                  <span>-{formatMoney(paidAmount)}</span>
                </div>
              )}
              <div className="flex justify-between items-center font-extrabold text-sm text-slate-900">
                <span>Còn phải chuyển:</span>
                <span className="text-indigo-600 text-base">{formatMoney(amountDue)}</span>
              </div>
            </div>
          </div>

          {/* Account Details & Quick Copy */}
          <div className="space-y-1.5 text-xs">
            {/* Account Number */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-slate-600 font-semibold flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5 text-indigo-600" /> STK:
              </span>
              <div className="flex items-center gap-1.5">
                <strong className="font-mono text-xs font-extrabold text-slate-900">
                  {settings.account_no} ({bank.code})
                </strong>
                <button
                  onClick={() => handleCopy(settings.account_no, 'account_no')}
                  className="p-1 rounded-md text-slate-500 hover:text-indigo-600 hover:bg-slate-200"
                  title="Sao chép STK"
                >
                  {copiedField === 'account_no' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Account Holder */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-slate-600 font-semibold flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-indigo-600" /> Chủ TK:
              </span>
              <span className="font-bold text-slate-900 uppercase">
                {settings.account_name}
              </span>
            </div>

            {/* Transfer Content */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-slate-600 font-semibold">Nội dung:</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-slate-800 text-[11px] bg-white px-1.5 py-0.5 rounded border border-slate-200">
                  {transferContent}
                </span>
                <button
                  onClick={() => handleCopy(transferContent, 'content')}
                  className="p-1 rounded-md text-slate-500 hover:text-indigo-600 hover:bg-slate-200"
                  title="Sao chép nội dung"
                >
                  {copiedField === 'content' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
              )}
              <span>Tải về</span>
            </button>
            <a
              href={qrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
              title="Mở ảnh gốc"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-200 hover:bg-slate-300 rounded-xl transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
