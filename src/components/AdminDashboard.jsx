import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Users,
  Settings,
  CreditCard,
  Key,
  Calendar,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react';
import { VIETNAM_BANKS } from '../constants/banks';
import {
  saveMember,
  deleteMember,
  savePeriod,
  deletePeriod,
  updateSettings,
  setStoredAdminHash,
} from '../services/api';
import { sha256 } from '../services/crypto';

export default function AdminDashboard({
  isOpen,
  onClose,
  data,
  adminHash,
  onDataRefresh,
}) {
  // NOTE: hook phải chạy trước mọi `return` (Rules of Hooks).
  const [activeTab, setActiveTab] = useState('members'); // 'members', 'settings', 'security', 'periods'
  const [copiedHash, setCopiedHash] = useState(false);

  // Form states for Member
  const [memberForm, setMemberForm] = useState({
    name: '',
    nickname: '',
    phone: '',
  });

  // Form states for Period
  const [periodForm, setPeriodForm] = useState({
    title: '',
    due_date: '',
  });

  // Form states for Bank Settings
  const [settingsForm, setSettingsForm] = useState({
    room_name: data.settings?.room_name || '',
    bank_id: data.settings?.bank_id || 'MB',
    account_no: data.settings?.account_no || '',
    account_name: data.settings?.account_name || '',
    transfer_prefix: data.settings?.transfer_prefix || 'TIEN PHONG',
  });

  // Security Form
  const [newPin, setNewPin] = useState('');
  const [newPinHash, setNewPinHash] = useState('');
  const [securitySuccess, setSecuritySuccess] = useState('');

  if (!isOpen) return null;

  const handlePinChange = async (val) => {
    setNewPin(val);
    if (val) {
      const h = await sha256(val);
      setNewPinHash(h);
    } else {
      setNewPinHash('');
    }
  };

  const handleSaveMember = async (e) => {
    e.preventDefault();
    if (!memberForm.name) {
      alert('Vui lòng nhập họ và tên!');
      return;
    }

    await saveMember(
      {
        name: memberForm.name,
        nickname: memberForm.nickname,
        phone: memberForm.phone,
        is_active: 1,
      },
      adminHash
    );

    setMemberForm({ name: '', nickname: '', phone: '' });
    onDataRefresh();
  };

  const handleDeleteMember = async (id) => {
    if (confirm('Bạn có chắc muốn xóa thành viên này khỏi phòng?')) {
      await deleteMember(id, adminHash);
      onDataRefresh();
    }
  };

  const handleSavePeriod = async (e) => {
    e.preventDefault();
    if (!periodForm.title) {
      alert('Vui lòng nhập tên kỳ (VD: Tháng 11/2026)!');
      return;
    }

    const id = 'period_' + Date.now();
    await savePeriod(
      {
        id,
        title: periodForm.title,
        due_date: periodForm.due_date,
        status: 'open',
      },
      adminHash
    );

    setPeriodForm({ title: '', due_date: '' });
    onDataRefresh();
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    await updateSettings(settingsForm, adminHash);
    onDataRefresh();
    alert('Đã cập nhật thông tin phòng & tài khoản VietQR thành công!');
  };

  const handleSaveNewPin = async (e) => {
    e.preventDefault();
    if (!newPin || !newPinHash) return;

    await updateSettings({ admin_pin_hash: newPinHash }, adminHash);
    setStoredAdminHash(newPinHash);
    setSecuritySuccess('Đã cập nhật mã PIN & Hash mới thành công!');
    setNewPin('');
    setTimeout(() => setSecuritySuccess(''), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Settings className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-base">Cài Đặt Quản Trị Phòng</h2>
              <p className="text-[11px] text-slate-400">
                Quản lý thành viên, thông tin VietQR và mật mã Admin
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-4 py-2 bg-slate-50 border-b border-slate-200 overflow-x-auto scrollbar-none shrink-0">
          <button
            onClick={() => setActiveTab('members')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'members'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Thành viên ({data.members.length})
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'settings'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" /> STK VietQR
          </button>

          <button
            onClick={() => setActiveTab('security')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'security'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Key className="w-3.5 h-3.5" /> Mã Hash / PIN
          </button>

          <button
            onClick={() => setActiveTab('periods')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'periods'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" /> Quản lý kỳ
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* TAB 1: MEMBERS */}
          {activeTab === 'members' && (
            <div className="space-y-4">
              {/* Add Member Form */}
              <form
                onSubmit={handleSaveMember}
                className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3"
              >
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Thêm bạn cùng phòng mới
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Họ và tên:
                    </label>
                    <input
                      type="text"
                      placeholder="VD: Nguyễn Văn An"
                      value={memberForm.name}
                      onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Tên thường gọi / Biệt danh:
                    </label>
                    <input
                      type="text"
                      placeholder="VD: Bin, An..."
                      value={memberForm.nickname}
                      onChange={(e) => setMemberForm({ ...memberForm, nickname: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Số điện thoại:
                    </label>
                    <input
                      type="text"
                      placeholder="VD: 0901234567"
                      value={memberForm.phone}
                      onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm"
                  >
                    Thêm vào phòng
                  </button>
                </div>
              </form>

              {/* Members List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Danh sách thành viên hiện tại
                </h4>
                {data.members.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <span className="font-semibold text-xs text-slate-800">
                        {m.name} {m.nickname && `(${m.nickname})`}
                      </span>
                      {m.phone && <span className="text-[11px] text-slate-400 block">{m.phone}</span>}
                    </div>
                    <button
                      onClick={() => handleDeleteMember(m.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Xóa thành viên"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: VIETQR SETTINGS */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên phòng / Nhà trọ:
                  </label>
                  <input
                    type="text"
                    value={settingsForm.room_name}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, room_name: e.target.value })
                    }
                    placeholder="VD: Phòng Trọ 2A"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ngân hàng thụ hưởng:
                  </label>
                  <select
                    value={settingsForm.bank_id}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, bank_id: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    {VIETNAM_BANKS.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Số tài khoản người thu:
                  </label>
                  <input
                    type="text"
                    value={settingsForm.account_no}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, account_no: e.target.value })
                    }
                    placeholder="VD: 0987654321"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên chủ tài khoản:
                  </label>
                  <input
                    type="text"
                    value={settingsForm.account_name}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        account_name: e.target.value.toUpperCase(),
                      })
                    }
                    placeholder="VD: NGUYEN VAN A"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tiền tố nội dung chuyển khoản:
                  </label>
                  <input
                    type="text"
                    value={settingsForm.transfer_prefix}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, transfer_prefix: e.target.value })
                    }
                    placeholder="VD: TIEN PHONG"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
                >
                  Lưu cài đặt VietQR
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: SECURITY & HASH */}
          {activeTab === 'security' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <span className="text-xs font-semibold text-slate-700 block">
                  Mã SHA-256 Hash đang áp dụng:
                </span>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-mono text-slate-800 break-all bg-white p-2 rounded-lg border border-slate-200 flex-1 select-all">
                    {adminHash}
                  </p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(adminHash);
                      setCopiedHash(true);
                      setTimeout(() => setCopiedHash(false), 2000);
                    }}
                    className="p-2 text-slate-500 hover:text-indigo-600 bg-white border border-slate-200 rounded-lg shrink-0"
                    title="Sao chép mã hash"
                  >
                    {copiedHash ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Form to change PIN */}
              <form
                onSubmit={handleSaveNewPin}
                className="p-4 bg-white rounded-2xl border border-slate-200 space-y-3"
              >
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Đổi mã PIN đăng nhập Admin
                </h4>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Nhập mã PIN mới:
                  </label>
                  <input
                    type="password"
                    value={newPin}
                    onChange={(e) => handlePinChange(e.target.value)}
                    placeholder="VD: 686868"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                {newPinHash && (
                  <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100 space-y-1">
                    <span className="text-[10px] font-semibold text-indigo-700 uppercase">
                      Mã SHA-256 tương ứng:
                    </span>
                    <p className="text-[11px] font-mono text-indigo-900 break-all">
                      {newPinHash}
                    </p>
                  </div>
                )}

                {securitySuccess && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{securitySuccess}</span>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={!newPin}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
                  >
                    Lưu mã PIN mới
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 4: PERIODS */}
          {activeTab === 'periods' && (
            <div className="space-y-4">
              <form
                onSubmit={handleSavePeriod}
                className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3"
              >
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Tạo thêm kỳ thủ công nếu cần
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Tên kỳ:
                    </label>
                    <input
                      type="text"
                      placeholder="VD: Tháng 11/2026"
                      value={periodForm.title}
                      onChange={(e) => setPeriodForm({ ...periodForm, title: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Hạn nộp tiền:
                    </label>
                    <input
                      type="date"
                      value={periodForm.due_date}
                      onChange={(e) => setPeriodForm({ ...periodForm, due_date: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm"
                  >
                    Tạo kỳ
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Các kỳ hiện có
                </h4>
                {data.periods.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <span className="font-semibold text-xs text-slate-800">{p.title}</span>
                      {p.due_date && (
                        <span className="text-[11px] text-slate-400 block">Hạn: {p.due_date}</span>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        if (confirm('Xóa kỳ này?')) {
                          await deletePeriod(p.id, adminHash);
                          onDataRefresh();
                        }
                      }}
                      className="p-1.5 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
