// API service communicating with Cloudflare Pages Functions & LocalStorage fallback
import { sha256 } from './crypto';

// Mỗi phòng một namespace riêng trong localStorage. Khóa cũ (một phòng, không có
// room_id) được đọc và giữ nguyên để không mất dữ liệu offline của người dùng.
const LEGACY_DATA_KEY = 'phong_chi_tieu_data_v2';
const LEGACY_HASH_KEY = 'phong_chi_tieu_admin_hash';
const DEFAULT_ROOM_EXPORT = 'phong-2a';

export const DEFAULT_ROOM = DEFAULT_ROOM_EXPORT;

export function roomIdFromUrl(search = (typeof window !== 'undefined' ? window.location.search : '')) {
  const raw = new URLSearchParams(search).get('p');
  return raw && raw.trim() ? raw.trim() : DEFAULT_ROOM;
}

const dataKey = (roomId) => `pct:data:${roomId}`;
const hashKey = (roomId) => `pct:hash:${roomId}`;
const sessionKey = (roomId) => `pct:session:${roomId}`;
// Máy tạo phòng vào bằng PIN, không có phiên nên server không biết "tôi là ai".
// /api/rooms/leave cần đúng người, vì thế member_id do chính create-room trả về
// phải được nhớ lại - đây là dấu vết duy nhất, không phải credential.
const memberKey = (roomId) => `pct:member:${roomId}`;

const INITIAL_DATA = {
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
    { period_id: '2026-10', member_id: 'mem_1', is_paid: 1, paid_at: '2026-10-12T09:30:00Z' },
    { period_id: '2026-10', member_id: 'mem_2', is_paid: 0, paid_at: null },
    { period_id: '2026-10', member_id: 'mem_3', is_paid: 1, paid_at: '2026-10-12T14:15:00Z' },
    { period_id: '2026-10', member_id: 'mem_4', is_paid: 0, paid_at: null },
  ],
};

// Mã phòng đứng trước tên người trong nội dung chuyển khoản. Napas/VietQR cắt nội
// dung từ đuôi khi quá dài, nên mã phải ở đầu mới sống sót.
export function defaultTransferCode(roomId) {
  const tokens = String(roomId || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !['phong', 'tro', 'nha', 'nhatro', 'phongtro'].includes(t));
  return (meaningful.length ? meaningful : tokens).join('').toUpperCase().slice(0, 6);
}

// Phòng khác phòng mặc định không có vở kịch mẫu: tạo phòng là để dùng thật.
function initialDataFor(roomId) {
  if (roomId === DEFAULT_ROOM) return INITIAL_DATA;
  return {
    settings: { room_name: roomId, transfer_prefix: 'TIEN PHONG' },
    members: [],
    periods: [],
    expenses: [],
    member_shares: [],
  };
}

// Một chỗ duy nhất để hai nguồn (D1 flat / localStorage) ra cùng một shape.
export function normalizeRoom(blob, roomId = DEFAULT_ROOM) {
  const src = blob && typeof blob === 'object' ? blob : {};
  const members = Array.isArray(src.members) ? src.members : [];
  const shares = Array.isArray(src.member_shares) ? src.member_shares : [];
  return {
    room_id: src.room_id || roomId,
    room_name: src.room_name || (src.settings && src.settings.room_name) || roomId,
    owner_member_id: src.owner_member_id || null,
    settings: { ...(src.settings || {}) },
    members,
    periods: Array.isArray(src.periods) ? src.periods : [],
    expenses: Array.isArray(src.expenses) ? src.expenses : [],
    member_shares: shares,
  };
}

function getLocalData(roomId) {
  try {
    const raw = localStorage.getItem(dataKey(roomId)) || (roomId === DEFAULT_ROOM ? localStorage.getItem(LEGACY_DATA_KEY) : null);
    if (!raw) {
      const seed = initialDataFor(roomId);
      localStorage.setItem(dataKey(roomId), JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  } catch (e) {
    return initialDataFor(roomId);
  }
}

function saveLocalData(roomId, data) {
  try {
    localStorage.setItem(dataKey(roomId), JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save to local storage', e);
  }
}

export function getStoredAdminHash(roomId) {
  return (
    localStorage.getItem(hashKey(roomId)) ||
    (roomId === DEFAULT_ROOM ? localStorage.getItem(LEGACY_HASH_KEY) : null) ||
    ''
  );
}

export function setStoredAdminHash(roomId, hash) {
  localStorage.setItem(hashKey(roomId), hash);
}

export function getStoredSession(roomId) {
  try {
    const raw = localStorage.getItem(sessionKey(roomId));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.token) return null;
    if (s.expires_at && new Date(s.expires_at).getTime() <= Date.now()) return null;
    return s;
  } catch (e) {
    return null;
  }
}

export function setStoredSession(roomId, session) {
  if (!session) {
    localStorage.removeItem(sessionKey(roomId));
    return;
  }
  localStorage.setItem(sessionKey(roomId), JSON.stringify(session));
}

export function getStoredMember(roomId) {
  return localStorage.getItem(memberKey(roomId)) || null;
}

export function setStoredMember(roomId, memberId) {
  if (!memberId) localStorage.removeItem(memberKey(roomId));
  else localStorage.setItem(memberKey(roomId), memberId);
}

// Vở trống - dùng khi "gỡ khỏi máy này". KHÁC initialDataFor(): hàm đó seed 4 người
// mẫu + kỳ 2026-10 cho phòng kế thừa, ghi vào là phòng hiện ra với tên người lạ.
function emptyLedger() {
  return { settings: {}, members: [], periods: [], expenses: [], member_shares: [] };
}

// "Gỡ khỏi máy này": quên PIN + phiên + bản offline của một phòng, KHÔNG nói với
// server. Quyền vào phòng thật vẫn còn ở thiết bị khác và với ai biết mã phòng
// (GET /api/data không cần PIN - đó là thiết kế đã chốt, xem README).
// Muốn mất quyền thật thì dùng leaveRoom().
export function removeRoomFromDevice(roomId) {
  localStorage.removeItem(hashKey(roomId));
  localStorage.removeItem(sessionKey(roomId));
  localStorage.removeItem(memberKey(roomId));
  localStorage.setItem(dataKey(roomId), JSON.stringify(emptyLedger()));
  // Phòng kế thừa còn hai khóa không có tiền tố pct:: - listStoredRooms đọc
  // LEGACY_HASH_KEY nên quên không xóa là phòng tự nhảy lại vào menu.
  if (roomId === DEFAULT_ROOM) {
    localStorage.removeItem(LEGACY_HASH_KEY);
    localStorage.removeItem(LEGACY_DATA_KEY);
  }
}

// Những phòng thiết bị này đã từng vào (để Header liệt kê, không gọi server).
// Hai dấu vết hợp lệ: một phiên member (qua link mời) hoặc một hash PIN admin
// (phòng tự tạo / đã mở Cài đặt). Thiếu hash cũng tính là "phòng của tôi" —
// người tạo phòng chưa chắc đã bấm vào link mời nào.
export function listStoredRooms() {
  const byRoom = new Map();
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith('pct:session:')) {
      const roomId = key.slice('pct:session:'.length);
      const session = getStoredSession(roomId);
      if (session) {
        byRoom.set(roomId, {
          roomId,
          member_id: session.member_id,
          member_name: session.member_name || '',
          role: session.role,
        });
      }
    } else if (key.startsWith('pct:hash:')) {
      const roomId = key.slice('pct:hash:'.length);
      if (localStorage.getItem(key) && !byRoom.has(roomId)) {
        byRoom.set(roomId, {
          roomId,
          member_id: getStoredMember(roomId),
          member_name: '',
          role: 'admin',
        });
      }
    }
  }
  if (localStorage.getItem(LEGACY_HASH_KEY) && !byRoom.has(DEFAULT_ROOM)) {
    byRoom.set(DEFAULT_ROOM, { roomId: DEFAULT_ROOM, member_id: null, member_name: '', role: 'admin' });
  }
  return Array.from(byRoom.values());
}

const qs = (roomId) => `p=${encodeURIComponent(roomId)}`;

async function postJson(path, body, { roomId, adminHash, session } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminHash) headers['x-admin-hash'] = adminHash;
  if (session) headers['Authorization'] = `Bearer ${session}`;
  const url = path.includes('?') ? `${path}&${qs(roomId)}` : `${path}?${qs(roomId)}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// Fetch all public data của MỘT phòng.
// source: 'd1' | 'local' | 'need_room' (phòng không tồn tại / chưa có phiên)
export async function fetchRoomData(roomId) {
  try {
    const res = await fetch(`/api/data?${qs(roomId)}`);
    if (res.status === 404 || res.status === 401) {
      return { ...normalizeRoom(null, roomId), source: 'need_room', status: res.status };
    }
    if (res.ok) {
      const data = await res.json();
      if (data.hasD1) {
        return { ...normalizeRoom(data, roomId), source: 'd1' };
      }
    }
  } catch (err) {
    // offline ->LocalStorage
  }
  return { ...normalizeRoom(getLocalData(roomId), roomId), source: 'local' };
}

// Verify Admin PIN của từng phòng
export async function verifyAdminPin(roomId, pin) {
  const hash = await sha256(pin);
  try {
    const { res, data } = await postJson('/api/admin/verify', { pin_hash: hash }, { roomId });
    if (res.ok && data.valid) return { valid: true, hash };
    if (res.ok && !data.valid) {
      // Server nói không đúng -> không cho qua bằng bản local.
      return { valid: false, hash };
    }
  } catch (e) {
    // offline: chỉ còn cách so với hash đã lưu
  }
  const currentHash = getStoredAdminHash(roomId) || (await sha256('123456'));
  const valid = hash.toLowerCase() === currentHash.toLowerCase();
  return { valid, hash };
}

// ---- Tạo phòng / vào phòng bằng link ----

export async function createRoom({ name, pin, ownerName }) {
  const pin_hash = await sha256(pin);
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin_hash, owner_name: ownerName || '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error || 'Không tạo được phòng' };
    setStoredAdminHash(data.room_id, pin_hash);
    setStoredMember(data.room_id, data.member_id || null);
    return { success: true, room_id: data.room_id, name: data.name };
  } catch (e) {
    return { success: false, error: 'Không gọi được máy chủ (offline?).' };
  }
}

export async function joinWithToken(token) {
  try {
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error || 'Link mời không còn hợp lệ.' };
    // member_name để lần sau mở app còn biết "tôi là ai trong phòng này".
    setStoredSession(data.room_id, { ...data.session, member_name: data.member_name || '' });
    return { success: true, room_id: data.room_id, room_name: data.room_name, session: data.session };
  } catch (e) {
    return { success: false, error: 'Không gọi được máy chủ (offline?).' };
  }
}

// Member tự đánh dấu đã nộp - không cần PIN admin, server lấy member_id từ phiên.
export async function memberTogglePaid(roomId, { period_id, is_paid, paid_amount }) {
  const session = getStoredSession(roomId);
  if (!session) return { success: false, needInvite: true };
  const body = { period_id, is_paid };
  if (paid_amount !== undefined && paid_amount !== null) body.paid_amount = paid_amount;
  try {
    const { res, data } = await postJson('/api/member/toggle-share-paid', body, { roomId, session: session.token });
    if (res.status === 401) {
      setStoredSession(roomId, null);
      return { success: false, needInvite: true };
    }
    if (!res.ok) return { success: false, error: data.error || 'Không lưu được' };
  } catch (e) {
    // offline -> chỉ ghi local
  }
  const current = getLocalData(roomId);
  const idx = current.member_shares.findIndex((s) => s.period_id === period_id && s.member_id === session.member_id);
  const record = {
    period_id,
    member_id: session.member_id,
    is_paid: is_paid ? 1 : 0,
    paid_at: is_paid ? new Date().toISOString() : null,
    paid_amount: paid_amount !== undefined && paid_amount !== null
      ? Math.max(0, parseInt(paid_amount) || 0)
      : (idx >= 0 ? current.member_shares[idx].paid_amount : 0),
  };
  if (idx >= 0) current.member_shares[idx] = { ...current.member_shares[idx], ...record };
  else current.member_shares.push(record);
  saveLocalData(roomId, current);
  return { success: true, member_id: session.member_id };
}

// role: 'viewer' | 'member' | 'manager' - quyền đi từ link, người mở link không tự chọn được.
// session thay cho adminHash khi người gọi là manager của phòng (không cầm PIN).
export async function createInvite(roomId, memberId, { ttlMin = 15, uses = 1, role = 'member' } = {}, adminHash, session) {
  const { res, data } = await postJson(
    '/api/admin/invites',
    { member_id: memberId, ttl_min: ttlMin, uses, role },
    { roomId, adminHash, session }
  );
  if (res.status === 401) return { success: false, unauthorized: true };
  if (!res.ok) return { success: false, error: data.error || 'Không tạo được link mời' };
  return { success: true, token: data.token, role: data.role, expires_at: data.expires_at, room_id: data.room_id };
}

export async function revokeMemberSession(roomId, memberId, adminHash, session) {
  const { res, data } = await postJson('/api/admin/revoke', { member_id: memberId }, { roomId, adminHash, session });
  if (res.status === 401) return { success: false, unauthorized: true };
  if (!res.ok) return { success: false, error: data.error || 'Không thu hồi được phiên' };
  return { success: true, revoked: data.revoked };
}

// Rời phòng THẬT (server): nhân vật ở lại trong sổ với is_active=0, phần tiền đã ghi
// không đổi, nhưng mọi phiên và mọi link mời của họ bị thu ở mọi thiết bị.
// Có session thì server lấy member_id từ session; không có thì phải dùng PIN + member_id.
export async function leaveRoom(roomId, { adminHash, member_id } = {}) {
  const session = getStoredSession(roomId);
  const body = session ? {} : { member_id };
  const { res, data } = await postJson('/api/rooms/leave', body, {
    roomId,
    adminHash,
    session: session?.token,
  });
  if (!res.ok) return { success: false, error: data.error || 'Không rời phòng được' };
  removeRoomFromDevice(roomId);
  return { success: true, room_id: data.room_id };
}

// Giao phòng: bắt buộc trước khi chủ phòng rời đi, nếu không guard "chủ phòng không
// tự rời" biến thành bẫy - phòng có chủ thì vĩnh viễn không bỏ được.
export async function transferOwner(roomId, memberId, adminHash) {
  const { res, data } = await postJson('/api/admin/transfer-owner', { member_id: memberId }, { roomId, adminHash });
  if (res.status === 401) return { success: false, unauthorized: true };
  if (!res.ok) return { success: false, error: data.error || 'Không giao phòng được' };
  return { success: true, owner_member_id: data.owner_member_id };
}

// Kiểm tra phiên còn sống không + mình là ai trong phòng này. Server là nguồn sự
// thật: chủ phòng đã đá thì lần mở phòng kế tiếp phải biết ngay, không đợi tới lúc
// bấm "đã nộp" mới thấy lỗi.
export async function fetchMe(roomId) {
  const session = getStoredSession(roomId);
  if (!session) return { none: true };
  try {
    const res = await fetch(`/api/me?${qs(roomId)}`, { headers: { Authorization: `Bearer ${session.token}` } });
    if (res.status === 401 || res.status === 403) {
      setStoredSession(roomId, null);
      const data = await res.json().catch(() => ({}));
      return { needInvite: true, error: data.error || 'Phiên đã hết hạn hoặc bị thu hồi.' };
    }
    if (!res.ok) return { error: 'Không kiểm tra được phiên (máy chủ trả ' + res.status + ').' };
    const data = await res.json();
    return { member_id: data.member_id, role: data.role, member: data.member };
  } catch (e) {
    return { offline: true };
  }
}

// Update Room Settings
export async function updateSettings(roomId, settings, adminHash) {
  try {
    const res = await fetch(`/api/admin/settings?${qs(roomId)}`, {
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

  const current = getLocalData(roomId);
  current.settings = { ...current.settings, ...settings };
  saveLocalData(roomId, current);
  return true;
}

// Save or Update Member
export async function saveMember(roomId, member, adminHash) {
  try {
    const res = await fetch(`/api/admin/members?${qs(roomId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-hash': adminHash,
      },
      body: JSON.stringify(member),
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData(roomId);
  const id = member.id || 'mem_' + Date.now();
  const idx = current.members.findIndex((m) => m.id === id);
  if (idx >= 0) {
    current.members[idx] = { ...current.members[idx], ...member };
  } else {
    current.members.push({ ...member, id, is_active: 1 });
  }
  saveLocalData(roomId, current);
  return true;
}

// Ngưng hoạt động một thành viên (server đổi tên hành vi: không còn xóa dòng).
// Trả về object thay vì `true` để caller hiển thị được các lỗi 409 mới:
// "chủ phòng không rời được khi chưa giao phòng", "phòng cần còn một người".
// Chỉ ghi local khi KHÔNG nối được máy chủ; 4xx là câu trả lời thật, phải báo lại
// chứ không được âm thầm xóa trong bộ nhớ rồi nói "xong".
export async function deleteMember(roomId, memberId, adminHash) {
  let res = null;
  try {
    res = await fetch(`/api/admin/members/${memberId}?${qs(roomId)}`, {
      method: 'DELETE',
      headers: { 'x-admin-hash': adminHash },
    });
  } catch (e) {
    res = null;
  }
  if (res && !res.ok) {
    const data = await res.json().catch(() => ({}));
    return { success: false, status: res.status, error: data.error || 'Không ngưng hoạt động được.' };
  }

  const current = getLocalData(roomId);
  current.members = (current.members || []).map((m) => (m.id === memberId ? { ...m, is_active: 0 } : m));
  // member_shares và expenses.split_config giữ nguyên: đó là hóa đơn đã xảy ra.
  saveLocalData(roomId, current);
  return { success: true, deactivated: true };
}

// Save or Update Period
export async function savePeriod(roomId, period, adminHash) {
  try {
    const res = await fetch(`/api/admin/periods?${qs(roomId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-hash': adminHash,
      },
      body: JSON.stringify(period),
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData(roomId);
  const id = period.id || 'period_' + Date.now();
  const idx = current.periods.findIndex((p) => p.id === id);
  if (idx >= 0) {
    current.periods[idx] = { ...current.periods[idx], ...period };
  } else {
    current.periods.unshift({ ...period, id, status: period.status || 'open' });
  }
  saveLocalData(roomId, current);
  return true;
}

// Xóa một kỳ kèm mọi khoản và mọi phần của nó. Trả về object để caller báo được lỗi
// thật: trước đây mọi 4xx rơi xuống nhánh local và hàm always `true`, nên nút
// "Xóa kỳ" trông như thành công nhưng reload thì kỳ vẫn còn.
export async function deletePeriod(roomId, periodId, adminHash) {
  let res = null;
  try {
    res = await fetch(`/api/admin/periods/${periodId}?${qs(roomId)}`, {
      method: 'DELETE',
      headers: { 'x-admin-hash': adminHash },
    });
  } catch (e) {
    res = null;
  }
  if (res && !res.ok) {
    const data = await res.json().catch(() => ({}));
    return { success: false, status: res.status, error: data.error || `Không xóa được kỳ (HTTP ${res.status}).` };
  }

  const current = getLocalData(roomId);
  current.periods = current.periods.filter((p) => p.id !== periodId);
  current.expenses = current.expenses.filter((e) => e.period_id !== periodId);
  current.member_shares = current.member_shares.filter((s) => s.period_id !== periodId);
  saveLocalData(roomId, current);
  return { success: true };
}

// Save or Update Expense
export async function saveExpense(roomId, expense, adminHash) {
  const dateStr = expense.expense_date || new Date().toISOString().split('T')[0];
  const [y, m] = dateStr.split('-');
  const periodId = expense.period_id || `${y}-${m}`;

  try {
    const res = await fetch(`/api/admin/expenses?${qs(roomId)}`, {
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
  const current = getLocalData(roomId);
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
  saveLocalData(roomId, current);
  return { success: true, period_id: periodId, id };
}

// Delete Expense
export async function deleteExpense(roomId, expenseId, adminHash) {
  try {
    const res = await fetch(`/api/admin/expenses/${expenseId}?${qs(roomId)}`, {
      method: 'DELETE',
      headers: { 'x-admin-hash': adminHash },
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData(roomId);
  current.expenses = current.expenses.filter((e) => e.id !== expenseId);
  saveLocalData(roomId, current);
  return true;
}

// Toggle Payment Status (hỗ trợ trả góp từng phần qua paidAmount)
// - paidAmount undefined: giữ nguyên số đã trả cũ, chỉ đổi cờ is_paid (tương thích cũ)
// - paidAmount number: ghi đè số tiền thực tế đã trả (0 = chưa nộp, = tổng bill = nộp đủ)
export async function toggleSharePaid(roomId, periodId, memberId, isPaid, adminHash, paidAmount) {
  const body = {
    period_id: periodId,
    member_id: memberId,
    is_paid: isPaid,
  };
  if (paidAmount !== undefined && paidAmount !== null) {
    body.paid_amount = Math.max(0, parseInt(paidAmount) || 0);
  }
  try {
    const res = await fetch(`/api/admin/toggle-share-paid?${qs(roomId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-hash': adminHash,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return true;
  } catch (e) {}

  const current = getLocalData(roomId);
  const share = current.member_shares.find(
    (s) => s.period_id === periodId && s.member_id === memberId
  );
  if (share) {
    share.is_paid = isPaid ? 1 : 0;
    share.paid_at = isPaid ? new Date().toISOString() : null;
    if (body.paid_amount !== undefined) share.paid_amount = body.paid_amount;
  } else {
    current.member_shares.push({
      period_id: periodId,
      member_id: memberId,
      amount: 0,
      is_paid: isPaid ? 1 : 0,
      paid_at: isPaid ? new Date().toISOString() : null,
      paid_amount: body.paid_amount !== undefined ? body.paid_amount : 0,
      note: '',
    });
  }
  saveLocalData(roomId, current);
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
