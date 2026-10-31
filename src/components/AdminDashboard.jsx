import React, { useEffect, useState } from 'react';
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
  Link2,
  LogOut,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { VIETNAM_BANKS } from '../constants/banks';
import {
  saveMember,
  deleteMember,
  savePeriod,
  deletePeriod,
  updateSettings,
  setStoredAdminHash,
  defaultTransferCode,
  createInvite,
  revokeMemberSession,
  transferOwner,
} from '../services/api';
import { sha256 } from '../services/crypto';

// Ba mức quyền của link mời, khớp CHECK trong invites.role (migration 003).
const INVITE_ROLES = [
  { id: 'viewer', label: 'Chỉ xem', desc: 'xem được sổ, không tick "đã nộp" được.' },
  { id: 'member', label: 'Thành viên', desc: 'xem sổ + tự tick đã nộp cho phần của mình (mặc định).' },
  { id: 'manager', label: 'Quản lý mời', desc: 'như thành viên, thêm tạo lại link và thu hồi phiên. KHÔNG sửa được kỳ/khoản/PIN.' },
];

export default function AdminDashboard({
  isOpen,
  onClose,
  roomId,
  data,
  adminHash,
  session,
  onDataRefresh,
}) {
  // NOTE: hook phải chạy trước mọi `return` (Rules of Hooks).
  const [activeTab, setActiveTab] = useState('members'); // 'members', 'settings', 'security', 'periods'
  const [copiedLink, setCopiedLink] = useState(false);

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
    transfer_code: data.settings?.transfer_code || defaultTransferCode(roomId),
  });

  // Đổi phòng / tải lại dữ liệu thì form phải theo phòng, không giữ số của phòng trước.
  useEffect(() => {
    const s = data.settings || {};
    setSettingsForm({
      room_name: s.room_name || '',
      bank_id: s.bank_id || 'MB',
      account_no: s.account_no || '',
      account_name: s.account_name || '',
      transfer_prefix: s.transfer_prefix || 'TIEN PHONG',
      transfer_code: s.transfer_code || defaultTransferCode(roomId),
    });
  }, [roomId, data.settings]);

  // Security Form
  const [newPin, setNewPin] = useState('');
  const [newPinHash, setNewPinHash] = useState('');
  const [securitySuccess, setSecuritySuccess] = useState('');

  // Invite link: { member_id, memberName, role, link, expires_at }
  const [invite, setInvite] = useState(null);
  const [inviteBusy, setInviteBusy] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteRole, setInviteRole] = useState('member');

  if (!isOpen) return null;

  // Link mức "Quản lý mời" không có PIN. Server chỉ mở đúng hai đường
  // admin/invites + admin/revoke cho nó, nên ở đây cũng chỉ vẽ hai hành động đó;
  // các tab kia mà để lại thì mỗi nút bấm đều là một lần 401.
  const managerOnly = !adminHash && session?.role === 'manager';

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
      roomId,
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

  const activeCount = (data.members || []).filter((m) => m.is_active !== 0).length;
  const ownerId = data.owner_member_id || null;

  const handleDeleteMember = async (m) => {
    const isOwner = m.id === ownerId;
    const ok = confirm(
      isOwner
        ? 'Bạn là chủ phòng. Muốn rời đi thì phải "Giao phòng" cho người khác trước.'
        : `Ngưng hoạt động ${m.name}?\n\n` +
          'Mất quyền vào phòng ở mọi thiết bị ngay lập tức. Tên, phần tiền và các khoản đã chia của bạn ấy ' +
          'vẫn nằm nguyên trong sổ những kỳ cũ.'
    );
    if (!ok) return;
    const result = await deleteMember(roomId, m.id, adminHash);
    if (!result.success) {
      alert(result.error || 'Không ngưng hoạt động được.');
      return;
    }
    if (invite?.member_id === m.id) setInvite(null);
    onDataRefresh();
  };

  // Người rời vẫn là một dòng trong members, không phải mồ côi: thêm lại chính id đó
  // thì lịch sử cũ của họ nối tiếp, thay vì tạo một người trùng tên.
  const handleReactivate = async (m) => {
    const result = await saveMember(roomId, { ...m, is_active: 1 }, adminHash);
    if (result === false) {
      alert('Không thêm lại được (máy chủ từ chối).');
      return;
    }
    onDataRefresh();
  };

  const handleTransferOwner = async (m) => {
    const ok = confirm(
      `Giao phòng cho ${m.name}?\n\n` +
        'Người đó thành chủ phòng: chỉ họ mới tạo link mức "Quản lý mời" và bạn mới rời phòng được. ' +
        'Bạn vẫn ở trong phòng như một thành viên bình thường.'
    );
    if (!ok) return;
    const result = await transferOwner(roomId, m.id, adminHash);
    if (!result.success) {
      alert(result.error || 'Không giao phòng được.');
      return;
    }
    onDataRefresh();
  };

  // Link mời gắn với ĐÚNG một thành viên: ai bấm vào sẽ được nhận là người đó.
  const handleCreateInvite = async (member, role = inviteRole) => {
    setInviteBusy(member.id);
    setInviteError('');
    const result = await createInvite(
      roomId,
      member.id,
      { ttlMin: 15, uses: 1, role },
      adminHash,
      managerOnly ? session.token : undefined
    );
    setInviteBusy('');
    if (!result.success) {
      setInvite(null);
      setInviteError(
        result.unauthorized
          ? 'Cần nhập lại PIN phòng này để tạo link.'
          : result.error || 'Không tạo được link mời (cần chế độ online).'
      );
      return;
    }
    setInviteRole(result.role || role);
    const base = window.location.origin + window.location.pathname;
    setInvite({
      member_id: member.id,
      memberName: member.nickname || member.name,
      role: result.role || role,
      link: `${base}?j=${result.token}`,
      expires_at: result.expires_at,
    });
  };

  const handleRevoke = async (member) => {
    if (!confirm(`Thu hồi phiên của ${member.name}? Bạn ấy sẽ cần link mời mới.`)) return;
    const result = await revokeMemberSession(
      roomId,
      member.id,
      adminHash,
      managerOnly ? session.token : undefined
    );
    if (!result.success) {
      alert(result.error || 'Không thu hồi được.');
      return;
    }
    alert(result.revoked > 0 ? `Đã thu hồi ${result.revoked} phiên.` : 'Thành viên đó chưa có phiên nào.');
  };

  const handleSavePeriod = async (e) => {
    e.preventDefault();
    if (!periodForm.title) {
      alert('Vui lòng nhập tên kỳ (VD: Tháng 11/2026)!');
      return;
    }

    const id = 'period_' + Date.now();
    await savePeriod(
      roomId,
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
    await updateSettings(roomId, settingsForm, adminHash);
    onDataRefresh();
    alert('Đã cập nhật thông tin phòng & tài khoản VietQR thành công!');
  };

  const handleSaveNewPin = async (e) => {
    e.preventDefault();
    if (!newPin || !newPinHash) return;

    await updateSettings(roomId, { admin_pin_hash: newPinHash }, adminHash);
    setStoredAdminHash(roomId, newPinHash);
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
            <Users className="w-3.5 h-3.5" /> Thành viên ({(data.members || []).length})
          </button>

          {!managerOnly && (
            <>
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
                <Key className="w-3.5 h-3.5" /> PIN & Mời người
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
            </>
          )}
        </div>

        {/* Tab Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* TAB 1: MEMBERS */}
          {activeTab === 'members' && (
            <div className="space-y-4">
              {managerOnly ? (
                <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl p-3">
                  Bạn vào đây bằng link <span className="font-semibold">"Quản lý mời"</span>: tạo lại
                  link và thu hồi phiên thì được, còn thêm người, sửa kỳ, đổi PIN vẫn cần mã PIN của
                  phòng. Chủ phòng là người đưa cho bạn mức quyền này.
                </p>
              ) : (
              <>
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
              </>
              )}

              {/* Invite link đang mở */}
              {(invite || inviteError) && (
                <div className="p-3.5 bg-indigo-50/70 rounded-2xl border border-indigo-200 space-y-2">
                  {inviteError ? (
                    <div className="flex items-start gap-2 text-rose-700 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{inviteError}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-indigo-900">
                          Link mời cho {invite.memberName}
                        </span>
                        <span className="text-[10px] text-indigo-700">
                          hết hạn {new Date(invite.expires_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · dùng 1 lần
                        </span>
                      </div>
                      {/* Ba mức quyền: chọn mức nào là link mới mang mức đó. */}
                      <div className="flex flex-wrap gap-1">
                        {INVITE_ROLES.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => {
                              if (r.id === inviteRole) return;
                              setInviteRole(r.id);
                              handleCreateInvite({ id: invite.member_id, name: invite.memberName }, r.id);
                            }}
                            title={r.desc}
                            className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
                              inviteRole === r.id
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                            }`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-indigo-800">
                        {INVITE_ROLES.find((r) => r.id === inviteRole)?.desc}
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={invite.link}
                          onFocus={(e) => e.target.select()}
                          className="flex-1 px-2.5 py-2 bg-white border border-indigo-200 rounded-lg text-[11px] font-mono text-slate-700 outline-none"
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(invite.link);
                            setCopiedLink(true);
                            setTimeout(() => setCopiedLink(false), 2000);
                          }}
                          className="p-2 text-slate-500 hover:text-indigo-600 bg-white border border-indigo-200 rounded-lg shrink-0"
                          title="Sao chép link mời"
                        >
                          {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleCreateInvite({ id: invite.member_id, name: invite.memberName })}
                          className="px-2.5 py-2 text-[11px] font-semibold text-indigo-700 bg-white border border-indigo-200 rounded-lg shrink-0 hover:bg-indigo-100"
                          title="Hủy link cũ và tạo link mới"
                        >
                          Tạo lại
                        </button>
                      </div>
                      <p className="text-[10px] text-indigo-700">
                        Gửi link này cho đúng bạn đó qua Zalo/SMS. Hết 15 phút thì bấm "Tạo lại".
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Members List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Danh sách thành viên hiện tại
                </h4>
                {data.members.map((m) => {
                  const gone = m.is_active === 0;
                  const isOwner = m.id === ownerId;
                  // Chủ phòng và người active cuối cùng không có nút "ngưng": server
                  // cũng chặn (409), ẩn ở đây để đừng ai bấm rồi nhận lỗi khó hiểu.
                  const canDeactivate = !isOwner && !gone && activeCount > 1 && !managerOnly;
                  return (
                  <div
                    key={m.id}
                    className={`p-3 border rounded-xl flex items-center justify-between gap-2 ${
                      gone ? 'bg-slate-50 border-slate-200 opacity-70' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-xs text-slate-800">
                        {m.name} {m.nickname && `(${m.nickname})`}
                      </span>
                      {isOwner && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                          Chủ
                        </span>
                      )}
                      {gone && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-600 text-[10px] font-bold">
                          Đã rời
                        </span>
                      )}
                      {m.phone && <span className="text-[11px] text-slate-400 block">{m.phone}</span>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!gone && (
                        <>
                          <button
                            onClick={() => handleCreateInvite(m)}
                            disabled={inviteBusy === m.id}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                            title="Tạo link mời cho thành viên này"
                          >
                            {inviteBusy === m.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Link2 className="w-3.5 h-3.5" />
                            )}
                            Link mời
                          </button>
                          <button
                            onClick={() => handleRevoke(m)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Thu hồi phiên (đá khỏi phòng, vẫn là thành viên)"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                          </button>
                          {!isOwner && !managerOnly && (
                            <button
                              onClick={() => handleTransferOwner(m)}
                              className="px-2 py-1.5 rounded-lg text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
                              title="Giao quyền chủ phòng cho người này"
                            >
                              Giao phòng
                            </button>
                          )}
                          {canDeactivate && (
                            <button
                              onClick={() => handleDeleteMember(m)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Ngưng hoạt động: mất quyền vào phòng, giữ nguyên lịch sử các kỳ cũ"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                      {gone && !managerOnly && (
                        <button
                          onClick={() => handleReactivate(m)}
                          className="px-2 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                          title="Thêm lại chính người này vào phòng (giữ phần tiền cũ), rồi tạo link mời mới"
                        >
                          Thêm lại
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
                {ownerId === null && (
                  <p className="text-[10px] text-slate-400">
                    Phòng này chưa có chủ (tạo bằng link/PIN cũ). Giao phòng cho một người để
                    người đó quản lý được quyền mời.
                  </p>
                )}
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

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mã phòng trong nội dung chuyển khoản:
                  </label>
                  <input
                    type="text"
                    value={settingsForm.transfer_code}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, transfer_code: e.target.value.toUpperCase() })
                    }
                    placeholder={defaultTransferCode(roomId)}
                    maxLength={6}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-mono uppercase"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Nội dung sẽ là <span className="font-mono text-slate-700">TIEN PHONG {settingsForm.transfer_code} {`<tên bạn>`} {`<kỳ>`}</span>.
                    Đứng trước tên người nên không bị ngân hàng cắt mất khi nhiều phòng
                    cùng nhận vào một số tài khoản.
                  </p>
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

          {/* TAB 3: SECURITY */}
          {activeTab === 'security' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 block">
                  PIN của phòng <span className="font-mono text-indigo-700">{roomId}</span>
                </span>
                <p className="text-[11px] text-slate-500">
                  PIN này chỉ mở khoá Cài đặt của phòng này; phòng khác có PIN riêng. Không ai
                  nhìn thấy PIN thật — máy chủ chỉ giữ mã SHA-256 của nó.
                </p>
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
                {(data.periods || []).map((p) => (
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
                        if (!confirm(`Xóa kỳ "${p.title}"?\n\nMọi khoản chi và mọi phần đã ghi trong kỳ này bị xóa theo, không phục hồi được.`)) return;
                        // Signature là (roomId, periodId, adminHash). Gọi thiếu roomId
                        // thì server trả 401 và hàm rơi vào nhánh local: kỳ biến mất
                        // trên màn hình nhưng reload thì nó quay lại.
                        const result = await deletePeriod(roomId, p.id, adminHash);
                        if (!result.success) {
                          alert(result.error || 'Không xóa được kỳ.');
                          return;
                        }
                        onDataRefresh();
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
