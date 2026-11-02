// API service: tài khoản + phòng qua Cloudflare Pages Functions and Firestore.
// Ghi sổ CHỈ đi qua máy chủ; offline chỉ còn đọc bản cache của phòng đã từng tải.
import { signOutGoogle } from './firebase';

export const DEFAULT_ROOM = 'phong-2a';
const AUTH_KEY = 'pct:auth';
const LAST_ROOM_KEY = 'pct:lastRoom';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const dataKey = (roomId) => `pct:data:${roomId}`;

export function roomIdFromUrl(search = (typeof window !== 'undefined' ? window.location.search : '')) {
  const raw = new URLSearchParams(search).get('p');
  return raw && raw.trim() ? raw.trim() : DEFAULT_ROOM;
}

// ---- Phiên tài khoản ----

export function getAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const auth = JSON.parse(raw);
    if (!auth?.token) return null;
    if (auth.expires_at && new Date(auth.expires_at).getTime() <= Date.now()) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return auth;
  } catch (e) {
    return null;
  }
}

export function setAuth({ token, expires_at, user }) {
  if (!token) {
    localStorage.removeItem(AUTH_KEY);
    return;
  }
  const previous = getAuth();
  localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({ token, expires_at, user: user || previous?.user || null })
  );
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

export function getStoredUser() {
  return getAuth()?.user || null;
}

export function getLastRoomId() {
  return localStorage.getItem(LAST_ROOM_KEY) || '';
}

export function setLastRoomId(roomId) {
  if (roomId) localStorage.setItem(LAST_ROOM_KEY, roomId);
}

// Bản 2 dùng PIN theo phòng; xoá một lần để khỏi đọc nhầm credential cũ.
export function clearLegacyStorage() {
  try {
    const remove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith('pct:hash:') ||
        key.startsWith('pct:session:') ||
        key.startsWith('pct:member:') ||
        key === 'phong_chi_tieu_admin_hash' ||
        key === 'phong_chi_tieu_data_v2'
      ) {
        remove.push(key);
      }
    }
    remove.forEach((key) => localStorage.removeItem(key));
  } catch (e) {
    // localStorage bị chặn thì bỏ qua
  }
}

// ---- Gọi máy chủ ----

async function request(path, { method = 'GET', body, roomId, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? getAuth()?.token : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let url = API_BASE_URL ? `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}` : path;
  if (roomId) url += (url.includes('?') ? '&' : '?') + `p=${encodeURIComponent(roomId)}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    return { res: null, data: { error: 'Không gọi được máy chủ (offline?).' }, offline: true };
  }
  const data = await res.json().catch(() => ({}));
  // Chỉ phiên chết mới xoá token; 401 "sai mật khẩu" ở login không có needs_auth.
  if (res.status === 401 && data?.needs_auth) clearAuth();
  return { res, data };
}

async function mutate(path, { roomId, body, method = 'POST' } = {}) {
  const { res, data, offline } = await request(path, { method, body, roomId });
  if (offline) {
    return { success: false, offline: true, error: 'Không gọi được máy chủ. Thao tác chưa được lưu.' };
  }
  if (res.status === 401) {
    return { success: false, unauthorized: true, error: data.error || 'Phiên đã hết hạn, đăng nhập lại.' };
  }
  if (!res.ok) {
    return { success: false, status: res.status, error: data.error || `Máy chủ trả ${res.status}.` };
  }
  return { success: true, ...data };
}

// ---- Tài khoản ----

export async function authGoogle(idToken) {
  const { res, data, offline } = await request('/api/auth/google', {
    method: 'POST',
    auth: false,
    body: { id_token: idToken },
  });
  if (offline) return { success: false, error: 'Không gọi được máy chủ (offline?).' };
  if (!res.ok) return { success: false, error: data.error || 'Không đăng nhập được bằng Google.' };
  setAuth({ token: data.token, expires_at: data.expires_at, user: data.user });
  return { success: true, user: data.user };
}

export async function authLogout() {
  await request('/api/auth/logout', { method: 'POST' });
  clearAuth();
  await signOutGoogle();
}

export async function authMe() {
  const { res, data, offline } = await request('/api/auth/me');
  if (offline) return { offline: true, error: 'Không gọi được máy chủ (offline?).' };
  if (res.status === 401) {
    clearAuth();
    return { needsAuth: true };
  }
  if (!res.ok) return { error: data.error || `Không tải được tài khoản (HTTP ${res.status}).` };
  const auth = getAuth();
  if (auth) setAuth({ ...auth, user: data.user });
  return {
    user: data.user,
    rooms: data.rooms || [],
    pending_requests: data.pending_requests || [],
  };
}

export async function previewInvite(token) {
  const { res, data, offline } = await request(`/api/invites/${encodeURIComponent(token)}`, { auth: false });
  if (offline) return { success: false, error: 'Không gọi được máy chủ (offline?).' };
  if (!res.ok) return { success: false, error: data.error || 'Link mời không còn hiệu lực.' };
  return { success: true, ...data };
}

export async function claimInvite(token) {
  return mutate('/api/invites/claim', { body: { token } });
}

export async function recoverOwner({ roomId, pin, newPin }) {
  const body = { pin, new_pin: newPin };
  const { res, data, offline } = await request('/api/rooms/recover-owner', {
    method: 'POST',
    roomId,
    body,
  });
  if (offline) return { success: false, error: 'Không gọi được máy chủ (offline?).' };
  if (!res.ok) {
    return {
      success: false,
      status: res.status,
      error: data.error || 'Không khôi phục được quyền chủ phòng.',
      field: data.field,
    };
  }
  setAuth({ token: data.token, expires_at: data.expires_at, user: data.user });
  return {
    success: true,
    room_id: data.room_id,
    room_name: data.room_name,
    member_id: data.member_id,
    user: data.user,
  };
}

// ---- Đọc dữ liệu phòng ----

function readCachedRoom(roomId) {
  try {
    const raw = localStorage.getItem(dataKey(roomId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeCachedRoom(roomId, data) {
  try {
    localStorage.setItem(dataKey(roomId), JSON.stringify(data));
  } catch (e) {
    // đầy quota thì thôi, chỉ ảnh hưởng chế độ offline
  }
}

export function normalizeRoom(blob, roomId = DEFAULT_ROOM) {
  const src = blob && typeof blob === 'object' ? blob : {};
  const members = Array.isArray(src.members) ? src.members : [];
  return {
    room_id: src.room_id || roomId,
    room_name: src.room_name || (src.settings && src.settings.room_name) || roomId,
    owner_member_id: src.owner_member_id || null,
    me: src.me || null,
    settings: { ...(src.settings || {}) },
    members,
    periods: Array.isArray(src.periods) ? src.periods : [],
    expenses: Array.isArray(src.expenses) ? src.expenses : [],
    member_shares: Array.isArray(src.member_shares) ? src.member_shares : [],
    activity_logs: Array.isArray(src.activity_logs) ? src.activity_logs : [],
  };
}

// source: 'firestore' | 'offline' | 'offline_empty' | 'need_auth' | 'forbidden' | 'need_room' | 'error'
export async function fetchRoomData(roomId) {
  const { res, data, offline } = await request('/api/data', { roomId });
  if (offline) {
    const cached = readCachedRoom(roomId);
    return {
      ...normalizeRoom(cached, roomId),
      source: cached ? 'offline' : 'offline_empty',
      offline: true,
    };
  }
  if (res.status === 401) {
    return { ...normalizeRoom(null, roomId), source: 'need_auth', status: 401 };
  }
  if (res.status === 403) {
    return {
      ...normalizeRoom(null, roomId),
      source: 'forbidden',
      status: 403,
      error: data.error || 'Bạn không còn quyền vào phòng này.',
    };
  }
  if (res.status === 404) {
    return { ...normalizeRoom(null, roomId), source: 'need_room', status: 404 };
  }
  if (!res.ok) {
    return {
      ...normalizeRoom(null, roomId),
      source: 'error',
      status: res.status,
      error: data.error || `Máy chủ trả ${res.status}.`,
    };
  }
  writeCachedRoom(roomId, data);
  return { ...normalizeRoom(data, roomId), source: 'firestore' };
}

// ---- Ghi sổ (cần tài khoản + quyền; server là nguồn sự thật) ----

export async function createRoom({ name, pin, ownerName }) {
  const result = await mutate('/api/rooms', {
    body: { name, pin, owner_name: ownerName || '' },
  });
  if (!result.success) return result;
  return { success: true, room_id: result.room?.room_id, room: result.room };
}

export async function searchRooms(query = '') {
  const { res, data, offline } = await request(`/api/rooms/search?q=${encodeURIComponent(query)}`);
  if (offline) return { success: false, error: 'Không kết nối được máy chủ.' };
  if (!res.ok) return { success: false, error: data.error || 'Lỗi tìm kiếm phòng.' };
  return { success: true, rooms: data.rooms || [] };
}

export async function requestJoinRoom(roomId) {
  return mutate('/api/rooms/request-join', { body: { room_id: roomId } });
}

export async function updateSettings(roomId, settings) {
  return mutate('/api/admin/settings', { roomId, body: settings });
}

export async function setRoomPin(roomId, newPin) {
  return mutate('/api/admin/pin', { roomId, body: { new_pin: newPin } });
}

export async function saveMember(roomId, member) {
  return mutate('/api/admin/members', { roomId, body: member });
}

export async function deactivateMember(roomId, memberId) {
  return mutate(`/api/admin/members/${encodeURIComponent(memberId)}/deactivate`, { roomId });
}

export async function reactivateMember(roomId, memberId) {
  return mutate(`/api/admin/members/${encodeURIComponent(memberId)}/reactivate`, { roomId });
}

export async function setMemberRole(roomId, memberId, role) {
  return mutate(`/api/admin/members/${encodeURIComponent(memberId)}/role`, { roomId, body: { role } });
}

export async function unlinkMember(roomId, memberId) {
  return mutate(`/api/admin/members/${encodeURIComponent(memberId)}/unlink`, { roomId });
}

export async function savePeriod(roomId, period) {
  return mutate('/api/admin/periods', { roomId, body: period });
}

export async function deletePeriod(roomId, periodId) {
  return mutate(`/api/admin/periods/${encodeURIComponent(periodId)}`, { roomId, method: 'DELETE' });
}

export async function saveExpense(roomId, expense) {
  const dateStr = expense.expense_date || new Date().toISOString().split('T')[0];
  const [y, m] = dateStr.split('-');
  const periodId = expense.period_id || `${y}-${m}`;
  const result = await mutate('/api/admin/expenses', {
    roomId,
    body: { ...expense, expense_date: dateStr, period_id: periodId },
  });
  if (result.success) return { ...result, period_id: result.period_id || periodId };
  return result;
}

export async function deleteExpense(roomId, expenseId) {
  return mutate(`/api/admin/expenses/${encodeURIComponent(expenseId)}`, { roomId, method: 'DELETE' });
}

export async function toggleSharePaid(roomId, periodId, memberId, isPaid, paidAmount) {
  const body = { period_id: periodId, member_id: memberId, is_paid: isPaid };
  if (paidAmount !== undefined && paidAmount !== null) {
    body.paid_amount = Math.max(0, parseInt(paidAmount, 10) || 0);
  }
  return mutate('/api/admin/toggle-share-paid', { roomId, body });
}

export async function memberTogglePaid(roomId, { period_id, is_paid, paid_amount }) {
  const body = { period_id, is_paid };
  if (paid_amount !== undefined && paid_amount !== null) body.paid_amount = paid_amount;
  return mutate('/api/member/toggle-share-paid', { roomId, body });
}

export async function leaveRoom(roomId) {
  return mutate('/api/rooms/leave', { roomId });
}

export async function createInvite(roomId, memberId, { ttlMin, role = 'member' } = {}) {
  const body = { member_id: memberId, role };
  if (ttlMin) body.ttl_min = ttlMin;
  const result = await mutate('/api/admin/invites', { roomId, body });
  if (!result.success) return result;
  return { ...result, linkToken: result.token };
}

export async function fetchJoinRequests(roomId) {
  const { res, data, offline } = await request('/api/admin/join-requests', { roomId });
  if (offline) return { success: false, error: 'Không gọi được máy chủ (offline?).' };
  if (!res.ok) return { success: false, error: data.error || `Máy chủ trả ${res.status}.` };
  return { success: true, requests: data.requests || [] };
}

export async function reviewJoinRequest(roomId, requestId, decision) {
  return mutate(
    `/api/admin/join-requests/${encodeURIComponent(requestId)}/${decision}`,
    { roomId }
  );
}

export async function transferOwner(roomId, memberId) {
  return mutate('/api/admin/transfer-owner', { roomId, body: { member_id: memberId } });
}

// ---- Mã phòng cho nội dung chuyển khoản ----

// Mã phòng đứng trước tên người trong nội dung chuyển khoản. Napas/VietQR cắt nội
// dung từ đuôi khi quá dài, nên mã phải ở đầu mới sống sót.
export function defaultTransferCode(roomId) {
  const tokens = String(roomId || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !['phong', 'tro', 'nha', 'nhatro', 'phongtro'].includes(t));
  return (meaningful.length ? meaningful : tokens).join('').toUpperCase().slice(0, 6);
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
// allMembers: danh sách CẢ người đã rời. split_config lưu id chứ không lưu "ai đang ở
// phòng", nên một khoản đã ghi cho A+B vẫn phải là A+B sau khi B rời - nếu lọc theo
// người active rồi chia lại, xóa một người sẽ làm hóa đơn của những người còn lại đổi số.
export function calcExpenseShares(exp, activeMembers = [], allMembers = null) {
  const result = {};
  activeMembers.forEach((m) => {
    result[m.id] = 0;
  });
  const add = (id, v) => { result[id] = (result[id] || 0) + v; };
  const amount = parseInt(exp?.amount) || 0;
  if (amount <= 0 || activeMembers.length === 0) return result;

  // Khoản mua riêng gán 1 người thì không chia ở đây (xử lý riêng bên ngoài)
  if (exp?.target_member_id) return result;

  const cfg = parseSplitConfig(exp);
  const knownIds = new Set((allMembers && allMembers.length ? allMembers : activeMembers).map((m) => m.id));
  activeMembers.forEach((m) => knownIds.add(m.id));

  if (cfg.mode === 'custom') {
    const ids = (cfg.member_ids || []).filter((id) => knownIds.has(id));
    // Chỉ config thật sự trống (toàn id lạ) mới quay về chia đều cho người đang ở.
    const parts = ids.length > 0 ? ids : activeMembers.map((m) => m.id);
    const each = amount / parts.length;
    parts.forEach((id) => add(id, each));
    return result;
  }

  if (cfg.mode === 'fixed') {
    const fixedValid = (cfg.fixed || []).filter((f) => knownIds.has(f.member_id));
    const fixedTotal = fixedValid.reduce((s, f) => s + f.amount, 0);
    if (fixedTotal > amount && fixedTotal > 0) {
      // Cố định vượt quá tổng bill -> scale down theo tỉ lệ để không bị âm
      const scale = amount / fixedTotal;
      fixedValid.forEach((f) => add(f.member_id, f.amount * scale));
      return result;
    }
    fixedValid.forEach((f) => add(f.member_id, f.amount));
    const remainder = amount - fixedTotal;
    let splitIds = (cfg.member_ids || []).filter((id) => knownIds.has(id));
    if (splitIds.length === 0 && remainder > 0) {
      splitIds = activeMembers.map((m) => m.id);
    }
    if (splitIds.length > 0 && remainder > 0) {
      const each = remainder / splitIds.length;
      splitIds.forEach((id) => add(id, each));
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
export function calculatePeriodDebts(periodExpenses = [], activeMembers = [], memberShares = [], periodId = '', allMembers = null) {
  // 1. Separate shared expenses from individual/personal expenses
  const sharedExpenses = [];
  const personalExpensesByMember = {};

  activeMembers.forEach((m) => {
    personalExpensesByMember[m.id] = [];
  });

  const known = allMembers && allMembers.length ? allMembers : activeMembers;
  const knownIds = new Set(known.map((m) => m.id));

  periodExpenses.forEach((exp) => {
    const target = exp.target_member_id;
    // Khoản gán cho người ĐÃ RỜI vẫn là khoản riêng của họ: để nó lọt vào
    // sharedExpenses thì phần tiền đó bị chia lại cho những người còn đang ở.
    if (!target || !knownIds.has(target)) {
      sharedExpenses.push(exp);
      return;
    }
    if (!personalExpensesByMember[target]) personalExpensesByMember[target] = [];
    personalExpensesByMember[target].push(exp);
  });

  const totalSharedAmount = sharedExpenses.reduce((sum, e) => sum + (parseInt(e.amount) || 0), 0);

  // Cộng dồn phần chia chung của từng member theo split_config của từng khoản
  const sharedRawByMember = {};
  const sharedItemsByMember = {};
  activeMembers.forEach((m) => {
    sharedRawByMember[m.id] = 0;
    sharedItemsByMember[m.id] = [];
  });
  sharedExpenses.forEach((exp) => {
    const shares = calcExpenseShares(exp, activeMembers, known);
    activeMembers.forEach((m) => {
      const raw = shares[m.id] || 0;
      if (raw > 0) {
        sharedRawByMember[m.id] += raw;
        sharedItemsByMember[m.id].push({ expense: exp, share: Math.round(raw) });
      }
    });
  });

  // Bình quân hiển thị overview. Lấy trung bình phần THỰC TẾ của những người đang ở,
  // không lấy tổng hóa đơn chia cho số người active: khi có người đã rời, phần của họ
  // vẫn nằm trong hóa đơn nhưng không ai phải nộp nữa, chia kiểu cũ sẽ ra con số
  // cao hơn mọi thẻ thành viên trên cùng một màn hình.
  const sharedPerMember =
    activeMembers.length > 0
      ? Math.round(
          activeMembers.reduce((sum, m) => sum + (sharedRawByMember[m.id] || 0), 0) /
            activeMembers.length
        )
      : 0;

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
