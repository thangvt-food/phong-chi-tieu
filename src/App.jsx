import React, { useState, useEffect, useMemo, useRef } from 'react';
import Header from './components/Header';
import PeriodSelector from './components/PeriodSelector';
import OverviewStats from './components/OverviewStats';
import ExpenseList from './components/ExpenseList';
import MemberCardList from './components/MemberCardList';
import ExpenseModal from './components/ExpenseModal';
import PaymentModal from './components/PaymentModal';
import MemberDetailModal from './components/MemberDetailModal';
import VietQrModal from './components/VietQrModal';
import AdminModal from './components/AdminModal';
import AdminDashboard from './components/AdminDashboard';
import RoomGate from './components/RoomGate';
import {
  fetchRoomData,
  saveExpense,
  deleteExpense,
  toggleSharePaid,
  memberTogglePaid,
  getStoredAdminHash,
  setStoredAdminHash,
  getStoredSession,
  listStoredRooms,
  roomIdFromUrl,
  joinWithToken,
  calculatePeriodDebts,
} from './services/api';
import { Loader2 } from 'lucide-react';

export default function App() {
  // ?p=quyết định phòng; thiếu ?p = phòng cũ nên URL cũ không hỏng.
  const [roomId, setRoomId] = useState(() => roomIdFromUrl());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  const [adminHash, setAdminHash] = useState(() => getStoredAdminHash(roomId));
  const [session, setSession] = useState(() => getStoredSession(roomId));

  // Modals
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);

  const [isQrOpen, setIsQrOpen] = useState(false);
  const [selectedCalculation, setSelectedCalculation] = useState(null);

  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentCalculation, setPaymentCalculation] = useState(null);

  const [detailMemberId, setDetailMemberId] = useState(null);

  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isAdminDashboardOpen, setIsAdminDashboardOpen] = useState(false);
  const [roomGateOpen, setRoomGateOpen] = useState(false);

  // Link mời đến qua ?j=<token>: đổi lấy phiên rồi xóa token khỏi address bar
  // và lịch sử, để không ai nhìn thấy lại nó.
  const pendingInvite = useRef(new URLSearchParams(window.location.search).get('j'));

  useEffect(() => {
    // Đang cầm link mời thì để effect join load - nó mới biết phòng nào.
    if (pendingInvite.current) return;
    loadData(roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    const token = pendingInvite.current;
    if (!token) return;
    pendingInvite.current = null;
    (async () => {
      const result = await joinWithToken(token);
      const clean = new URL(window.location.href);
      clean.searchParams.delete('j');
      if (result.success) clean.searchParams.set('p', result.room_id);
      window.history.replaceState({}, '', clean.toString());
      if (result.success) {
        setSession(getStoredSession(result.room_id));
        setAdminHash(getStoredAdminHash(result.room_id));
        if (result.room_id === roomId) {
          loadData(result.room_id);
        } else {
          // đổi roomId sẽ kích hoạt effect ở trên load phòng mới
          setData(null);
          setLoading(true);
          setSelectedPeriodId('');
          setRoomId(result.room_id);
        }
      } else {
        setLoading(false);
        alert(result.error || 'Link mời không còn hợp lệ.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load room data
  const loadData = async (targetRoom = roomId) => {
    try {
      const res = await fetchRoomData(targetRoom);
      setData(res);
      if (res.periods && res.periods.length > 0 && !selectedPeriodId) {
        setSelectedPeriodId(res.periods[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const switchRoom = (nextRoom) => {
    if (!nextRoom || nextRoom === roomId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('p', nextRoom);
    window.history.pushState({}, '', url.toString());
    setRoomId(nextRoom);
    setData(null);
    setLoading(true);
    setSelectedPeriodId('');
    setAdminHash(getStoredAdminHash(nextRoom));
    setSession(getStoredSession(nextRoom));
  };

  // Ensure selected period is valid
  useEffect(() => {
    if (data?.periods && data.periods.length > 0) {
      const exists = data.periods.some((p) => p.id === selectedPeriodId);
      if (!exists) {
        setSelectedPeriodId(data.periods[0].id);
      }
    }
  }, [data?.periods, selectedPeriodId]);

  const activePeriod = data?.periods?.find((p) => p.id === selectedPeriodId) || data?.periods?.[0];

  const currentPeriodExpenses = useMemo(() => {
    return (data?.expenses || []).filter((e) => e.period_id === activePeriod?.id);
  }, [data?.expenses, activePeriod]);

  const activeMembers = useMemo(() => {
    return (data?.members || []).filter((m) => m.is_active !== 0);
  }, [data?.members]);

  // Danh sách phòng thiết bị này từng vào (localStorage, không gọi server).
  const rooms = useMemo(() => {
    const known = listStoredRooms();
    if (!known.some((r) => r.roomId === roomId)) known.unshift({ roomId, member_id: null, role: null });
    return known;
  }, [roomId, data?.room_id]);

  // Auto-calculated debts and shares
  const debts = useMemo(() => {
    return calculatePeriodDebts(
      currentPeriodExpenses,
      activeMembers,
      data?.member_shares || [],
      activePeriod?.id || ''
    );
  }, [currentPeriodExpenses, activeMembers, data?.member_shares, activePeriod]);

  // Handlers
  // `then` = việc cần làm tiếp sau khi nhập PIN xong, để không bắt người dùng bấm lại từ đầu.
  const [afterAdmin, setAfterAdmin] = useState(null);

  const requireAdminHash = (then) => {
    const hash = adminHash || getStoredAdminHash(roomId);
    if (!hash) {
      setAfterAdmin(then || null);
      setIsAdminModalOpen(true);
      return null;
    }
    return hash;
  };

  const handleSaveExpense = async (expense) => {
    const hash = requireAdminHash();
    if (!hash) return;
    const result = await saveExpense(roomId, expense, hash);
    if (!result?.success) {
      if (result?.unauthorized) {
        setIsAdminModalOpen(true);
      } else {
        alert(result?.error || 'Không thể lưu khoản chi!');
      }
      return;
    }
    if (result.period_id) {
      setSelectedPeriodId(result.period_id);
    }
    await loadData();
  };

  const handleDeleteExpense = async (id) => {
    if (confirm('Xóa khoản chi này?')) {
      const hash = requireAdminHash();
      if (!hash) return;
      await deleteExpense(roomId, id, hash);
      await loadData();
    }
  };

  // Member tự tick phần của mình bằng phiên (không cần PIN). Muốn tick hộ người
  // khác hoặc sửa số liệu thì phải là admin.
  const handleTogglePaid = async (periodId, memberId, nextPaid, paidAmount) => {
    const targetPeriod = periodId || activePeriod?.id;
    if (session && session.member_id === memberId) {
      const result = await memberTogglePaid(roomId, {
        period_id: targetPeriod,
        is_paid: nextPaid,
        paid_amount: paidAmount,
      });
      if (result.needInvite) {
        setSession(null);
        alert('Phiên của bạn đã hết hạn, cần link mời mới.');
      } else if (!result.success) {
        alert(result.error || 'Không lưu được!');
      }
      await loadData();
      return;
    }
    const hash = requireAdminHash();
    if (!hash) return;
    await toggleSharePaid(roomId, targetPeriod, memberId, nextPaid, hash, paidAmount);
    await loadData();
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

  // Toggle nhanh trong modal chi tiết: đủ <-> về 0, dở -> thu nốt
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

  const detailCalc = (debts.memberCalculations || []).find(
    (c) => c.member.id === detailMemberId
  );

  const handleOpenQr = (calc) => {
    setSelectedCalculation(calc);
    setIsQrOpen(true);
  };

  const handleAdminSuccess = (hash) => {
    setAdminHash(hash);
    setStoredAdminHash(roomId, hash);
    setIsAdminModalOpen(false);
    if (afterAdmin === 'settings') setIsAdminDashboardOpen(true);
    setAfterAdmin(null);
  };

  // Cài đặt là của admin: chưa có hash của ĐÚNG phòng thì hỏi PIN đã.
  const handleOpenSettings = () => {
    if (!requireAdminHash('settings')) return;
    setIsAdminDashboardOpen(true);
  };

  const enterRoom = (nextRoom) => {
    setRoomGateOpen(false);
    switchRoom(nextRoom);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
        <p className="text-xs font-bold text-slate-700">Đang tải sổ chi tiêu...</p>
      </div>
    );
  }

  // Phòng ở ?p= không tồn tại trên server: dừng lại ở màn tạo / vào phòng,
  // không vẽ một sổ trống toorg rồi để người dùng tưởng mất dữ liệu.
  if (data?.source === 'need_room') {
    return <RoomGate missingRoomId={roomId} onEnter={enterRoom} />;
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      {/* Header */}
      <Header
        roomName={data.room_name || data.settings?.room_name}
        source={data.source}
        rooms={rooms}
        currentRoomId={roomId}
        memberName={session?.member_name}
        onSwitchRoom={switchRoom}
        onOpenCreateRoom={() => setRoomGateOpen(true)}
        onOpenAddExpense={() => {
          setEditingExpense(null);
          setIsExpenseModalOpen(true);
        }}
        onOpenSettings={handleOpenSettings}
      />

      {/* Main compact layout */}
      <main className="max-w-xl w-full mx-auto px-3 sm:px-4 py-3 space-y-3 flex-1">
        {/* Month Selector */}
        <PeriodSelector
          periods={data.periods || []}
          selectedPeriodId={selectedPeriodId}
          onSelectPeriod={(id) => setSelectedPeriodId(id)}
        />

        {/* Overview Stats */}
        <OverviewStats
          totalAllExpenses={debts.totalAllExpenses}
          sharedPerMember={debts.sharedPerMember}
          paidCount={debts.paidCount}
          partialCount={debts.partialCount}
          totalMembers={debts.totalMembers}
          totalCollected={debts.totalCollected}
          remaining={debts.remaining}
        />

        {/* Member Cards & VietQR */}
        <MemberCardList
          memberCalculations={debts.memberCalculations}
          periodId={activePeriod?.id || ''}
          onOpenQr={handleOpenQr}
          onTogglePaid={handleTogglePaid}
          onRecordPayment={handleRecordPayment}
          onSelectMember={(calc) => setDetailMemberId(calc.member.id)}
        />

        {/* Expenses List */}
        <ExpenseList
          expenses={currentPeriodExpenses}
          members={data.members || []}
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

      {/* Expense Modal */}
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

      {/* VietQR Modal */}
      <VietQrModal
        isOpen={isQrOpen}
        onClose={() => setIsQrOpen(false)}
        calculation={selectedCalculation}
        settings={data.settings}
        periodTitle={activePeriod?.title || ''}
        roomId={roomId}
      />

      {/* Partial Payment Modal */}
      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => {
          setIsPaymentOpen(false);
          setPaymentCalculation(null);
        }}
        calc={paymentCalculation}
        onConfirm={handleConfirmPayment}
      />

      {/* Member Detail Modal */}
      <MemberDetailModal
        isOpen={!!detailMemberId}
        onClose={() => setDetailMemberId(null)}
        calc={detailCalc}
        members={data.members || []}
        sharedExpenses={debts.sharedExpenses || []}
        onOpenQr={handleOpenQr}
        onTogglePaid={handleDetailToggle}
        onRecordPayment={handleRecordPayment}
      />

      {/* Admin PIN & Hash Modal */}
      <AdminModal
        isOpen={isAdminModalOpen}
        roomId={roomId}
        roomName={data.room_name}
        onClose={() => setIsAdminModalOpen(false)}
        onSuccess={handleAdminSuccess}
      />

      {/* Admin Settings Dashboard */}
      <AdminDashboard
        isOpen={isAdminDashboardOpen}
        roomId={roomId}
        onClose={() => setIsAdminDashboardOpen(false)}
        data={data}
        adminHash={adminHash}
        onDataRefresh={loadData}
      />

      {/* Tạo phòng / vào phòng bằng link mời */}
      <RoomGate
        isOpen={roomGateOpen}
        onClose={() => setRoomGateOpen(false)}
        onEnter={enterRoom}
      />
    </div>
  );
}
