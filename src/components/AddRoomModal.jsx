import React, { useState, useEffect } from 'react';
import {
  X,
  Link2,
  Plus,
  AlertCircle,
  Loader2,
  Home,
  ShieldQuestion,
  Search,
  User,
  Mail,
  Send,
  CheckCircle2,
} from 'lucide-react';
import { createRoom, claimInvite, searchRooms, requestJoinRoom } from '../services/api';

function extractToken(raw) {
  const s = (raw || '').trim();
  const m = s.match(/[?&]j=([^&#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return s;
}

export default function AddRoomModal({ isOpen, onClose, initialTab = 'search', onEnter }) {
  const [tab, setTab] = useState(initialTab);

  // Tab Tìm kiếm phòng
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [requestedRooms, setRequestedRooms] = useState(new Set());

  // Tab Nhận link mời
  const [link, setLink] = useState('');

  // Tab Tạo phòng mới
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [ownerName, setOwnerName] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab(initialTab);
    setError('');
  }, [initialTab, isOpen]);

  // Tự động tìm kiếm ban đầu khi mở tab search
  useEffect(() => {
    if (!isOpen || tab !== 'search') return;
    const timer = setTimeout(() => {
      handleSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, tab, isOpen]);

  if (!isOpen) return null;

  const handleSearch = async (query = '') => {
    setSearching(true);
    const res = await searchRooms(query);
    setSearching(false);
    if (res.success) {
      setSearchResults(res.rooms);
    }
  };

  const handleRequestJoin = async (targetRoomId) => {
    setBusy(true);
    setError('');
    const res = await requestJoinRoom(targetRoomId);
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Không gửi được yêu cầu.');
      return;
    }
    setRequestedRooms((prev) => new Set([...prev, targetRoomId]));
    if (res.is_joined) {
      onEnter(targetRoomId);
    }
  };

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
    onEnter(result.room_id, { pending: !!result.pending });
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
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Home className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Phòng chi tiêu</h3>
              <p className="text-[11px] text-slate-400">
                Tìm kiếm, tạo mới hoặc tham gia phòng
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

        {/* Tabs */}
        <div className="px-6 pt-4 flex gap-1.5 shrink-0">
          {[
            { key: 'search', label: 'Tìm phòng' },
            { key: 'create', label: 'Tạo phòng mới' },
            { key: 'join', label: 'Dán link mời' },
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
          <div className="mx-6 mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Body Container */}
        <div className="p-6 overflow-y-auto flex-1">
          {tab === 'search' && (
            <div className="space-y-4">
              <div className="relative">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm tên phòng hoặc mã phòng..."
                  autoFocus
                  className={`${inputClass} pl-10`}
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                {searching && (
                  <Loader2 className="w-4 h-4 text-indigo-600 animate-spin absolute right-3.5 top-3" />
                )}
              </div>

              <div className="space-y-2.5">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  {searchResults.length ? `Tìm thấy ${searchResults.length} phòng` : 'Danh sách phòng'}
                </p>

                {searchResults.length === 0 && !searching && (
                  <div className="p-6 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    Không tìm thấy phòng phù hợp. Hãy thử tìm từ khóa khác hoặc tạo phòng mới.
                  </div>
                )}

                {searchResults.map((room) => {
                  const isRequested = requestedRooms.has(room.room_id);
                  return (
                    <div
                      key={room.room_id}
                      className="p-3.5 bg-slate-50 hover:bg-indigo-50/50 transition-colors border border-slate-200 hover:border-indigo-200 rounded-2xl flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-bold text-sm text-slate-900 truncate">
                            {room.room_name}
                          </h4>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-700 font-mono">
                            {room.room_id}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1">
                          <span className="flex items-center gap-1 truncate">
                            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            {room.owner_name}
                          </span>
                          {room.owner_email && (
                            <span className="flex items-center gap-1 truncate text-slate-400">
                              <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                              {room.owner_email}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {room.is_joined ? (
                          <button
                            onClick={() => onEnter(room.room_id)}
                            className="px-3.5 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold"
                          >
                            Mở phòng
                          </button>
                        ) : isRequested ? (
                          <span className="px-3 py-1.5 rounded-xl bg-amber-100 text-amber-800 text-xs font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Chờ duyệt
                          </span>
                        ) : (
                          <button
                            onClick={() => handleRequestJoin(room.room_id)}
                            disabled={busy}
                            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
                          >
                            <Send className="w-3.5 h-3.5" /> Xin vào
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'join' && (
            <form onSubmit={handleJoin} className="space-y-3">
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
              <div className="flex justify-end pt-2">
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
          )}

          {tab === 'create' && (
            <form onSubmit={handleCreate} className="space-y-3">
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
                  Dùng khi bạn cần khôi phục quyền chủ phòng. Đừng dùng ngày sinh hay PIN ngân hàng.
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
              <div className="flex justify-end pt-2">
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
    </div>
  );
}
