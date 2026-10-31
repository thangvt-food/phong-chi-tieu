import React, { useState } from 'react';
import { X, Link2, Plus, AlertCircle, Loader2, Home, ShieldQuestion } from 'lucide-react';
import { createRoom, claimInvite } from '../services/api';

// Một link mời trông là https://.../?j=<token>; cho phép dán cả link lẫn token thô.
function extractToken(raw) {
  const s = (raw || '').trim();
  const m = s.match(/[?&]j=([^&#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return s;
}

export default function AddRoomModal({ isOpen, onClose, initialTab = 'create', onEnter }) {
  const [tab, setTab] = useState(initialTab);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const handleJoin = async (e) => {
    e.preventDefault();
    const token = extractToken(link);
    if (token.length < 40) {
      setError('Dán link mời đầy đủ (có phần ?j=...) hoặc mã token.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await claimInvite(token);
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Link mời không còn hợp lệ.');
      return;
    }
    setLink('');
    onEnter(result.room_id);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError('Tên phòng cần ít nhất 2 ký tự.');
      return;
    }
    if (!/^\d{6,12}$/.test(pin)) {
      setError('Mã khôi phục cần 6–12 chữ số.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await createRoom({ name: name.trim(), pin, ownerName: ownerName.trim() });
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Không tạo được phòng.');
      return;
    }
    setName('');
    setPin('');
    setOwnerName('');
    onEnter(result.room_id);
  };

  const inputClass =
    'w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Home className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Thêm phòng</h3>
              <p className="text-[11px] text-slate-400">
                Tạo phòng mới, hoặc nhận lời mời từ chủ phòng
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4 flex gap-1.5">
          {[
            { key: 'create', label: 'Tạo phòng mới' },
            { key: 'join', label: 'Nhận link mời' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setError('');
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                tab === t.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mx-6 mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {tab === 'join' ? (
          <form onSubmit={handleJoin} className="p-6 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Dán link chủ phòng gửi cho bạn:
              </label>
              <div className="relative">
                <input
                  value={link}
                  onChange={(e) => {
                    setLink(e.target.value);
                    setError('');
                  }}
                  placeholder="https://.../?j=..."
                  autoFocus
                  className={`${inputClass} pr-10`}
                />
                <Link2 className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Link gắn với đúng tên và mức quyền chủ phòng đã chọn. Mỗi link chỉ dùng được một lần.
            </p>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {busy ? 'Đang nhận...' : 'Nhận phòng'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreate} className="p-6 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tên phòng:</label>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError('');
                }}
                placeholder="Nhà trọ 3B Đường Láng"
                autoFocus
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Mã khôi phục (PIN):
              </label>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError('');
                }}
                placeholder="6–12 chữ số"
                className={`${inputClass} font-mono tracking-widest`}
              />
              <p className="text-[11px] text-slate-500 mt-1 flex items-start gap-1">
                <ShieldQuestion className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Chỉ dùng khi bạn mất mật khẩu tài khoản chủ phòng. Đừng dùng ngày sinh hay PIN ngân hàng.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Tên của bạn{' '}
                <span className="font-normal text-slate-400">
                  (thành viên chủ phòng, không bắt buộc)
                </span>
                :
              </label>
              <input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Nguyễn Văn A"
                className={inputClass}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {busy ? 'Đang tạo...' : 'Tạo phòng'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
