// API service communicating with Cloudflare Pages Functions & LocalStorage fallback
import { sha256 } from './crypto';

const LOCAL_STORAGE_KEY = 'phong_chi_tieu_data_v2';
const ADMIN_HASH_KEY = 'phong_chi_tieu_admin_hash';

// Default PIN is 123456 -> SHA-256: 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92
export const DEFAULT_ADMIN_PIN_HASH = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';

export const INITIAL_DATA = {
  settings: {
    room_name: 'Phòng Trọ 2A',
    bank_id: 'MB',
    account_no: '0987654321',
    account_name: 'NGUYEN VAN QUAN TRI',
    transfer_prefix: 'TIEN PHONG',
  },
  members: [
    { id: 'mem_1', name: 'Nguyễn Văn An', nickname: 'An', phone: '0901234561', is_active: 1 },
    { id: 'mem_2', name: 'Trần Thị Bình', nickname: 'Bin', phone: '0901234562', is_active: 1 },
    { id: 'mem_3', name: 'Lê Hoàng Cường', nickname: 'Cường', phone: '0901234563', is_active: 1 },
    { id: 'mem_4', name: 'Phạm Minh Đức', nickname: 'Đức', phone: '0901234564', is_active: 1 },
  ],
  periods: [
    { id: '2026-10', title: 'Tháng 10/2026', due_date: '2026-10-20', status: 'open' },
  ],
  expenses: [
    { id: 'exp_1', period_id: '2026-10', expense_date: '2026-10-01', category: 'phong', title: 'Tiền thuê phòng', amount: 4800000, note: 'Tiền phòng cố định' },
    { id: 'exp_2', period_id: '2026-10', expense_date: '2026-10-05', category: 'dien', title: 'Tiền điện', amount: 620000, note: '' },
    { id: 'exp_3', period_id: '2026-10', expense_date: '2026-10-08', category: 'nuoc_uong', title: 'Nước uống bình', amount: 100000, quantity: 4, unit_price: 25000, note: '4 thùng x 25k' },
    { id: 'exp_4', period_id: '2026-10', expense_date: '2026-10-10', category: 'mang', title: 'Internet Viettel', amount: 220000, note: 'Cước cố định' },
    { id: 'exp_5', period_id: '2026-10', expense_date: '2026-10-11', category: 'rac', title: 'Tiền rác', amount: 60000, note: 'Vệ sinh chung' },
    { id: 'exp_6', period_id: '2026-10', expense_date: '2026-10-12', category: 'rieng', title: 'Mua đồ ăn riêng cho Bin', amount: 50000, target_member_id: 'mem_2', note: 'Bin nhờ mua chưa gửi tiền' },
  ],
  member_shares: [
    { id: '2026-10_mem_1', period_id: '2026-10', member_id: 'mem_1', is_paid: 1, paid_at: '2026-10-12T09:30:00Z' },
    { id: '2026-10_mem_2', period_id: '2026-10', member_id: 'mem_2', is_paid: 0, paid_at: null },
    { id: '2026-10_mem_3', period_id: '2026-10', member_id: 'mem_3', is_paid: 1, paid_at: '2026-10-12T14:15:00Z' },
    { id: '2026-10_mem_4', period_id: '2026-10', member_id: 'mem_4', is_paid: 0, paid_at: null },
  ],
};

function getLocalData() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(INITIAL_DATA));
      return INITIAL_DATA;
    }
    return JSON.parse(raw);
  } catch (e) {
    return INITIAL_DATA;
  }
}

function saveLocalData(data) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save to local storage', e);
  }
}

export function getStoredAdminHash() {
  return localStorage.getItem(ADMIN_HASH_KEY) || DEFAULT_ADMIN_PIN_HASH;
}

export function setStoredAdminHash(hash) {
  localStorage.setItem(ADMIN_HASH_KEY, hash);
}

// Fetch all public room data
export async function fetchRoomData() {
  try {
    const res = await fetch('/api/data');
    if (res.ok) {
      const data = await res.json();
      if (data.hasD1) {
        return { ...data, source: 'd1' };
      }
    }
  } catch (err) {}
  return { ...getLocalData(), source: 'local' };
}

// Verify Admin PIN
export async function verifyAdminPin(pin) {
  const hash = await sha256(pin);
  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin_hash: hash }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.valid) return { valid: true, hash };
    }
  } catch (e) {}

  const currentHash = getStoredAdminHash();
  const valid = hash.toLowerCase() === currentHash.toLowerCase();
  return { valid, hash };
}

// Update Room Settings
export async function updateSettings(settings, adminHash) {
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-hash': adminHash,
      },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) return true;
    }
  } catch (e) {}

  const current = getLocalData();
  current.settings = { ...current.settings, ...settings };
  saveLocalData(current);
  return true;
}

// Save or Update Member
export async function saveMember(member, adminHash) {
  try {
    const res = await fetch('/api/admin/members', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-hash': adminHash,
      },
      body: JSON.stringify(member),
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData();
  const id = member.id || 'mem_' + Date.now();
  const idx = current.members.findIndex((m) => m.id === id);
  if (idx >= 0) {
    current.members[idx] = { ...current.members[idx], ...member };
  } else {
    current.members.push({ ...member, id, is_active: 1 });
  }
  saveLocalData(current);
  return true;
}

// Delete Member
export async function deleteMember(memberId, adminHash) {
  try {
    const res = await fetch(`/api/admin/members/${memberId}`, {
      method: 'DELETE',
      headers: { 'x-admin-hash': adminHash },
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData();
  current.members = current.members.filter((m) => m.id !== memberId);
  current.member_shares = current.member_shares.filter((s) => s.member_id !== memberId);
  current.expenses = current.expenses.map((e) =>
    e.target_member_id === memberId ? { ...e, target_member_id: null } : e
  );
  saveLocalData(current);
  return true;
}

// Save or Update Period
export async function savePeriod(period, adminHash) {
  try {
    const res = await fetch('/api/admin/periods', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-hash': adminHash,
      },
      body: JSON.stringify(period),
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData();
  const id = period.id || 'period_' + Date.now();
  const idx = current.periods.findIndex((p) => p.id === id);
  if (idx >= 0) {
    current.periods[idx] = { ...current.periods[idx], ...period };
  } else {
    current.periods.unshift({ ...period, id, status: period.status || 'open' });
  }
  saveLocalData(current);
  return true;
}

// Delete Period
export async function deletePeriod(periodId, adminHash) {
  try {
    const res = await fetch(`/api/admin/periods/${periodId}`, {
      method: 'DELETE',
      headers: { 'x-admin-hash': adminHash },
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData();
  current.periods = current.periods.filter((p) => p.id !== periodId);
  current.expenses = current.expenses.filter((e) => e.period_id !== periodId);
  current.member_shares = current.member_shares.filter((s) => s.period_id !== periodId);
  saveLocalData(current);
  return true;
}

// Save or Update Expense
export async function saveExpense(expense, adminHash) {
  const dateStr = expense.expense_date || new Date().toISOString().split('T')[0];
  const [y, m] = dateStr.split('-');
  const periodId = expense.period_id || `${y}-${m}`;

  try {
    const res = await fetch('/api/admin/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-hash': adminHash,
      },
      body: JSON.stringify({
        ...expense,
        expense_date: dateStr,
        period_id: periodId,
      }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: true, period_id: periodId, id: data.id };
    }
    const errData = await res.json().catch(() => ({}));
    if (res.status === 401) {
      return { success: false, unauthorized: true, error: 'Mã PIN Admin chưa chính xác!' };
    }
    return { success: false, error: errData.error || 'Lỗi máy chủ khi lưu chi tiêu' };
  } catch (e) {
    // Fallback if offline
  }

  // Fallback Local
  const current = getLocalData();
  const id = expense.id || 'exp_' + Date.now();

  // Ensure period in local
  if (!current.periods.some((p) => p.id === periodId)) {
    current.periods.unshift({
      id: periodId,
      title: `Tháng ${m}/${y}`,
      due_date: '',
      status: 'open',
    });
  }

  const idx = current.expenses.findIndex((e) => e.id === id);
  const updatedExp = {
    ...expense,
    id,
    period_id: periodId,
    expense_date: dateStr,
  };

  if (idx >= 0) {
    current.expenses[idx] = updatedExp;
  } else {
    current.expenses.unshift(updatedExp);
  }
  saveLocalData(current);
  return { success: true, period_id: periodId, id };
}

// Delete Expense
export async function deleteExpense(expenseId, adminHash) {
  try {
    const res = await fetch(`/api/admin/expenses/${expenseId}`, {
      method: 'DELETE',
      headers: { 'x-admin-hash': adminHash },
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData();
  current.expenses = current.expenses.filter((e) => e.id !== expenseId);
  saveLocalData(current);
  return true;
}

// Toggle Payment Status (hỗ trợ trả góp từng phần qua paidAmount)
// - paidAmount undefined: giữ nguyên số đã trả cũ, chỉ đổi cờ is_paid (tương thích cũ)
// - paidAmount number: ghi đè số tiền thực tế đã trả (0 = chưa nộp, = tổng bill = nộp đủ)
export async function toggleSharePaid(periodId, memberId, isPaid, adminHash, paidAmount) {
  const body = {
    period_id: periodId,
    member_id: memberId,
    is_paid: isPaid,
  };
  if (paidAmount !== undefined && paidAmount !== null) {
    body.paid_amount = Math.max(0, parseInt(paidAmount) || 0);
  }
  try {
    const res = await fetch('/api/admin/toggle-share-paid', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-hash': adminHash,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData();
  const share = current.member_shares.find(
    (s) => s.period_id === periodId && s.member_id === memberId
  );
  if (share) {
    share.is_paid = isPaid ? 1 : 0;
    share.paid_at = isPaid ? new Date().toISOString() : null;
    if (body.paid_amount !== undefined) share.paid_amount = body.paid_amount;
  } else {
    current.member_shares.push({
      id: `${periodId}_${memberId}`,
      period_id: periodId,
      member_id: memberId,
      amount: 0,
      is_paid: isPaid ? 1 : 0,
      paid_at: isPaid ? new Date().toISOString() : null,
      paid_amount: body.paid_amount !== undefined ? body.paid_amount : 0,
      note: '',
    });
  }
  saveLocalData(current);
  return true;
}

// ---- Split config helpers (chia tiền chi tiết theo từng khoản) ----
// split_config shape:
//   { mode: 'all' }                                              -> chia đều tất cả (mặc định)
//   { mode: 'custom', member_ids: [...] }                         -> chỉ chia cho N người cụ thể
//   { mode: 'fixed', fixed: [{member_id, amount}], member_ids }   -> vài người chịu số cố định, phần còn lại chia đều cho member_ids
export function parseSplitConfig(exp) {
  const fallback = { mode: 'all', member_ids: [], fixed: [] };
  if (!exp || exp.split_config === undefined || exp.split_config === null || exp.split_config === '') {
    return fallback;
  }
  try {
    const cfg = typeof exp.split_config === 'string' ? JSON.parse(exp.split_config) : exp.split_config;
    if (!cfg || typeof cfg !== 'object') return fallback;
    const mode = cfg.mode === 'custom' || cfg.mode === 'fixed' ? cfg.mode : 'all';
    const member_ids = Array.isArray(cfg.member_ids) ? cfg.member_ids.filter((id) => typeof id === 'string') : [];
    const fixed = Array.isArray(cfg.fixed)
      ? cfg.fixed
          .map((f) => ({ member_id: f?.member_id, amount: parseInt(f?.amount) || 0 }))
          .filter((f) => f.member_id && f.amount > 0)
      : [];
    return { mode, member_ids, fixed };
  } catch (e) {
    return fallback;
  }
}

// Tính số tiền mỗi member phải chịu cho 1 khoản chi (raw float, cộng dồn rồi round ở cuối)
export function calcExpenseShares(exp, activeMembers = []) {
  const result = {};
  activeMembers.forEach((m) => {
    result[m.id] = 0;
  });
  const amount = parseInt(exp?.amount) || 0;
  if (amount <= 0 || activeMembers.length === 0) return result;

  // Khoản mua riêng gán 1 người thì không chia ở đây (xử lý riêng bên ngoài)
  if (exp?.target_member_id) return result;

  const cfg = parseSplitConfig(exp);
  const activeIds = new Set(activeMembers.map((m) => m.id));

  if (cfg.mode === 'custom') {
    const ids = (cfg.member_ids || []).filter((id) => activeIds.has(id));
    const parts = ids.length > 0 ? ids : activeMembers.map((m) => m.id);
    const each = amount / parts.length;
    parts.forEach((id) => {
      result[id] += each;
    });
    return result;
  }

  if (cfg.mode === 'fixed') {
    const fixedValid = (cfg.fixed || []).filter((f) => activeIds.has(f.member_id));
    const fixedTotal = fixedValid.reduce((s, f) => s + f.amount, 0);
    if (fixedTotal > amount && fixedTotal > 0) {
      // Cố định vượt quá tổng bill -> scale down theo tỉ lệ để không bị âm
      const scale = amount / fixedTotal;
      fixedValid.forEach((f) => {
        result[f.member_id] += f.amount * scale;
      });
      return result;
    }
    fixedValid.forEach((f) => {
      result[f.member_id] += f.amount;
    });
    const remainder = amount - fixedTotal;
    let splitIds = (cfg.member_ids || []).filter((id) => activeIds.has(id));
    if (splitIds.length === 0 && remainder > 0) {
      splitIds = activeMembers.map((m) => m.id);
    }
    if (splitIds.length > 0 && remainder > 0) {
      const each = remainder / splitIds.length;
      splitIds.forEach((id) => {
        result[id] += each;
      });
    }
    return result;
  }

  const each = amount / activeMembers.length;
  activeMembers.forEach((m) => {
    result[m.id] += each;
  });
  return result;
}

// Mô tả ngắn gọn cách chia của 1 khoản chi (hiển thị trong danh sách)
export function describeSplit(exp, members = []) {
  const nameOf = (id) => {
    const m = members.find((x) => x.id === id);
    return m ? m.nickname || m.name : '...';
  };
  if (exp?.target_member_id) {
    return `Riêng ${nameOf(exp.target_member_id)} chịu hết`;
  }
  const cfg = parseSplitConfig(exp);
  if (cfg.mode === 'custom') {
    if (!cfg.member_ids || cfg.member_ids.length === 0) return 'Chia đều cả phòng';
    return `Chia ${cfg.member_ids.length} người: ${cfg.member_ids.map(nameOf).join(', ')}`;
  }
  if (cfg.mode === 'fixed') {
    const fixedTxt = (cfg.fixed || [])
      .map((f) => `${nameOf(f.member_id)} ${formatCompact(f.amount)}`)
      .join(' + ');
    const splitIds = cfg.member_ids || [];
    const restTxt =
      splitIds.length > 0
        ? `còn lại chia ${splitIds.length} người (${splitIds.map(nameOf).join(', ')})`
        : 'còn lại chia đều cả phòng';
    return fixedTxt ? `${fixedTxt}, ${restTxt}` : restTxt;
  }
  return 'Chia đều cả phòng';
}

export function formatCompact(amount) {
  const n = parseInt(amount) || 0;
  if (n >= 1000000) {
    const v = n / 1000000;
    return `${Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')}tr`;
  }
  if (n >= 1000) {
    const v = n / 1000;
    return `${Number.isInteger(v) ? v : Math.round(v)}k`;
  }
  return String(n);
}

// Automatic calculation helper for room & personal expenses
export function calculatePeriodDebts(periodExpenses = [], activeMembers = [], memberShares = [], periodId = '') {
  // 1. Separate shared expenses from individual/personal expenses
  const sharedExpenses = [];
  const personalExpensesByMember = {};

  activeMembers.forEach((m) => {
    personalExpensesByMember[m.id] = [];
  });

  periodExpenses.forEach((exp) => {
    const amount = parseInt(exp.amount) || 0;
    if (exp.target_member_id && personalExpensesByMember[exp.target_member_id]) {
      personalExpensesByMember[exp.target_member_id].push(exp);
    } else {
      sharedExpenses.push(exp);
    }
  });

  const totalSharedAmount = sharedExpenses.reduce((sum, e) => sum + (parseInt(e.amount) || 0), 0);
  // Bình quân để hiển thị overview (mỗi người thực tế có thể khác nhau do chia custom)
  const sharedPerMember = activeMembers.length > 0 ? Math.round(totalSharedAmount / activeMembers.length) : 0;

  // Cộng dồn phần chia chung của từng member theo split_config của từng khoản
  const sharedRawByMember = {};
  const sharedItemsByMember = {};
  activeMembers.forEach((m) => {
    sharedRawByMember[m.id] = 0;
    sharedItemsByMember[m.id] = [];
  });
  sharedExpenses.forEach((exp) => {
    const shares = calcExpenseShares(exp, activeMembers);
    activeMembers.forEach((m) => {
      const raw = shares[m.id] || 0;
      if (raw > 0) {
        sharedRawByMember[m.id] += raw;
        sharedItemsByMember[m.id].push({ expense: exp, share: Math.round(raw) });
      }
    });
  });

  let totalCollected = 0;
  let paidCount = 0;
  let partialCount = 0;
  let totalAllExpenses = 0;

  const memberCalculations = activeMembers.map((member) => {
    const personalItems = personalExpensesByMember[member.id] || [];
    const personalTotal = personalItems.reduce((sum, e) => sum + (parseInt(e.amount) || 0), 0);
    const sharedAmount = Math.round(sharedRawByMember[member.id] || 0);
    const sharedItems = sharedItemsByMember[member.id] || [];
    const totalForMember = sharedAmount + personalTotal;

    totalAllExpenses += totalForMember;

    const shareRecord = memberShares.find(
      (s) => s.period_id === periodId && s.member_id === member.id
    );
    // Số thực tế đã trả (hỗ trợ trả góp từng phần). Dữ liệu cũ chỉ có cờ
    // is_paid mà paid_amount = 0 thì coi như đã nộp đủ (tương thích ngược).
    const recordedPaid = shareRecord ? parseInt(shareRecord.paid_amount) || 0 : 0;
    const legacyFullPaid = !!(shareRecord && shareRecord.is_paid) && recordedPaid <= 0;
    const effectivePaid = legacyFullPaid
      ? totalForMember
      : Math.min(Math.max(0, recordedPaid), totalForMember);
    const remaining = Math.max(0, totalForMember - effectivePaid);
    const isPartial = effectivePaid > 0 && remaining > 0;
    const isPaid =
      totalForMember > 0
        ? remaining <= 0 && (effectivePaid > 0 || legacyFullPaid)
        : !!(shareRecord && shareRecord.is_paid);

    totalCollected += effectivePaid;
    if (isPaid) {
      paidCount += 1;
    } else if (isPartial) {
      partialCount += 1;
    }

    return {
      member,
      sharedAmount,
      sharedItems,
      personalTotal,
      personalItems,
      totalAmount: totalForMember,
      paidAmount: effectivePaid,
      remaining,
      isPartial,
      isPaid,
      paidAt: shareRecord?.paid_at,
    };
  });

  const remaining = Math.max(0, totalAllExpenses - totalCollected);

  return {
    totalSharedAmount,
    sharedPerMember,
    totalAllExpenses,
    totalCollected,
    remaining,
    paidCount,
    partialCount,
    totalMembers: activeMembers.length,
    memberCalculations,
    sharedExpenses,
  };
}

// Utility: format VND currency
export function formatMoney(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Utility: Generate VietQR Image URL
export function generateVietQrUrl({ bankId, accountNo, accountName, amount, content }) {
  if (!bankId || !accountNo) return '';
  const cleanBank = encodeURIComponent(bankId.trim());
  const cleanAccount = encodeURIComponent(accountNo.trim());
  const cleanName = encodeURIComponent(accountName ? accountName.trim().toUpperCase() : '');
  const cleanInfo = encodeURIComponent(content ? content.trim() : '');
  const cleanAmount = parseInt(amount) || 0;

  return `https://img.vietqr.io/image/${cleanBank}-${cleanAccount}-compact2.png?amount=${cleanAmount}&addInfo=${cleanInfo}&accountName=${cleanName}`;
}
