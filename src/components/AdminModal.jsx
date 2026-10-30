import React, { useState, useEffect } from 'react';
import { X, Lock, Key, AlertCircle, CheckCircle2, Hash } from 'lucide-react';
import { sha256 } from '../services/crypto';
import { verifyAdminPin } from '../services/api';

export default function AdminModal({ isOpen, onClose, onSuccess, roomId, roomName }) {
  // NOTE: hook phải chạy trước mọi `return` (Rules of Hooks).
  const [pin, setPin] = useState('');
  const [currentHash, setCurrentHash] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (pin) {
      sha256(pin).then((h) => {
        if (isMounted) setCurrentHash(h);
      });
    } else {
      setCurrentHash('');
    }
    return () => {
      isMounted = false;
    };
  }, [pin]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pin) {
      setError('Vui lòng nhập mã PIN quản trị!');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const result = await verifyAdminPin(roomId, pin);
      if (result.valid) {
        onSuccess(result.hash);
        onClose();
      } else {
        setError('Mã PIN không đúng! Vui lòng thử lại.');
      }
    } catch (err) {
      setError('Có lỗi xảy ra khi xác thực.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-slate-100 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Lock className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Xác thực Quản trị viên</h3>
              <p className="text-[11px] text-slate-400">Kiểm tra qua mã Hash SHA-256</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Nhập mã PIN / Mật khẩu Admin:
            </label>
            <div className="relative">
              <input
                type="password"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError('');
                }}
                placeholder={`PIN của ${roomName || roomId || "phòng"}`}
                autoFocus
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all pr-10"
              />
              <Key className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
            </div>
          </div>

          {/* Realtime Hash Display */}
          {currentHash && (
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="text-[10px] font-semibold text-slate-500 flex items-center gap-1 uppercase tracking-wider">
                <Hash className="w-3 h-3 text-indigo-500" /> Mã SHA-256 tính toán:
              </span>
              <p className="text-[11px] font-mono text-indigo-700 break-all select-all">
                {currentHash}
              </p>
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-100 text-[11px] text-blue-800 space-y-1">
            <p className="font-semibold">
              Mỗi phòng một PIN riêng — bạn đang mở khoá{' '}
              <span className="font-mono text-indigo-700">{roomName || roomId}</span>.
            </p>
            <p className="text-blue-600">
              Sai PIN thì chỉ phòng này bị chặn, không ảnh hưởng phòng khác. Đổi PIN ở Cài đặt &rsaquo; Bảo mật.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm shadow-indigo-200 transition-colors disabled:opacity-50"
            >
              {loading ? 'Đang kiểm tra...' : 'Xác thực'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
