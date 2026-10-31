import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, AlertCircle, Home, Plus, Link2, LogOut, WifiOff, DoorOpen } from 'lucide-react';
import Header from './components/Header';
import PeriodSelector from './components/PeriodSelector';
import OverviewStats from './components/OverviewStats';
import ExpenseList from './components/ExpenseList';
import MemberCardList from './components/MemberCardList';
import ExpenseModal from './components/ExpenseModal';
import PaymentModal from './components/PaymentModal';
import MemberDetailModal from './components/MemberDetailModal';
import VietQrModal from './components/VietQrModal';
import AdminDashboard from './components/AdminDashboard';
import AuthGate from './components/AuthGate';
import AddRoomModal from './components/AddRoomModal';
import ChangePasswordModal from './components/ChangePasswordModal';
import {
  fetchRoomData,
  saveExpense,
  deleteExpense,
  toggleSharePaid,
  memberTogglePaid,
  authMe,
  authLogout,
  previewInvite,
  claimInvite,
  leaveRoom,
  clearLegacyStorage,
  getLastRoomId,
  getStoredUser,
  setLastRoomId,
  calculatePeriodDebts,
} from './services/api';
import { roleRank } from './constants/roles';

export default function App() {
  const booted = useRef(false);

  const [auth, setAuth] = useState(() => getStoredUser());
  const [authReady, setAuthReady] = useState(false);
  const [myRooms, setMyRooms] = useState([]);
  const [invite, setInvite] = useState(null);

  const [roomId, setRoomId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  const [roomHint] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('p') || getLastRoomId();
    return p ? { roomId: p } : null;
  });

  // Modals
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [selectedCalculation, setSelectedCalculation] = useState(null);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentCalculation, setPaymentCalculation] = useState(null);
  const [detailMemberId, setDetailMemberId] = useState(null);
  const [isAdminDashboardOpen, setIsAdminDashboardOpen] = useState(false);
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [addRoomTab, setAddRoomTab] = useState('create');
  const [passwordOpen, setPasswordOpen] = useState(false);

  const loadRoom = async (target, { spinner = false } = {}) => {
    if (!target) return null;
    // Mọi thao tác ghi đều gửi roomId làm tham số ?p=. Sau khi claim link mời,
    // loadRoom là nơi duy nhất biết phòng vừa mở, nên phải tự đồng bộ state.
    setRoomId(target);
    if (spinner) setLoading(true);
    const res = await fetchRoomData(target);
    setData(res);
    if (res.source === 'need_auth') {
      setAuth(null);
      setMyRooms([]);
    }
    if (res.source === 'd1' || res.source === 'offline') {
      setLastRoomId(target);
      setSelectedPeriodId((prev) =>
        (res.periods || []).some((p) => p.id === prev) ? prev : res.periods?.[0]?.id || ''
      );
    } else {
      setSelectedPeriodId('');
    }
    if (spinner) setLoading(false);
    return res;
  };

  const refreshMe = async () => {
    const me = await authMe();
    if (me.needsAuth) {
      setAuth(null);
      setMyRooms([]);
      setData(null);
      return null;
    }
    if (me.user) {
      setAuth(me.user);
      setMyRooms(me.rooms || []);
    }
    return me;
  };

  // Boot: dọn khóa PIN cũ -> ?j= -> tài khoản -> chọn phòng.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      clearLegacyStorage();
      const params = new URLSearchParams(window.location.search);
      const inviteToken = params.get('j');
      let pendingInvite = null;

      if (inviteToken) {
        const preview = await previewInvite(inviteToken);
        if (preview.success) pendingInvite = { token: inviteToken, preview };
        else alert(preview.error || 'Link mời không còn hiệu lực.');
        const clean = new URL(window.location.href);
        clean.searchParams.delete('j');
        window.history.replaceState({}, '', clean.toString());
      }

      const me = await authMe();
      if (me.needsAuth || (!me.user && !me.offline)) {
        setInvite(pendingInvite);
        setAuth(null);
        setLoading(false);
        setAuthReady(true);
        return;
      }

      if (!me.user) {
        // Offline: dùng tài khoản đã lưu + cache đọc của phòng gần nhất.
        setInvite(pendingInvite);
        setAuth(getStoredUser());
        const last = params.get('p') || getLastRoomId();
        if (last) {
          setRoomId(last);
          await loadRoom(last);
        }
        setLoading(false);
        setAuthReady(true);
        return;
      }

      setAuth(me.user);
      setMyRooms(me.rooms || []);
      let rooms = me.rooms || [];
      let target = '';

      if (pendingInvite) {
        const claim = await claimInvite(pendingInvite.token);
        if (claim.success) {
          const fresh = await authMe();
          if (fresh.user) {
            setAuth(fresh.user);
            rooms = fresh.rooms || [];
            setMyRooms(rooms);
          }
          target = claim.room_id;
        } else {
          alert(claim.error || 'Không nhận được link mời.');
        }
      }

      if (!target) {
        const urlRoom = params.get('p') || '';
        const last = getLastRoomId();
        if (urlRoom && rooms.some((r) => r.room_id === urlRoom)) target = urlRoom;
        else if (last && rooms.some((r) => r.room_id === last)) target = last;
        else if (rooms.length) target = rooms[0].room_id;
        else if (urlRoom) target = urlRoom;
      }

      if (target) {
        setRoomId(target);
        await loadRoom(target);
      }
      setLoading(false);
      setAuthReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kỳ đang chọn phải tồn tại trong danh sách kỳ của phòng.
  useEffect(() => {
    if (data?.periods && data.periods.length > 0) {
      const exists = data.periods.some((p) => p.id === selectedPeriodId);
      if (!exists) setSelectedPeriodId(data.periods[0].id);
    }
  }, [data?.periods, selectedPeriodId]);

  const activePeriod =
    data?.periods?.find((p) => p.id === selectedPeriodId) || data?.periods?.[0];

  const currentPeriodExpenses = useMemo(
    () => (data?.expenses || []).filter((e) => e.period_id === activePeriod?.id),
    [data?.expenses, activePeriod]
  );

  const activeMembers = useMemo(
    () => (data?.members || []).filter((m) => m.is_active !== 0),
    [data?.members]
  );

  const debts = useMemo(
    () =>
      calculatePeriodDebts(
        currentPeriodExpenses,
        activeMembers,
        data?.member_shares || [],
        activePeriod?.id || '',
        // Danh sách CẢ người đã rời: giữ đúng split_config của hóa đơn cũ.
        data?.members || []
      ),
    [currentPeriodExpenses, activeMembers, data?.member_shares, data?.members, activePeriod]
  );

  const me = data?.me || null;
  const myRank = roleRank(me?.role);
  const canManage = myRank >= 3;
  const canTickSelf = myRank >= 2;
  const isOffline = data?.source === 'offline';

  // ---- Điều hướng phòng ----

  const switchRoom = async (next) => {
    if (!next) return;
    if (next === roomId && data && data.source !== 'need_room' && data.source !== 'forbidden') return;
    setIsAdminDashboardOpen(false);
    setRoomId(next);
    const url = new URL(window.location.href);
    url.searchParams.set('p', next);
    window.history.pushState({}, '', url.toString());
    setData(null);
    setSelectedPeriodId('');
    await loadRoom(next, { spinner: true });
  };

  const handleAuthed = async ({ claimedRoomId } = {}) => {
    setInvite(null);
    const fresh = await authMe();
    if (!fresh.user) {
      setAuth(null);
      return;
    }
    setAuth(fresh.user);
    setMyRooms(fresh.rooms || []);
    const rooms = fresh.rooms || [];
    let target = claimedRoomId;
    if (!target || !rooms.some((r) => r.room_id === target)) target = rooms[0]?.room_id || '';
    if (target) {
      const url = new URL(window.location.href);
      url.searchParams.set('p', target);
      window.history.replaceState({}, '', url.toString());
      setData(null);
      setSelectedPeriodId('');
      await loadRoom(target, { spinner: true });
    }
  };

  const handleEnterRoom = async (next) => {
    setAddRoomOpen(false);
    const fresh = await authMe();
    if (fresh.user) {
      setAuth(fresh.user);
      setMyRooms(fresh.rooms || []);
    }
    await switchRoom(next);
  };

  const clearRoomFromUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('p');
    window.history.replaceState({}, '', url.toString());
  };

  const handleLogout = async () => {
    await authLogout();
    setAuth(null);
    setMyRooms([]);
    setData(null);
    setSelectedPeriodId('');
    setRoomId('');
    setIsAdminDashboardOpen(false);
  };

  const handleLeaveRoom = async () => {
    if (!me) return;
    if (me.is_owner) {
      alert(
        'Bạn là chủ phòng. Hãy giao phòng cho người khác trong Cài đặt → Thành viên trước khi rời.'
      );
      return;
    }
    if (!confirm(
      `Rời "${data?.room_name || roomId}"?\n\n` +
        'Bạn mất quyền vào phòng này; tên và phần tiền của bạn trong các kỳ cũ vẫn nằm trong sổ. ' +
        'Muốn vào lại thì cần chủ phòng gửi link mời mới.'
    )) return;

    const result = await leaveRoom(roomId);
    if (!result.success) {
      alert(result.error || 'Không rời phòng được.');
      return;
    }
    const fresh = await authMe();
    const rooms = fresh.rooms || [];
    setMyRooms(rooms);
    if (fresh.user) setAuth(fresh.user);
    const next = rooms[0]?.room_id || '';
    if (next) {
      await switchRoom(next);
    } else {
      setRoomId('');
      setData(null);
      setSelectedPeriodId('');
      clearRoomFromUrl();
    }
  };

  // ---- Ghi sổ ----

  const handleSaveExpense = async (expense) => {
    const result = await saveExpense(roomId, expense);
    if (!result.success) {
      if (result.unauthorized) {
        alert('Phiên đã hết hạn, đăng nhập lại.');
        await refreshMe();
        return;
      }
      alert(result.error || 'Không thể lưu khoản chi!');
      return;
    }
    if (result.period_id) setSelectedPeriodId(result.period_id);
    await loadRoom(roomId);
  };

  const handleDeleteExpense = async (id) => {
    if (!confirm('Xóa khoản chi này?')) return;
    const result = await deleteExpense(roomId, id);
    if (!result.success) {
      if (result.unauthorized) {
        alert('Phiên đã hết hạn, đăng nhập lại.');
        await refreshMe();
        return;
      }
      alert(result.error || 'Không xóa được khoản chi.');
      return;
    }
    await loadRoom(roomId);
  };

  const handleTogglePaid = async (periodId, memberId, nextPaid, paidAmount) => {
    if (!me || isOffline) return;
    const targetPeriod = periodId || activePeriod?.id;
    if (!targetPeriod) {
      alert('Phòng chưa có kỳ nào. Hãy tạo kỳ hoặc thêm khoản chi trước.');
      return;
    }
    const isSelf = me.member_id === memberId;
    if (isSelf ? !canTickSelf : !canManage) return;

    const result = isSelf
      ? await memberTogglePaid(roomId, {
          period_id: targetPeriod,
          is_paid: nextPaid,
          paid_amount: paidAmount,
        })
      : await toggleSharePaid(roomId, targetPeriod, memberId, nextPaid, paidAmount);

    if (!result.success) {
      if (result.unauthorized) {
        alert('Phiên đã hết hạn, đăng nhập lại.');
        await refreshMe();
        return;
      }
      alert(result.error || 'Không lưu được!');
      return;
    }
    await loadRoom(roomId);
  };

  const handleRecordPayment = (calc) => {
    setPaymentCalculation(calc);
    setIsPaymentOpen(true);
  };

  const handleConfirmPayment = async (newPaidTotal) => {
    if (!paymentCalculation) return;
    const { member, totalAmount } = paymentCalculation;
    const isFull = newPaidTotal >= totalAmount && totalAmount > 0;
    await handleTogglePaid(activePeriod?.id, member.id, isFull, newPaidTotal);
  };

  const handleDetailToggle = async (calc) => {
    if (!calc) return;
    const nextPaid = !calc.isPaid;
    await handleTogglePaid(
      activePeriod?.id,
      calc.member.id,
      nextPaid,
      nextPaid ? calc.totalAmount : 0
    );
  };

  const detailCalc = (debts.memberCalculations || []).find((c) => c.member.id === detailMemberId);

  const handleOpenQr = (calc) => {
    setSelectedCalculation(calc);
    setIsQrOpen(true);
  };

  const refreshAll = async () => {
    await Promise.all([loadRoom(roomId), refreshMe()]);
  };

  // ---- Màn hình ----

  if (!authReady || loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
        <p className="text-xs font-bold text-slate-700">Đang tải sổ chi tiêu...</p>
      </div>
    );
  }

  if (!auth) {
    return (
      <AuthGate
        invite={invite}
        roomHint={roomHint}
        onAuthed={handleAuthed}
      />
    );
  }

  if (!myRooms.length) {
    return (
      <>
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-xl border border-slate-100 space-y-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
              <Home className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-base text-slate-900">Chưa có phòng nào</h2>
              <p className="text-xs text-slate-500 mt-1">
                Tạo phòng mới, hoặc nhận link mời từ chủ phòng để bắt đầu.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setAddRoomTab('create');
                  setAddRoomOpen(true);
                }}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Tạo phòng mới
              </button>
              <button
                onClick={() => {
                  setAddRoomTab('join');
                  setAddRoomOpen(true);
                }}
                className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <Link2 className="w-4 h-4" /> Nhận link mời
              </button>
              <button
                onClick={handleLogout}
                className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 pt-1"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
        <AddRoomModal
          isOpen={addRoomOpen}
          initialTab={addRoomTab}
          onClose={() => setAddRoomOpen(false)}
          onEnter={handleEnterRoom}
        />
      </>
    );
  }

  if (data?.source === 'need_room' || data?.source === 'forbidden') {
    const missing = data.source === 'need_room';
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-xl border border-slate-100 space-y-4 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-900">
              {missing ? 'Phòng không tồn tại' : 'Bạn không có quyền vào phòng này'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {missing
                ? 'Link phòng này không còn hoặc đã bị xóa. Mã phòng chỉ là liên kết kỹ thuật — hãy mở phòng từ danh sách của bạn.'
                : 'Tài khoản của bạn không phải thành viên phòng này, hoặc đã bị ngưng hoạt động. Chủ phòng cần gửi link mời mới.'}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => switchRoom(myRooms[0].room_id)}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <Home className="w-4 h-4" /> Về phòng của tôi
            </button>
            <button
              onClick={() => {
                setAddRoomTab('join');
                setAddRoomOpen(true);
              }}
              className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <Link2 className="w-4 h-4" /> Nhận link mời
            </button>
          </div>
        </div>
        <AddRoomModal
          isOpen={addRoomOpen}
          initialTab={addRoomTab}
          onClose={() => setAddRoomOpen(false)}
          onEnter={handleEnterRoom}
        />
      </div>
    );
  }

  if (data?.source === 'offline_empty' || data?.source === 'error') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-xl border border-slate-100 space-y-4 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center">
            <WifiOff className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-900">
              {data.source === 'offline_empty' ? 'Không có kết nối' : 'Máy chủ đang lỗi'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {data.error || 'Chưa tải được sổ của phòng này trên thiết bị. Kiểm tra mạng rồi thử lại.'}
            </p>
          </div>
          <button
            onClick={() => loadRoom(roomId, { spinner: true })}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  const detailCanAct = detailCalc
    ? detailCalc.member.id === me?.member_id
      ? canTickSelf && !isOffline
      : canManage && !isOffline
    : false;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      <Header
        roomName={data?.room_name}
        source={data?.source}
        me={me}
        rooms={myRooms}
        currentRoomId={roomId}
        user={auth}
        canManage={canManage && !isOffline}
        onSwitchRoom={switchRoom}
        onLeaveRoom={handleLeaveRoom}
        onOpenAddRoom={(tab) => {
          setAddRoomTab(tab);
          setAddRoomOpen(true);
        }}
        onOpenAddExpense={() => {
          setEditingExpense(null);
          setIsExpenseModalOpen(true);
        }}
        onOpenSettings={() => setIsAdminDashboardOpen(true)}
        onOpenChangePassword={() => setPasswordOpen(true)}
        onLogout={handleLogout}
      />

      <main className="max-w-xl w-full mx-auto px-3 sm:px-4 py-3 space-y-3 flex-1">
        {isOffline && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold flex items-center gap-2">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            Đang xem bản lưu offline. Ghi sổ và tick đã nộp tạm khóa đến khi có mạng.
          </div>
        )}

        <PeriodSelector
          periods={data.periods || []}
          selectedPeriodId={selectedPeriodId}
          onSelectPeriod={(id) => setSelectedPeriodId(id)}
        />

        <OverviewStats
          totalAllExpenses={debts.totalAllExpenses}
          sharedPerMember={debts.sharedPerMember}
          paidCount={debts.paidCount}
          partialCount={debts.partialCount}
          totalMembers={debts.totalMembers}
          totalCollected={debts.totalCollected}
          remaining={debts.remaining}
        />

        <MemberCardList
          memberCalculations={debts.memberCalculations}
          periodId={activePeriod?.id || ''}
          myMemberId={me?.member_id || ''}
          canTickSelf={canTickSelf && !isOffline}
          canManageAll={canManage && !isOffline}
          onOpenQr={handleOpenQr}
          onTogglePaid={handleTogglePaid}
          onRecordPayment={handleRecordPayment}
          onSelectMember={(calc) => setDetailMemberId(calc.member.id)}
        />

        <ExpenseList
          expenses={currentPeriodExpenses}
          members={data.members || []}
          canManage={canManage && !isOffline}
          onAddExpense={() => {
            setEditingExpense(null);
            setIsExpenseModalOpen(true);
          }}
          onEditExpense={(exp) => {
            setEditingExpense(exp);
            setIsExpenseModalOpen(true);
          }}
          onDeleteExpense={handleDeleteExpense}
        />
      </main>

      <ExpenseModal
        isOpen={isExpenseModalOpen}
        onClose={() => {
          setIsExpenseModalOpen(false);
          setEditingExpense(null);
        }}
        onSave={handleSaveExpense}
        members={activeMembers}
        editingExpense={editingExpense}
      />

      <VietQrModal
        isOpen={isQrOpen}
        onClose={() => setIsQrOpen(false)}
        calculation={selectedCalculation}
        settings={data?.settings}
        periodTitle={activePeriod?.title || ''}
        roomId={roomId}
      />

      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => {
          setIsPaymentOpen(false);
          setPaymentCalculation(null);
        }}
        calc={paymentCalculation}
        onConfirm={handleConfirmPayment}
      />

      <MemberDetailModal
        isOpen={!!detailMemberId}
        onClose={() => setDetailMemberId(null)}
        calc={detailCalc}
        members={data?.members || []}
        sharedExpenses={debts.sharedExpenses || []}
        canAct={detailCanAct}
        onOpenQr={handleOpenQr}
        onTogglePaid={handleDetailToggle}
        onRecordPayment={handleRecordPayment}
      />

      <AdminDashboard
        isOpen={isAdminDashboardOpen}
        roomId={roomId}
        onClose={() => setIsAdminDashboardOpen(false)}
        data={data}
        me={me}
        onDataRefresh={refreshAll}
      />

      <AddRoomModal
        isOpen={addRoomOpen}
        initialTab={addRoomTab}
        onClose={() => setAddRoomOpen(false)}
        onEnter={handleEnterRoom}
      />

      <ChangePasswordModal
        isOpen={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />
    </div>
  );
}
