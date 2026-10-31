import React, { useMemo, useState } from 'react';
import { X, Link2, Plus, AlertCircle, Loader2, Home } from 'lucide-react';
import { createRoom, joinWithToken, listStoredRooms } from '../services/api';

// Một link mời trông là https://.../?j=<token>; cho phép dán cả link lẫn token thô.
function extractToken(raw) {
  const s = (raw || '').trim();
  const m = s.match(/[?&]j=([^&#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return s;
}

export default function RoomGate({ isOpen, onClose, onEnter, missingRoomId, notice }) {
  // thiếu onClose + có missingRoomId = màn chặn toàn trang khi ?p= trỏ vào phòng lạ
  const standalone = !isOpen && !!missingRoomId;
  const [tab, setTab] = useState(missingRoomId ? 'join' : 'create');
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const knownRooms = useMemo(() => listStoredRooms(), []);

  if (!isOpen && !standalone) return null;

  const handleJoin = async (e) => {
    e.preventDefault();
    const token = extractToken(link);
    if (token.length < 40) {
      setError('Dán link mời đầy đủ (có phần ?j=...) hoặc mã token.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await joinWithToken(token);
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
    if (name.trim().length < 2) setError('Tên phòng cần ít nhất 2 ký tự.');
    else if (pin.length < 4) setError('PIN cần ít nhất 4 ký tự.');
    else if (pin !== pinConfirm) setError('Hai lần nhập PIN không khớp.');
    else {
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
      setPinConfirm('');
      onEnter(result.room_id);
    }
  };

  const card = (
    <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100">
      <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Home className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Phòng chi tiêu</h3>
            <p className="text-[11px] text-slate-400">Mỗi phòng một sổ riêng, một PIN riêng</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {missingRoomId && (
        <div className="px-6 pt-4">
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {notice || (
                <>
                  Phòng <span className="font-mono">{missingRoomId}</span> không tồn tại. Có thể link mời
                  đã hết hạn hoặc mã phòng không đúng.
                </>
              )}
            </span>
          </div>
        </div>
      )}

      <div className="px-6 pt-4 flex gap-1.5 bg-white">
        {[
          { key: 'join', label: 'Vào bằng link mời' },
          { key: 'create', label: 'Tạo phòng mới' },
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
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white pr-10"
              />
              <Link2 className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Link chỉ dùng được một lần và hết hạn sau 15 phút. Vào rồi thì thiết bị này giữ phiên
            90 ngày, không cần link nữa.
          </p>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {busy ? 'Đang vào phòng...' : 'Vào phòng'}
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
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
            {name.trim().length >= 2 && (
              <p className="text-[11px] text-slate-500 mt-1">
                Mã phòng sẽ là <span className="font-mono text-indigo-700">{previewSlug(name)}</span>
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">PIN quản trị:</label>
              <input
                type="password"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError('');
                }}
                placeholder="≥ 4 ký tự"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nhập lại PIN:</label>
              <input
                type="password"
                value={pinConfirm}
                onChange={(e) => {
                  setPinConfirm(e.target.value);
                  setError('');
                }}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Tên của bạn <span className="font-normal text-slate-400">(tạo làm thành viên đầu tiên, không bắt buộc)</span>:
            </label>
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Nguyễn Văn A"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>
          <p className="text-[11px] text-slate-500">
            PIN này chỉ dùng để vào Cài đặt của phòng bạn, không liên quan phòng khác. Sau này muốn
            người khác cùng xem thì tạo link mời trong Cài đặt.
          </p>
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

      {knownRooms.length > 0 && (
        <div className="px-6 pb-6">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Phòng trên thiết bị này
          </p>
          <div className="flex flex-wrap gap-1.5">
            {knownRooms.map((r) => (
              <button
                key={r.roomId}
                onClick={() => onEnter(r.roomId)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700 transition-colors"
              >
                {r.roomId}
                {r.member_name ? ` · ${r.member_name}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (standalone) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">{card}</div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      {card}
    </div>
  );
}

// Phải trùng thuật toán với slugify() trong functions/api/[[route]].js, nếu không
// chỗ sẽ nói một mã khác mã server thực sự tạo ra.
function previewSlug(name) {
  const noAccents = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D');
  return noAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}
