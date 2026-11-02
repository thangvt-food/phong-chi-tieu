import React, { useState } from 'react';
import {
  Home,
  Settings,
  History,
  Plus,
  ChevronDown,
  DoorOpen,
  LogOut,
  UserRound,
  Link2,
  KeyRound,
} from 'lucide-react';
import { ROLE_BADGE, ROLE_LABEL } from '../constants/roles';

export default function Header({
  roomName,
  source,
  me,
  rooms = [],
  currentRoomId,
  user,
  canManage,
  saving = false,
  onSwitchRoom,
  onLeaveRoom,
  onOpenAddRoom,
  onOpenAddExpense,
  onOpenSettings,
  onOpenLogs,
  onManageGoogleAccount,
  onLogout,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const role = me?.role || null;

  const close = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
        {/* Left: room + account menu */}
        <div className="relative flex items-center gap-2 min-w-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl px-1 py-0.5 hover:bg-slate-100 transition-colors text-left min-w-0"
            title="Tài khoản và các phòng"
          >
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shrink-0">
              <Home className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h1 className="font-bold text-base text-slate-900 leading-tight truncate">
                  {roomName || 'Phòng chi tiêu'}
                </h1>
                {role && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ROLE_BADGE[role] || 'bg-slate-200 text-slate-700'}`}
                  >
                    {ROLE_LABEL[role] || role}
                  </span>
                )}
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${source === 'offline' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  title={source === 'offline' ? 'Đang xem bản lưu offline — không ghi được' : 'Đã kết nối máy chủ'}
                />
              </div>
              {me?.name && (
                <p className="text-[11px] text-slate-500 leading-tight truncate">
                  Bạn là {me.nickname || me.name}
                </p>
              )}
            </div>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
              <div className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-white rounded-2xl border border-slate-200 shadow-xl p-1.5">
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    {(user?.display_name || user?.username || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {user?.display_name || user?.username}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono truncate">
                      {user?.email || (user?.username ? `@${user.username}` : 'Tài khoản Google')}
                    </p>
                  </div>
                </div>

                <p className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-t border-slate-100">
                  Phòng của bạn ({rooms.length})
                </p>
                <p className="px-2.5 pb-1.5 text-[11px] text-slate-500">
                  Một tài khoản dùng được nhiều phòng. Mỗi phòng có sổ và quyền riêng; chọn để chuyển.
                </p>
                {rooms.length === 0 && (
                  <p className="px-2.5 py-1.5 text-xs text-slate-400">
                    Chưa tham gia phòng nào.
                  </p>
                )}
                {rooms.map((r) => (
                  <button
                    key={r.room_id}
                    onClick={() => {
                      close();
                      if (r.room_id !== currentRoomId) onSwitchRoom(r.room_id);
                    }}
                    disabled={saving}
                    className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-between gap-2 disabled:opacity-50 ${
                      r.room_id === currentRoomId
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{r.room_name}</span>
                      {r.member_name && (
                        <span className="block text-[11px] font-normal text-slate-500 truncate">
                          {r.member_name}
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ROLE_BADGE[r.role] || 'bg-slate-200 text-slate-700'}`}
                    >
                      {ROLE_LABEL[r.role] || r.role}
                    </span>
                  </button>
                ))}

                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button
                    onClick={() => {
                      close();
                      onOpenAddRoom('create');
                    }}
                    className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Tạo phòng mới
                  </button>
                  <button
                    onClick={() => {
                      close();
                      onOpenAddRoom('join');
                    }}
                    className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    Nhận link mời
                  </button>
                  {currentRoomId && (
                    <button
                      onClick={async () => {
                        await onLeaveRoom();
                        close();
                      }}
                      disabled={saving}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                      title={
                        role === 'owner'
                          ? 'Chủ phòng phải giao phòng trước khi rời'
                          : 'Mất quyền vào phòng này; tên và phần tiền cũ vẫn nằm trong sổ'
                      }
                    >
                      <DoorOpen className="w-3.5 h-3.5" />
                      Rời phòng này
                    </button>
                  )}
                  <button
                    onClick={() => {
                      close();
                      onManageGoogleAccount();
                    }}
                    className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Bảo mật tài khoản Google
                  </button>
                  <button
                    onClick={async () => {
                      await onLogout();
                      close();
                    }}
                    disabled={saving}
                    className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Đăng xuất
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: quick actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {canManage && (
            <button
              onClick={onOpenAddExpense}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition-all active:scale-95"
              title="Thêm khoản chi mới"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span className="hidden sm:inline">Chi tiêu</span>
            </button>
          )}

          <button
            onClick={onOpenLogs}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 transition-colors text-xs font-semibold"
            title="Lịch sử hoạt động"
          >
            <History className="w-4 h-4 stroke-[2]" />
            <span className="hidden sm:inline">Lịch sử</span>
          </button>
          {canManage ? (
            <button
              onClick={onOpenSettings}
              className="p-2 min-h-9 min-w-9 inline-flex items-center justify-center rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              title="Cài đặt phòng"
            >
              <Settings className="w-4 h-4 stroke-[2]" />
            </button>
          ) : (
            <button
              onClick={() => setMenuOpen(true)}
              className="p-2 min-h-9 min-w-9 inline-flex items-center justify-center rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              title="Tài khoản"
            >
              <UserRound className="w-4 h-4 stroke-[2]" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
