import React, { useState, useEffect, useMemo } from 'react';
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
import {
  fetchRoomData,
  saveExpense,
  deleteExpense,
  toggleSharePaid,
  getStoredAdminHash,
  calculatePeriodDebts,
  INITIAL_DATA,
} from './services/api';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [data, setData] = useState(INITIAL_DATA);
  const [loading, setLoading] = useState(true);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  // Admin hash (defaults to hardcoded hash, remembers in localStorage)
  const [adminHash, setAdminHash] = useState(() => getStoredAdminHash());

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

  // Load room data
  const loadData = async () => {
    try {
      const res = await fetchRoomData();
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

  useEffect(() => {
    loadData();
  }, []);

  // Ensure selected period is valid
  useEffect(() => {
    if (data.periods && data.periods.length > 0) {
      const exists = data.periods.some((p) => p.id === selectedPeriodId);
      if (!exists) {
        setSelectedPeriodId(data.periods[0].id);
      }
    }
  }, [data.periods, selectedPeriodId]);

  // Current Period & Filtered Expenses
  const activePeriod =
    data.periods?.find((p) => p.id === selectedPeriodId) || data.periods?.[0];

  const currentPeriodExpenses = useMemo(() => {
    return (data.expenses || []).filter((e) => e.period_id === activePeriod?.id);
  }, [data.expenses, activePeriod]);

  const activeMembers = useMemo(() => {
    return (data.members || []).filter((m) => m.is_active !== 0);
  }, [data.members]);

  // Auto-calculated debts and shares
  const debts = useMemo(() => {
    return calculatePeriodDebts(
      currentPeriodExpenses,
      activeMembers,
      data.member_shares || [],
      activePeriod?.id || ''
    );
  }, [currentPeriodExpenses, activeMembers, data.member_shares, activePeriod]);

  // Handlers
  const handleSaveExpense = async (expense) => {
    const hash = adminHash || getStoredAdminHash();
    const result = await saveExpense(expense, hash);
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
      const hash = adminHash || getStoredAdminHash();
      await deleteExpense(id, hash);
      await loadData();
    }
  };

  const handleTogglePaid = async (periodId, memberId, nextPaid, paidAmount) => {
    const targetPeriod = periodId || activePeriod?.id;
    const hash = adminHash || getStoredAdminHash();
    await toggleSharePaid(targetPeriod, memberId, nextPaid, hash, paidAmount);
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
    localStorage.setItem('phong_chi_tieu_admin_hash', hash);
    setIsAdminModalOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
        <p className="text-xs font-bold text-slate-700">Đang tải sổ chi tiêu...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      {/* Header */}
      <Header
        roomName={data.settings?.room_name}
        source={data.source}
        onOpenAddExpense={() => {
          setEditingExpense(null);
          setIsExpenseModalOpen(true);
        }}
        onOpenSettings={() => setIsAdminDashboardOpen(true)}
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
        onClose={() => setIsAdminModalOpen(false)}
        onSuccess={handleAdminSuccess}
      />

      {/* Admin Settings Dashboard */}
      <AdminDashboard
        isOpen={isAdminDashboardOpen}
        onClose={() => setIsAdminDashboardOpen(false)}
        data={data}
        adminHash={adminHash}
        onDataRefresh={loadData}
      />
    </div>
  );
}
