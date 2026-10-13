import React from 'react';
import { Home, Settings, Plus, Cloud, HardDrive } from 'lucide-react';

export default function Header({
  roomName,
  source,
  onOpenAddExpense,
  onOpenSettings,
}) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between">
        {/* Left: Room Badge */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
            <Home className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-bold text-base text-slate-900 leading-tight">
                {roomName || 'Phòng 2A'}
              </h1>
              <span
                className="w-2 h-2 rounded-full bg-emerald-500"
                title={source === 'd1' ? 'Cloudflare D1' : 'Local Storage'}
              />
            </div>
          </div>
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
