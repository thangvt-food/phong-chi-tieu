import React, { useState } from 'react';
import { Home, Settings, Plus, ChevronDown, DoorOpen } from 'lucide-react';

export default function Header({
  roomName,
  source,
  rooms = [],
  currentRoomId,
  memberName,
  onSwitchRoom,
  onOpenCreateRoom,
  onOpenAddExpense,
  onOpenSettings,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between">
        {/* Left: Room Badge + switcher */}
        <div className="relative flex items-center gap-2">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl px-1 py-0.5 hover:bg-slate-100 transition-colors text-left"
            title="Đổi phòng"
          >
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Home className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-base text-slate-900 leading-tight">
                  {roomName || currentRoomId || 'Phòng chi tiêu'}
                </h1>
                {rooms.length > 1 && <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                <span
                  className="w-2 h-2 rounded-full bg-emerald-500"
                  title={
                    source === 'd1'
                      ? 'Cloudflare D1'
                      : source === 'local'
                        ? 'Lưu trên máy này (offline)'
                        : source
                  }
                />
              </div>
              {memberName && (
                <p className="text-[10px] text-slate-500 leading-tight">Bạn là {memberName}</p>
              )}
            </div>
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute left-0 top-full mt-1.5 z-50 w-60 bg-white rounded-2xl border border-slate-200 shadow-xl p-1.5">
                <p className="px-2.5 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Phòng của bạn
                </p>
                {rooms.map((r) => (
                  <button
                    key={r.roomId}
                    onClick={() => {
                      setMenuOpen(false);
                      if (r.roomId !== currentRoomId) onSwitchRoom(r.roomId);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                      r.roomId === currentRoomId
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {r.roomId}
                    {r.member_name && (
                      <span className="block text-[10px] font-normal text-slate-500">
                        {r.member_name}
                      </span>
                    )}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenCreateRoom();
                  }}
                  className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors border-t border-slate-100 mt-1"
                >
                  <DoorOpen className="w-3.5 h-3.5" />
                  Tạo phòng / vào bằng link mời
                </button>
              </div>
            </>
          )}
        </div>

        {/* Right: Quick Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenAddExpense}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition-all active:scale-95"
            title="Thêm chi tiêu mới"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span className="hidden sm:inline">Chi tiêu</span>
          </button>

          <button
            onClick={onOpenSettings}
            className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            title="Cài đặt phòng"
          >
            <Settings className="w-4 h-4 stroke-[2]" />
          </button>
        </div>
      </div>
    </header>
  );
}
