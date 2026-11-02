import React, { useState, useMemo } from 'react';
import { X, History, DollarSign, Receipt, Trash2, Calendar, User, Search, Filter } from 'lucide-react';

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getActionBadge(action) {
  switch (action) {
    case 'payment':
      return {
        icon: <DollarSign className="w-3.5 h-3.5 text-emerald-600" />,
        bg: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        label: 'Thanh toán',
      };
    case 'expense':
      return {
        icon: <Receipt className="w-3.5 h-3.5 text-indigo-600" />,
        bg: 'bg-indigo-50 border-indigo-200 text-indigo-800',
        label: 'Khoản chi',
      };
    case 'expense_delete':
      return {
        icon: <Trash2 className="w-3.5 h-3.5 text-rose-600" />,
        bg: 'bg-rose-50 border-rose-200 text-rose-800',
        label: 'Xóa chi tiêu',
      };
    default:
      return {
        icon: <History className="w-3.5 h-3.5 text-slate-600" />,
        bg: 'bg-slate-50 border-slate-200 text-slate-800',
        label: 'Hoạt động',
      };
  }
}

export default function ActivityLogModal({ isOpen, onClose, logs = [] }) {
  const [filterAction, setFilterAction] = useState('all'); // 'all' | 'payment' | 'expense' | 'expense_delete'
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchAction = filterAction === 'all' || log.action === filterAction;
      const term = searchTerm.trim().toLowerCase();
      const matchSearch =
        !term ||
        (log.user_name && log.user_name.toLowerCase().includes(term)) ||
        (log.content && log.content.toLowerCase().includes(term));
      return matchAction && matchSearch;
    });
  }, [logs, filterAction, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Nhật ký hoạt động</h3>
              <p className="text-xs text-slate-400">Minh bạch dòng tiền & thao tác trong phòng</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter Toolbar */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200/80 space-y-2 shrink-0">
          {/* Quick Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm theo tên người, nội dung, số tiền..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-800 placeholder-slate-400"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-0.5"
              >
                ✕
              </button>
            )}
          </div>

          {/* Action Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { id: 'all', label: 'Tất cả' },
              { id: 'payment', label: 'Thanh toán' },
              { id: 'expense', label: 'Khoản chi' },
              { id: 'expense_delete', label: 'Đã xóa' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterAction(tab.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  filterAction === tab.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content list */}
        <div className="p-4 overflow-y-auto space-y-2.5 flex-1 divide-y divide-slate-100">
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              {logs.length === 0
                ? 'Chưa có lịch sử hoạt động nào được ghi nhận.'
                : 'Không có hoạt động nào khớp với bộ lọc.'}
            </div>
          ) : (
            filteredLogs.map((log) => {
              const badge = getActionBadge(log.action);
              return (
                <div key={log.id} className="pt-2.5 first:pt-0 flex items-start gap-3">
                  <div className={`p-1.5 rounded-xl border shrink-0 mt-0.5 ${badge.bg}`}>
                    {badge.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs text-slate-900 truncate">
                        {log.user_name}
                      </span>
                      <span className="text-[11px] text-slate-400 shrink-0 font-medium">
                        {fmtTime(log.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed break-words">
                      {log.content}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500 font-medium pl-1">
            Hiển thị <span className="font-bold text-slate-700">{filteredLogs.length}</span> / {logs.length} hoạt động
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
