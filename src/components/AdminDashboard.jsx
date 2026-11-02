import React, { useEffect, useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Users,
  Settings,
  CreditCard,
  KeyRound,
  Calendar,
  CheckCircle2,
  Copy,
  Check,
  Link2,
  Loader2,
  AlertCircle,
  UserX,
  UserCheck,
  UserPlus,
  ShieldAlert,
  Crown,
  QrCode,
} from 'lucide-react';
import { VIETNAM_BANKS } from '../constants/banks';
import {
  saveMember,
  savePeriod,
  deletePeriod,
  updateSettings,
  defaultTransferCode,
  createInvite,
  transferOwner,
  deactivateMember,
  reactivateMember,
  setMemberRole,
  unlinkMember,
  setRoomPin,
  fetchJoinRequests,
  reviewJoinRequest,
} from '../services/api';
import { ROLE_BADGE, ROLE_LABEL, roleRank } from '../constants/roles';

export default function AdminDashboard({ isOpen, onClose, roomId, data, me, onDataRefresh, onAuthRefresh }) {
  const isOwner = me?.role === 'owner';
  const [activeTab, setActiveTab] = useState('members');
  const [copiedLink, setCopiedLink] = useState(false);
  const [showInviteQr, setShowInviteQr] = useState(false);

  const [memberForm, setMemberForm] = useState({ name: '', nickname: '', phone: '' });
  const [periodForm, setPeriodForm] = useState({ title: '', due_date: '' });

  const [settingsForm, setSettingsForm] = useState({
    room_name: '',
    bank_id: 'MB',
    account_no: '',
    account_name: '',
    transfer_prefix: 'TIEN PHONG',
    transfer_code: '',
  });

  const [pinForm, setPinForm] = useState({ pin: '', confirm: '' });
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');

  const [invite, setInvite] = useState(null);
  const [inviteBusy, setInviteBusy] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [joinRequests, setJoinRequests] = useState([]);
  const [joinRequestsError, setJoinRequestsError] = useState('');
  const [joinApprovalBusy, setJoinApprovalBusy] = useState(false);

  useEffect(() => {
    const s = data?.settings || {};
    setSettingsForm({
      room_name: s.room_name || data?.room_name || '',
      bank_id: s.bank_id || 'MB',
      account_no: s.account_no || '',
      account_name: s.account_name || '',
      transfer_prefix: s.transfer_prefix || 'TIEN PHONG',
      transfer_code: s.transfer_code || defaultTransferCode(roomId),
    });
  }, [roomId, data?.settings, data?.room_name]);

  useEffect(() => {
    if (!isOpen || !isOwner) return undefined;
    let active = true;
    fetchJoinRequests(roomId).then((result) => {
      if (!active) return;
      if (!result.success) {
        setJoinRequestsError(result.error || 'Không tải được yêu cầu tham gia.');
        return;
      }
      setJoinRequestsError('');
      setJoinRequests(result.requests);
    });
    return () => {
      active = false;
    };
  }, [isOpen, isOwner, roomId]);

  if (!isOpen) return null;

  const myRank = roleRank(me?.role);
  const canManage = myRank >= 3;
  if (!canManage) return null;

  const members = data?.members || [];
  const activeCount = members.filter((m) => m.is_active !== 0).length;

  // Chỉ thao tác được lên người thấp quyền hơn mình; chủ phòng không bị đụng tới.
  const canActOn = (m) => m.id !== me?.member_id && roleRank(m.role) < myRank;

  const handleSaveMember = async (e) => {
    e.preventDefault();
    if (!memberForm.name.trim()) {
      alert('Vui lòng nhập họ và tên!');
      return;
    }
    const result = await saveMember(roomId, {
      name: memberForm.name.trim(),
      nickname: memberForm.nickname.trim(),
      phone: memberForm.phone.trim(),
    });
    if (!result.success) {
      alert(result.error || 'Không thêm được thành viên.');
      return;
    }
    setMemberForm({ name: '', nickname: '', phone: '' });
    onDataRefresh();
  };

  const handleDeactivate = async (m) => {
    if (!confirm(
      `Ngưng hoạt động ${m.name}?\n\n` +
        'Mất quyền vào phòng ngay lập tức. Tên, phần tiền và các khoản đã chia của người này ' +
        'vẫn nằm nguyên trong sổ các kỳ cũ.'
    )) return;
    const result = await deactivateMember(roomId, m.id);
    if (!result.success) {
      alert(result.error || 'Không ngưng hoạt động được.');
      return;
    }
    if (invite?.member_id === m.id) setInvite(null);
    onDataRefresh();
  };

  const handleReactivate = async (m) => {
    const result = await reactivateMember(roomId, m.id);
    if (!result.success) {
      alert(result.error || 'Không thêm lại được.');
      return;
    }
    onDataRefresh();
  };

  const handleRoleChange = async (m, role) => {
    if (role === m.role) return;
    if (!confirm(`Đổi quyền của ${m.name} thành "${ROLE_LABEL[role]}"?`)) return;
    const result = await setMemberRole(roomId, m.id, role);
    if (!result.success) {
      alert(result.error || 'Không đổi được quyền.');
      return;
    }
    onDataRefresh();
  };

  const handleUnlink = async (m) => {
    if (!confirm(
      `Gỡ tài khoản khỏi ${m.name}?\n\n` +
        'Tài khoản của người đó mất quyền vào phòng này (các phòng khác không đổi). ' +
        'Muốn vào lại thì bạn gửi một link mời mới. Lịch sử tiền vẫn giữ nguyên.'
    )) return;
    const result = await unlinkMember(roomId, m.id);
    if (!result.success) {
      alert(result.error || 'Không gỡ được liên kết.');
      return;
    }
    onDataRefresh();
  };

  const handleTransferOwner = async (m) => {
    if (!confirm(
      `Giao phòng cho ${m.name}?\n\n` +
        'Người đó thành chủ phòng và giữ mã khôi phục của phòng. Bạn hạ xuống Quản lý.'
    )) return;
    const result = await transferOwner(roomId, m.id);
    if (!result.success) {
      alert(result.error || 'Không giao phòng được.');
      return;
    }
    await onAuthRefresh();
  };

  const handleCreateInvite = async (member) => {
    setInviteBusy(member.id);
    setInviteError('');
    const result = await createInvite(roomId, member.id);
    setInviteBusy('');
    if (!result.success) {
      setInvite(null);
      setInviteError(result.error || 'Không tạo được link mời.');
      return;
    }
    const base = window.location.origin + window.location.pathname;
    setInvite({
      member_id: member.id,
      memberName: member.nickname || member.name,
      role: result.role || 'member',
      link: `${base}?j=${result.token}`,
      expires_at: result.expires_at,
    });
  };

  const handleReviewJoinRequest = async (request, decision) => {
    const result = await reviewJoinRequest(roomId, request.id, decision);
    if (!result.success) {
      alert(result.error || 'Không xử lý được yêu cầu tham gia.');
      return;
    }
    const refreshed = await fetchJoinRequests(roomId);
    if (refreshed.success) setJoinRequests(refreshed.requests);
    else setJoinRequestsError(refreshed.error || 'Không tải được yêu cầu tham gia.');
    if (decision === 'approve') await onDataRefresh();
  };

  const handleToggleJoinApproval = async () => {
    setJoinApprovalBusy(true);
    const next = data?.settings?.join_approval === '0' ? '1' : '0';
    const result = await updateSettings(roomId, { join_approval: next });
    setJoinApprovalBusy(false);
    if (!result.success) {
      alert(result.error || 'Không đổi được chế độ duyệt thành viên.');
      return;
    }
    await onDataRefresh();
  };

  const handleSavePeriod = async (e) => {
    e.preventDefault();
    if (!periodForm.title.trim()) {
      alert('Vui lòng nhập tên kỳ (VD: Tháng 11/2026)!');
      return;
    }
    const result = await savePeriod(roomId, {
      id: 'period_' + Date.now(),
      title: periodForm.title.trim(),
      due_date: periodForm.due_date,
      status: 'open',
    });
    if (!result.success) {
      alert(result.error || 'Không tạo được kỳ.');
      return;
    }
    setPeriodForm({ title: '', due_date: '' });
    onDataRefresh();
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    const result = await updateSettings(roomId, settingsForm);
    if (!result.success) {
      alert(result.error || 'Không lưu được cài đặt.');
      return;
    }
    await onDataRefresh();
    alert('Đã cập nhật thông tin phòng & tài khoản VietQR!');
  };

  const handleSavePin = async (e) => {
    e.preventDefault();
    setPinError('');
    setPinSuccess('');
    if (!/^\d{6,12}$/.test(pinForm.pin)) {
      setPinError('Mã khôi phục cần 6–12 chữ số.');
      return;
    }
    if (pinForm.pin !== pinForm.confirm) {
      setPinError('Hai lần nhập mã không khớp.');
      return;
    }
    const result = await setRoomPin(roomId, pinForm.pin);
    if (!result.success) {
      setPinError(result.error || 'Không đổi được mã khôi phục.');
      return;
    }
    setPinForm({ pin: '', confirm: '' });
    setPinSuccess('Đã đổi mã khôi phục. Mã cũ không còn dùng được.');
    setTimeout(() => setPinSuccess(''), 5000);
  };

  const requiresJoinApproval = data?.settings?.join_approval !== '0';

  const tabClass = (key) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
      activeTab === key
        ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
        : 'text-slate-600 hover:text-slate-900'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Settings className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-base">Cài đặt phòng</h2>
              <p className="text-[11px] text-slate-400">
                {data?.room_name || roomId} · bạn là {ROLE_LABEL[me?.role] || me?.role}
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

        <div className="flex items-center gap-1 px-4 py-2 bg-slate-50 border-b border-slate-200 overflow-x-auto shrink-0">
          <button onClick={() => setActiveTab('members')} className={tabClass('members')}>
            <Users className="w-3.5 h-3.5" /> Thành viên ({members.length})
          </button>
          <button onClick={() => setActiveTab('periods')} className={tabClass('periods')}>
            <Calendar className="w-3.5 h-3.5" /> Kỳ
          </button>
          {isOwner && (
            <button onClick={() => setActiveTab('settings')} className={tabClass('settings')}>
              <CreditCard className="w-3.5 h-3.5" /> VietQR
            </button>
          )}
          {isOwner && (
            <button onClick={() => setActiveTab('security')} className={tabClass('security')}>
              <KeyRound className="w-3.5 h-3.5" /> Mã khôi phục
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {activeTab === 'members' && (
            <div className="space-y-4">
              {isOwner && (
                <section className="p-4 bg-amber-50 rounded-2xl border border-amber-200 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-amber-900">
                        Duyệt thành viên ({joinRequests.length})
                      </h4>
                      <p className="text-[11px] text-amber-800 mt-1">
                        {requiresJoinApproval
                          ? 'Link mời cần chủ phòng duyệt trước khi tài khoản vào sổ.'
                          : 'Link mời được nhận ngay, không cần duyệt.'}
                      </p>
                    </div>
                    <button
                      onClick={handleToggleJoinApproval}
                      disabled={joinApprovalBusy}
                      className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-[10px] font-bold text-amber-900 disabled:opacity-50"
                    >
                      {joinApprovalBusy
                        ? 'Đang lưu...'
                        : requiresJoinApproval
                          ? 'Tắt duyệt'
                          : 'Bật duyệt'}
                    </button>
                  </div>
                  {joinRequestsError && (
                    <p className="text-xs text-rose-700">{joinRequestsError}</p>
                  )}
                  {joinRequests.map((request) => (
                    <div
                      key={request.id}
                      className="p-3 bg-white rounded-xl border border-amber-200 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800">
                          {request.display_name || request.email} muốn vào hồ sơ {request.member_name}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate">
                          {request.email} · quyền ban đầu: {ROLE_LABEL[request.role] || request.role}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleReviewJoinRequest(request, 'approve')}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold"
                        >
                          Duyệt
                        </button>
                        <button
                          onClick={() => handleReviewJoinRequest(request, 'reject')}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-bold"
                        >
                          Từ chối
                        </button>
                      </div>
                    </div>
                  ))}
                  {!joinRequests.length && !joinRequestsError && (
                    <p className="text-[11px] text-amber-800">Chưa có yêu cầu nào chờ duyệt.</p>
                  )}
                </section>
              )}

              <form onSubmit={handleSaveMember} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5" /> Thêm người vào sổ
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Họ và tên:</label>
                    <input
                      value={memberForm.name}
                      onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })}
                      placeholder="VD: Nguyễn Văn An"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Biệt danh:</label>
                    <input
                      value={memberForm.nickname}
                      onChange={(e) => setMemberForm({ ...memberForm, nickname: e.target.value })}
                      placeholder="VD: Bin, An..."
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Số điện thoại:</label>
                    <input
                      value={memberForm.phone}
                      onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })}
                      placeholder="VD: 0901234567"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500">
                  Người mới chỉ vào được sổ khi có tài khoản: sau khi thêm, bấm "Tạo link" ở dòng
                  của họ và gửi link qua Zalo/SMS. Link có quyền Thành viên; chủ phòng có thể đổi quyền
                  sau khi duyệt.
                </p>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm"
                  >
                    Thêm vào sổ
                  </button>
                </div>
              </form>

              {(invite || inviteError) && (
                <div className="p-3.5 bg-indigo-50/70 rounded-2xl border border-indigo-200 space-y-2">
                  {inviteError ? (
                    <div className="flex items-start gap-2 text-rose-700 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{inviteError}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-indigo-900">
                          Link mời cho {invite.memberName} ({ROLE_LABEL[invite.role]})
                        </span>
                        <span className="text-[10px] text-indigo-700 shrink-0">
                          hết hạn {new Date(invite.expires_at).toLocaleString('vi-VN', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-[10px] text-indigo-800">
                        Link cấp quyền Thành viên. Sau khi nhận/duyệt, chủ phòng đổi quyền trong danh sách thành viên.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={invite.link}
                          onFocus={(e) => e.target.select()}
                          className="flex-1 px-2.5 py-2 bg-white border border-indigo-200 rounded-lg text-[11px] font-mono text-slate-700 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowInviteQr((v) => !v)}
                          className={`p-2 border rounded-lg shrink-0 transition-colors ${
                            showInviteQr
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : "text-slate-600 hover:text-indigo-600 bg-white border-indigo-200"
                          }`}
                          title="Xem mã QR"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
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
                          Tạo mã mới
                        </button>
                      </div>

                      {showInviteQr && (
                        <div className="p-3 bg-white rounded-xl border border-indigo-100 flex flex-col items-center text-center space-y-2">
                          <p className="text-[11px] font-bold text-slate-700">Quét mã QR để nhận quyền vào phòng</p>
                          <div className="p-2 bg-white rounded-xl border border-slate-200 shadow-sm inline-block">
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(invite.link)}`}
                              alt="QR Code Link Mời"
                              className="w-40 h-40 object-contain"
                              loading="lazy"
                            />
                          </div>
                          <p className="text-[10px] text-slate-400">Đưa camera điện thoại quét để mở trực tiếp</p>
                        </div>
                      )}
                      <p className="text-[10px] text-indigo-700">
                        Link chỉ dùng được một lần và chỉ nhận cho đúng người này.
                      </p>
                    </>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Thành viên
                </h4>
                {members.map((m) => {
                  const gone = m.is_active === 0;
                  const owner = m.role === 'owner';
                  const hasAccount = !!m.has_account;
                  return (
                    <div
                      key={m.id}
                      className={`p-3 border rounded-xl space-y-2 ${
                        gone ? 'bg-slate-50 border-slate-200 opacity-75' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-xs text-slate-800 truncate">
                              {m.name}
                              {m.nickname ? ` (${m.nickname})` : ''}
                            </span>
                            {m.id === me?.member_id && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-900 text-white">
                                Bạn
                              </span>
                            )}
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ROLE_BADGE[m.role] || 'bg-slate-200 text-slate-700'}`}
                            >
                              {owner ? 'Chủ phòng' : m.role ? ROLE_LABEL[m.role] : 'Chưa có tài khoản'}
                            </span>
                            {gone && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">
                                Đã ngưng
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {hasAccount ? 'Có tài khoản' : 'Chưa có tài khoản'}
                            {m.phone ? ` · ${m.phone}` : ''}
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                          {gone ? '' : hasAccount ? '' : 'Cần link mời'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {!gone && !hasAccount && !owner && (
                          <button
                            onClick={() => handleCreateInvite(m)}
                            disabled={inviteBusy === m.id}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                          >
                            {inviteBusy === m.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Link2 className="w-3.5 h-3.5" />
                            )}
                            Tạo link
                          </button>
                        )}

                        {isOwner && hasAccount && !owner && m.id !== me?.member_id && (
                          <select
                            value={m.role || 'member'}
                            onChange={(e) => handleRoleChange(m, e.target.value)}
                            className="px-2 py-1.5 rounded-lg text-[11px] font-semibold text-slate-700 bg-slate-50 border border-slate-200"
                            title="Đổi quyền trong phòng"
                          >
                            <option value="viewer">Chỉ xem</option>
                            <option value="member">Thành viên</option>
                            <option value="manager">Quản lý</option>
                          </select>
                        )}

                        {isOwner && hasAccount && !owner && m.id !== me?.member_id && (
                          <button
                            onClick={() => handleUnlink(m)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Gỡ liên kết tài khoản (gửi link mời mới sau)"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isOwner && !owner && !gone && hasAccount && (
                          <button
                            onClick={() => handleTransferOwner(m)}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
                            title="Giao quyền chủ phòng"
                          >
                            <Crown className="w-3.5 h-3.5" /> Giao phòng
                          </button>
                        )}

                        {canActOn(m) && !gone && !owner && activeCount > 1 && (
                          <button
                            onClick={() => handleDeactivate(m)}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors"
                            title="Ngưng hoạt động: mất quyền vào phòng, giữ lịch sử"
                          >
                            <UserX className="w-3.5 h-3.5" /> Ngưng
                          </button>
                        )}

                        {canActOn(m) && gone && (
                          <button
                            onClick={() => handleReactivate(m)}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                            title="Cho phép vào phòng lại; cần link mới nếu chưa có tài khoản"
                          >
                            <UserCheck className="w-3.5 h-3.5" /> Thêm lại
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'periods' && (
            <div className="space-y-4">
              <form onSubmit={handleSavePeriod} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Tạo thêm kỳ thủ công nếu cần
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tên kỳ:</label>
                    <input
                      value={periodForm.title}
                      onChange={(e) => setPeriodForm({ ...periodForm, title: e.target.value })}
                      placeholder="VD: Tháng 11/2026"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Hạn nộp tiền:</label>
                    <input
                      type="date"
                      value={periodForm.due_date}
                      onChange={(e) => setPeriodForm({ ...periodForm, due_date: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
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
                {(data?.periods || []).map((p) => (
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
                    {isOwner && (
                      <button
                        onClick={async () => {
                          if (!confirm(`Xóa kỳ "${p.title}"?\n\nMọi khoản chi và mọi phần đã ghi trong kỳ này bị xóa theo, không phục hồi được.`)) return;
                          const result = await deletePeriod(roomId, p.id);
                          if (!result.success) {
                            alert(result.error || 'Không xóa được kỳ.');
                            return;
                          }
                          await onDataRefresh();
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-600"
                        title="Xóa kỳ (chỉ chủ phòng)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'settings' && isOwner && (
            <form onSubmit={handleSaveSettings} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tên phòng:</label>
                  <input
                    value={settingsForm.room_name}
                    onChange={(e) => setSettingsForm({ ...settingsForm, room_name: e.target.value })}
                    placeholder="VD: Phòng Trọ 2A"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Ngân hàng thụ hưởng:</label>
                  <select
                    value={settingsForm.bank_id}
                    onChange={(e) => setSettingsForm({ ...settingsForm, bank_id: e.target.value })}
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Số tài khoản người thu:</label>
                  <input
                    value={settingsForm.account_no}
                    onChange={(e) => setSettingsForm({ ...settingsForm, account_no: e.target.value })}
                    placeholder="VD: 0987654321"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tên chủ tài khoản:</label>
                  <input
                    value={settingsForm.account_name}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, account_name: e.target.value.toUpperCase() })
                    }
                    placeholder="VD: NGUYEN VAN A"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tiền tố nội dung chuyển khoản:</label>
                  <input
                    value={settingsForm.transfer_prefix}
                    onChange={(e) => setSettingsForm({ ...settingsForm, transfer_prefix: e.target.value })}
                    placeholder="VD: TIEN PHONG"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mã phòng trong nội dung chuyển khoản:
                  </label>
                  <input
                    value={settingsForm.transfer_code}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, transfer_code: e.target.value.toUpperCase() })
                    }
                    placeholder={defaultTransferCode(roomId)}
                    maxLength={6}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-mono uppercase"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Nội dung sẽ là{' '}
                    <span className="font-mono text-slate-700">
                      TIEN PHONG {settingsForm.transfer_code} {`<tên bạn>`} {`<kỳ>`}
                    </span>
                    . Mã đứng trước tên người nên không bị ngân hàng cắt mất khi nhiều phòng
                    cùng nhận vào một số tài khoản.
                  </p>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
                >
                  Lưu cài đặt
                </button>
              </div>
            </form>
          )}

          {activeTab === 'security' && isOwner && (
            <div className="space-y-4">
              <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 space-y-1.5">
                <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" /> Mã khôi phục của phòng
                </span>
                <p className="text-[11px] text-amber-800">
                  Chỉ dùng khi chủ phòng mất mật khẩu tài khoản. Không ai xem được mã thật — máy chủ
                  chỉ giữ bản băm. Đổi mã thì mã cũ lập tức hết hiệu lực.
                </p>
              </div>

              <form onSubmit={handleSavePin} className="p-4 bg-white rounded-2xl border border-slate-200 space-y-3">
                {pinError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{pinError}</span>
                  </div>
                )}
                {pinSuccess && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{pinSuccess}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mã mới:</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={pinForm.pin}
                      onChange={(e) => setPinForm({ ...pinForm, pin: e.target.value })}
                      placeholder="6–12 chữ số"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Nhập lại:</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={pinForm.confirm}
                      onChange={(e) => setPinForm({ ...pinForm, confirm: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
                  >
                    Đổi mã khôi phục
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
