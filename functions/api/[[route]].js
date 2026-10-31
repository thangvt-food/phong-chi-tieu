// Cloudflare Pages Functions - Catch-all API Route for /api/*
//
// Từ migration 004, mọi đường trừ đăng ký / đăng nhập / xem trước link / khôi phục chủ
// đều đòi phiên TÀI KHOẢN. Quyền trong phòng không nằm trong token: mỗi request đọc
// lại memberships + members.is_active, nên "ngưng hoạt động" mất quyền ngay lập tức.

const DEFAULT_ROOM = 'phong-2a';
const ROOM_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/;
const PIN_RE = /^\d{6,12}$/;
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{40,}$/;

// PBKDF2 ở tầng Workers. Nếu đo thấy vượt CPU 10ms của bản Free thì hạ số vòng xuống
// 20k–30k — số vòng nằm ngay trong chuỗi hash nên nâng lại được mà không cần migrate.
const PBKDF2_ITER = 100000;
const SESSION_TTL_MS = 90 * 24 * 3600 * 1000;
const THROTTLE_MAX = 5;
const THROTTLE_LOCK_MS = 15 * 60 * 1000;
const INVITE_TTL_MIN_DEFAULT = 7 * 24 * 60;
const INVITE_TTL_MIN_MAX = 30 * 24 * 60;

const ROLE_RANK = { viewer: 1, member: 2, manager: 3, owner: 4 };
const INVITE_ROLES = ['viewer', 'member', 'manager'];
const SETTINGS_WRITE_KEYS = [
  'room_name',
  'bank_id',
  'account_no',
  'account_name',
  'transfer_prefix',
  'transfer_code',
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

// slug không hợp lệ -> trả lỗi, không âm thầm fallback (fallback chỉ dành cho
// request thiếu hẳn ?p, tức deep link kỹ thuật cũ).
function resolveRoomId(url, body) {
  const raw = url.searchParams.get('p') || (body && body.room_id);
  if (raw === null || raw === undefined || raw === '') return { roomId: DEFAULT_ROOM };
  const value = String(raw);
  if (!ROOM_SLUG_RE.test(value)) return { error: 'Mã phòng không hợp lệ.' };
  return { roomId: value };
}

// ---- Tiện ích mã hoá ----

function b64url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${b64url(crypto.getRandomValues(new Uint8Array(4)))}`;
}

function isoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function timingSafeEqualStr(a, b) {
  return timingSafeEqual(new TextEncoder().encode(String(a)), new TextEncoder().encode(String(b)));
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(hash)}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!iterations || iterations < 1000) return false;
  const salt = b64urlDecode(parts[2]);
  const expected = b64urlDecode(parts[3]);
  if (salt.length === 0 || expected.length !== 32) return false;
  const actual = await derivePassword(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

// Username không tồn tại vẫn tốn một phép PBKDF2: thời gian trả lời không lộ username có/không.
const DUMMY_SALT = new Uint8Array(16);
function burnPasswordTime() {
  return derivePassword('dummy-password-for-timing', DUMMY_SALT, PBKDF2_ITER);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(role) {
  return INVITE_ROLES.includes(role) ? role : 'member';
}

// ---- Phiên tài khoản (token opaque, DB chỉ chứa SHA-256) ----

async function createUserSession(db, userId) {
  const token = newToken();
  const expiresAt = isoAfter(SESSION_TTL_MS);
  await db.prepare(
    'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(await sha256Hex(token), userId, expiresAt).run();
  return { token, expires_at: expiresAt };
}

// null = không gửi token. err = có token nhưng chết.
async function readUserSession(db, request) {
  const raw = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!raw) return null;
  const tokenHash = await sha256Hex(raw);
  const row = await db.prepare(
    'SELECT user_id, expires_at, revoked_at FROM user_sessions WHERE token_hash = ?'
  ).bind(tokenHash).first();
  if (!row) return { err: 'invalid' };
  if (row.revoked_at) return { err: 'revoked' };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { err: 'expired' };
  const user = await db.prepare('SELECT id, username, display_name FROM users WHERE id = ?')
    .bind(row.user_id).first();
  if (!user) return { err: 'invalid' };
  return { user, tokenHash };
}

// ---- Chống dò mật khẩu / PIN ----

async function throttleCheck(db, key) {
  const row = await db.prepare('SELECT failures, locked_until FROM auth_throttle WHERE key = ?')
    .bind(key).first();
  if (!row?.locked_until) return { locked: false };
  const until = new Date(row.locked_until).getTime();
  if (until > Date.now()) {
    return { locked: true, retry_after_sec: Math.ceil((until - Date.now()) / 1000) };
  }
  await db.prepare('DELETE FROM auth_throttle WHERE key = ?').bind(key).run();
  return { locked: false };
}

async function recordAuthFailure(db, key) {
  const row = await db.prepare('SELECT failures FROM auth_throttle WHERE key = ?').bind(key).first();
  const failures = (row?.failures || 0) + 1;
  const locked = failures >= THROTTLE_MAX;
  await db.prepare(`
    INSERT INTO auth_throttle (key, failures, locked_until) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      failures = excluded.failures,
      locked_until = excluded.locked_until
  `).bind(key, locked ? 0 : failures, locked ? isoAfter(THROTTLE_LOCK_MS) : null).run();
  return { failures, locked };
}

async function clearAuthFailures(db, key) {
  await db.prepare('DELETE FROM auth_throttle WHERE key = ?').bind(key).run();
}

// ---- Quyền trong phòng ----

async function getOwnerMemberId(db, roomId) {
  const row = await db.prepare('SELECT owner_member_id FROM rooms WHERE room_id = ?')
    .bind(roomId).first();
  return row?.owner_member_id || null;
}

// Đọc lại từ DB mỗi request: token không mang quyền, ngưng hoạt động là chặn ngay.
async function roomGate(db, user, roomId, minRole = 'viewer') {
  const room = await db.prepare(
    'SELECT room_id, name, owner_member_id FROM rooms WHERE room_id = ?'
  ).bind(roomId).first();
  if (!room) {
    return { response: jsonResponse({ error: 'Phòng không tồn tại.', room_id: roomId }, 404) };
  }
  const member = await db.prepare(`
    SELECT m.id, m.name, m.nickname, m.phone, m.is_active, ms.role
      FROM members m
      JOIN memberships ms ON ms.room_id = m.room_id AND ms.member_id = m.id
     WHERE m.room_id = ? AND ms.user_id = ?
  `).bind(roomId, user.id).first();
  if (!member) {
    return {
      response: jsonResponse({ error: 'Bạn không phải thành viên của phòng này.', room_id: roomId }, 403),
    };
  }
  if (!member.is_active) {
    return {
      response: jsonResponse({ error: 'Bạn đã bị ngưng khỏi phòng này.', room_id: roomId, inactive: true }, 403),
    };
  }
  const isOwner = room.owner_member_id === member.id;
  const role = isOwner ? 'owner' : normalizeRole(member.role);
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    return {
      response: jsonResponse({ error: 'Bạn không đủ quyền cho thao tác này.', room_id: roomId, role }, 403),
    };
  }
  return { user, room, member, role, isOwner };
}

async function loadMember(db, roomId, memberId) {
  return db.prepare('SELECT id, name, nickname, phone, is_active FROM members WHERE id = ? AND room_id = ?')
    .bind(memberId, roomId).first();
}

async function memberRank(db, roomId, memberId, ownerId) {
  if (memberId === ownerId) return ROLE_RANK.owner;
  const row = await db.prepare('SELECT role FROM memberships WHERE room_id = ? AND member_id = ?')
    .bind(roomId, memberId).first();
  return ROLE_RANK[normalizeRole(row?.role)] || ROLE_RANK.viewer;
}

// Ngưng hoạt động, không xóa dòng: member_shares / split_config là lịch sử tiền thật.
// Giữ memberships để chủ phòng "Thêm lại" là người đó có quyền ngay khi đăng nhập lại.
async function deactivateMember(db, roomId, memberId) {
  await db.batch([
    db.prepare('UPDATE members SET is_active = 0 WHERE id = ? AND room_id = ?')
      .bind(memberId, roomId),
    db.prepare('DELETE FROM invites WHERE room_id = ? AND member_id = ?')
      .bind(roomId, memberId),
  ]);
}

// Chặn phòng mất chủ / mất người cuối. Trả message lỗi hoặc null.
async function checkRemovable(db, roomId, memberId) {
  const owner = await getOwnerMemberId(db, roomId);
  if (memberId && owner && memberId === owner) {
    return 'Chủ phòng không rời/xóa được khi chưa giao phòng lại cho người khác.';
  }
  const active = await db.prepare(
    'SELECT COUNT(*) AS c FROM members WHERE room_id = ? AND is_active = 1'
  ).bind(roomId).first();
  const target = await db.prepare('SELECT is_active FROM members WHERE id = ? AND room_id = ?')
    .bind(memberId, roomId).first();
  if (target && target.is_active && (active?.c ?? 0) <= 1) {
    return 'Phòng cần còn ít nhất một thành viên đang hoạt động.';
  }
  return null;
}

// ---- Link mời claim (một lần, chỉ dành cho người CHƯA có tài khoản) ----

async function findInviteByToken(db, token) {
  const tokenHash = await sha256Hex(token);
  return db.prepare(`
    SELECT i.token_hash, i.room_id, i.member_id, i.role, i.expires_at, i.uses_left,
           m.name AS member_name, m.is_active, r.name AS room_name
      FROM invites i
      JOIN members m ON m.id = i.member_id AND m.room_id = i.room_id
      LEFT JOIN rooms r ON r.room_id = i.room_id
     WHERE i.token_hash = ?
  `).bind(tokenHash).first();
}

function inviteUsable(invite) {
  return !!invite
    && invite.uses_left > 0
    && new Date(invite.expires_at).getTime() > Date.now();
}

async function mintInvite(db, roomId, actor, body) {
  const memberId = String(body.member_id || '');
  const ttlMin = Math.min(
    INVITE_TTL_MIN_MAX,
    Math.max(1, parseInt(body.ttl_min, 10) || INVITE_TTL_MIN_DEFAULT)
  );
  const role = normalizeRole(body.role);

  const member = await loadMember(db, roomId, memberId);
  if (!member) {
    return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
  }
  if (!member.is_active) {
    return jsonResponse({ error: 'Thành viên đã ngưng hoạt động, hãy thêm lại rồi mới mời.', room_id: roomId }, 409);
  }
  const ownerId = await getOwnerMemberId(db, roomId);
  if (memberId === ownerId) {
    return jsonResponse({ error: 'Chủ phòng nhận quyền bằng mã khôi phục, không dùng link mời.', room_id: roomId }, 409);
  }
  const bound = await db.prepare('SELECT user_id FROM memberships WHERE room_id = ? AND member_id = ?')
    .bind(roomId, memberId).first();
  if (bound) {
    return jsonResponse({ error: 'Thành viên này đã có tài khoản, không cần link nữa.', room_id: roomId }, 409);
  }
  if (role === 'manager' && !actor.isOwner) {
    return jsonResponse({ error: 'Chỉ chủ phòng tạo được link mức Quản lý.', room_id: roomId }, 403);
  }

  const token = newToken();
  const expiresAt = isoAfter(ttlMin * 60 * 1000);
  await db.batch([
    db.prepare('DELETE FROM invites WHERE room_id = ? AND member_id = ?').bind(roomId, memberId),
    db.prepare(
      'INSERT INTO invites (token_hash, room_id, member_id, role, expires_at, uses_left) VALUES (?, ?, ?, ?, ?, 1)'
    ).bind(await sha256Hex(token), roomId, memberId, role, expiresAt),
  ]);
  return jsonResponse({
    success: true,
    room_id: roomId,
    member_id: memberId,
    member_name: member.name,
    role,
    token,
    expires_at: expiresAt,
  });
}

// ---- Mã phòng / mã chuyển khoản ----

function slugify(name) {
  const noAccents = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D');
  const slug = noAccents.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return ROOM_SLUG_RE.test(slug) ? slug : '';
}

// Phòng trùng tên không còn là lỗi chặn: mã phòng chỉ là deep link kỹ thuật,
// người dùng nhìn thấy tên phòng trong danh sách tài khoản.
async function uniqueSlug(db, base) {
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? base : `${base.slice(0, 24)}-${i}`;
    const row = await db.prepare('SELECT room_id FROM rooms WHERE room_id = ?').bind(slug).first();
    if (!row) return slug;
  }
  return null;
}

const GENERIC_ROOM_TOKENS = ['phong', 'tro', 'nha', 'nhatro', 'phongtro'];
function deriveTransferCode(slug) {
  const tokens = String(slug || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !GENERIC_ROOM_TOKENS.includes(t));
  return (meaningful.length ? meaningful : tokens).join('').toUpperCase().slice(0, 6);
}

// ---- Version schema ----

const SCHEMA_VERSION = 4;
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return { ok: true };
  try {
    const row = await db
      .prepare('SELECT version FROM schema_meta WHERE version = ?')
      .bind(SCHEMA_VERSION)
      .first();
    schemaReady = !!row;
    return { ok: schemaReady };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  const method = request.method;

  // App và Functions cùng origin (Pages) nên không cần CORS.
  if (method === 'OPTIONS') return new Response(null, { status: 204 });

  const db = env.DB;
  if (!db) {
    return jsonResponse({ error: 'D1 database chưa được cấu hình trên Cloudflare.' }, 503);
  }
  const schema = await ensureSchema(db);
  if (!schema.ok) {
    return jsonResponse({
      error: `Schema D1 chưa ở version ${SCHEMA_VERSION}. Chạy migrations/004_accounts.sql (sau 002/003) trước khi dùng.`,
      schemaError: schema.error,
    }, 503);
  }

  try {
    // ================= Không cần phiên =================

    // POST /api/auth/register { username, password, display_name? }
    if (path === 'auth/register' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const username = normalizeUsername(body.username);
      const password = String(body.password || '');
      const displayName = String(body.display_name || '').trim().slice(0, 60);
      if (!USERNAME_RE.test(username)) {
        return jsonResponse({ error: 'Tên đăng nhập 3–32 ký tự, chỉ chữ, số và . _ -', field: 'username' }, 400);
      }
      if (password.length < 8 || password.length > 128) {
        return jsonResponse({ error: 'Mật khẩu cần 8–128 ký tự.', field: 'password' }, 400);
      }
      const userId = randomId('usr');
      try {
        await db.prepare(
          'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)'
        ).bind(userId, username, displayName || username, await hashPassword(password)).run();
      } catch (err) {
        if (/UNIQUE/i.test(String(err?.message || err))) {
          return jsonResponse({ error: 'Tên đăng nhập đã có người dùng.', field: 'username' }, 409);
        }
        throw err;
      }
      const session = await createUserSession(db, userId);
      return jsonResponse({
        success: true,
        token: session.token,
        expires_at: session.expires_at,
        user: { id: userId, username, display_name: displayName || username },
      });
    }

    // POST /api/auth/login { username, password }
    if (path === 'auth/login' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const username = normalizeUsername(body.username);
      const password = String(body.password || '');
      if (!username || !password) {
        return jsonResponse({ error: 'Nhập tên đăng nhập và mật khẩu.' }, 400);
      }
      const key = 'login:' + username;
      const throttle = await throttleCheck(db, key);
      if (throttle.locked) {
        return jsonResponse({
          error: 'Sai quá nhiều lần. Thử lại sau ít phút.',
          retry_after_sec: throttle.retry_after_sec,
        }, 429);
      }
      const user = await db.prepare(
        'SELECT id, username, display_name, password_hash FROM users WHERE username = ?'
      ).bind(username).first();
      let ok = false;
      if (user) {
        ok = await verifyPassword(password, user.password_hash);
      } else {
        await burnPasswordTime();
      }
      if (!ok) {
        const rec = await recordAuthFailure(db, key);
        await sleep(200);
        return jsonResponse({
          error: 'Sai tên đăng nhập hoặc mật khẩu.',
          locked: rec.locked,
        }, 401);
      }
      await clearAuthFailures(db, key);
      const session = await createUserSession(db, user.id);
      return jsonResponse({
        success: true,
        token: session.token,
        expires_at: session.expires_at,
        user: { id: user.id, username: user.username, display_name: user.display_name },
      });
    }

    // GET /api/invites/:token - Giới thiệu ngắn cho màn claim
    const previewMatch = /^invites\/([A-Za-z0-9_-]{40,})$/.exec(path);
    if (previewMatch && method === 'GET') {
      const invite = await findInviteByToken(db, previewMatch[1]);
      if (!inviteUsable(invite) || !invite.is_active) {
        return jsonResponse({ error: 'Link mời không còn hiệu lực.' }, 404);
      }
      return jsonResponse({
        room_id: invite.room_id,
        room_name: invite.room_name || invite.room_id,
        member_name: invite.member_name,
        role: normalizeRole(invite.role),
      });
    }

    // POST /api/rooms/recover-owner { pin, new_pin, username?, password?, display_name? }
    // Có Bearer thì buộc membership của chủ phòng vào tài khoản đó; không có thì
    // dùng tài khoản đã nhập (phải đúng mật khẩu) hoặc tạo mới.
    if (path === 'rooms/recover-owner' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const roomResolve = resolveRoomId(url, body);
      if (roomResolve.error) return jsonResponse({ error: roomResolve.error }, 400);
      const roomId = roomResolve.roomId;

      const room = await db.prepare('SELECT room_id, name, owner_member_id FROM rooms WHERE room_id = ?')
        .bind(roomId).first();
      if (!room) return jsonResponse({ error: 'Phòng không tồn tại.', room_id: roomId }, 404);

      const pin = String(body.pin || '');
      const newPin = String(body.new_pin || '');
      const key = 'pin:' + roomId;
      const throttle = await throttleCheck(db, key);
      if (throttle.locked) {
        return jsonResponse({
          error: 'Sai PIN quá nhiều lần. Thử lại sau ít phút.',
          retry_after_sec: throttle.retry_after_sec,
        }, 429);
      }

      const pinRow = await db.prepare('SELECT value FROM settings WHERE room_id = ? AND key = ?')
        .bind(roomId, 'admin_pin_hash').first();
      if (!pinRow?.value) {
        return jsonResponse({ error: 'Phòng chưa có mã khôi phục.', room_id: roomId }, 409);
      }
      // Hash SHA-256 từng là credential ghi sổ: không nhận lại chuỗi 64 hex đó.
      if (!pin || /^[0-9a-f]{64}$/i.test(pin)) {
        await recordAuthFailure(db, key);
        await sleep(200);
        return jsonResponse({ error: 'Mã PIN không đúng.' }, 403);
      }
      if (!timingSafeEqualStr(await sha256Hex(pin), String(pinRow.value).toLowerCase())) {
        const rec = await recordAuthFailure(db, key);
        await sleep(200);
        return jsonResponse({ error: 'Mã PIN không đúng.', locked: rec.locked }, 403);
      }
      if (!PIN_RE.test(newPin)) {
        return jsonResponse({ error: 'Mã khôi phục mới cần 6–12 chữ số.' }, 400);
      }
      if (newPin === pin) {
        return jsonResponse({ error: 'Mã mới phải khác mã cũ.' }, 400);
      }

      let ownerMemberId = room.owner_member_id;
      if (!ownerMemberId) {
        const first = await db.prepare(`
          SELECT id FROM members WHERE room_id = ? AND is_active = 1
          ORDER BY created_at ASC, rowid ASC LIMIT 1
        `).bind(roomId).first();
        ownerMemberId = first?.id || null;
      }
      if (!ownerMemberId) {
        return jsonResponse({ error: 'Phòng chưa có thành viên đang hoạt động để nhận quyền chủ.' }, 409);
      }

      const current = await readUserSession(db, request);
      let actor = current && !current.err ? current.user : null;
      if (!actor) {
        const username = normalizeUsername(body.username);
        const password = String(body.password || '');
        if (!USERNAME_RE.test(username) || password.length < 8 || password.length > 128) {
          return jsonResponse({ error: 'Cần tài khoản nhận phòng: tên đăng nhập hợp lệ và mật khẩu từ 8 ký tự.' }, 400);
        }
        const existing = await db.prepare(
          'SELECT id, username, display_name, password_hash FROM users WHERE username = ?'
        ).bind(username).first();
        if (existing) {
          if (!await verifyPassword(password, existing.password_hash)) {
            await recordAuthFailure(db, key);
            await sleep(200);
            return jsonResponse({ error: 'Tên đăng nhập hoặc mật khẩu không đúng để nhận phòng.' }, 403);
          }
          actor = { id: existing.id, username: existing.username, display_name: existing.display_name };
        } else {
          const userId = randomId('usr');
          const displayName = String(body.display_name || '').trim().slice(0, 60) || username;
          try {
            await db.prepare(
              'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)'
            ).bind(userId, username, displayName, await hashPassword(password)).run();
          } catch (err) {
            if (/UNIQUE/i.test(String(err?.message || err))) {
              return jsonResponse({ error: 'Tên đăng nhập đã có người dùng.', field: 'username' }, 409);
            }
            throw err;
          }
          actor = { id: userId, username, display_name: displayName };
        }
      }

      const newHash = await sha256Hex(newPin);
      await db.batch([
        db.prepare('UPDATE rooms SET owner_member_id = ? WHERE room_id = ?')
          .bind(ownerMemberId, roomId),
        db.prepare('UPDATE members SET is_active = 1 WHERE id = ? AND room_id = ?')
          .bind(ownerMemberId, roomId),
        // Tài khoản cũ đang giữ ghế chủ mất phòng này; các phòng khác của họ không đụng.
        db.prepare('DELETE FROM memberships WHERE room_id = ? AND user_id = ?')
          .bind(roomId, actor.id),
        db.prepare('DELETE FROM memberships WHERE room_id = ? AND member_id = ?')
          .bind(roomId, ownerMemberId),
        db.prepare(
          "INSERT INTO memberships (room_id, member_id, user_id, role) VALUES (?, ?, ?, 'manager')"
        ).bind(roomId, ownerMemberId, actor.id),
        db.prepare(`
          INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)
          ON CONFLICT(room_id, key) DO UPDATE SET value = excluded.value
        `).bind(roomId, 'admin_pin_hash', newHash),
      ]);
      await clearAuthFailures(db, key);
      const session = await createUserSession(db, actor.id);
      const ownerMember = await db.prepare('SELECT name FROM members WHERE id = ? AND room_id = ?')
        .bind(ownerMemberId, roomId).first();
      return jsonResponse({
        success: true,
        room_id: roomId,
        room_name: room.name,
        token: session.token,
        expires_at: session.expires_at,
        user: actor,
        member_id: ownerMemberId,
        member_name: ownerMember?.name || '',
        role: 'owner',
      });
    }

    // ================= Cần phiên tài khoản =================

    const session = await readUserSession(db, request);
    if (!session) {
      return jsonResponse({ error: 'Chưa đăng nhập.', needs_auth: true }, 401);
    }
    if (session.err) {
      return jsonResponse({
        error: 'Phiên đã hết hạn, đăng nhập lại.',
        needs_auth: true,
        reason: session.err,
      }, 401);
    }
    const user = session.user;

    // GET /api/auth/me - Tài khoản + danh sách phòng như "nhóm" trong app chat
    if (path === 'auth/me' && method === 'GET') {
      await db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?')
        .bind(new Date().toISOString(), session.tokenHash).run();
      const rows = await db.prepare(`
        SELECT ms.room_id, ms.member_id, ms.role, m.name AS member_name,
               r.name AS room_name, r.owner_member_id
          FROM memberships ms
          JOIN members m ON m.room_id = ms.room_id AND m.id = ms.member_id
          JOIN rooms r ON r.room_id = ms.room_id
         WHERE ms.user_id = ? AND m.is_active = 1
         ORDER BY ms.created_at ASC, ms.rowid ASC
      `).bind(user.id).all();
      const rooms = (rows.results || []).map((row) => ({
        room_id: row.room_id,
        room_name: row.room_name || row.room_id,
        member_id: row.member_id,
        member_name: row.member_name,
        role: row.owner_member_id === row.member_id ? 'owner' : normalizeRole(row.role),
      }));
      return jsonResponse({ user, rooms });
    }

    // POST /api/auth/logout
    if (path === 'auth/logout' && method === 'POST') {
      await db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(new Date().toISOString(), session.tokenHash).run();
      return jsonResponse({ success: true });
    }

    // POST /api/auth/change-password { old_password, new_password }
    if (path === 'auth/change-password' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const oldPassword = String(body.old_password || '');
      const newPassword = String(body.new_password || '');
      if (newPassword.length < 8 || newPassword.length > 128) {
        return jsonResponse({ error: 'Mật khẩu mới cần 8–128 ký tự.' }, 400);
      }
      const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
      if (!row || !await verifyPassword(oldPassword, row.password_hash)) {
        await sleep(200);
        return jsonResponse({ error: 'Mật khẩu hiện tại không đúng.' }, 403);
      }
      await db.batch([
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .bind(await hashPassword(newPassword), user.id),
        // Đổi mật khẩu = đá mọi máy khác, giữ đúng phiên đang dùng.
        db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND token_hash != ? AND revoked_at IS NULL')
          .bind(new Date().toISOString(), user.id, session.tokenHash),
      ]);
      return jsonResponse({ success: true });
    }

    // POST /api/invites/claim { token }
    if (path === 'invites/claim' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const token = String(body.token || '');
      if (!INVITE_TOKEN_RE.test(token)) {
        return jsonResponse({ error: 'Link mời không hợp lệ.' }, 400);
      }
      const invite = await findInviteByToken(db, token);
      if (!inviteUsable(invite)) {
        return jsonResponse({ error: 'Link mời không còn hiệu lực.' }, 410);
      }
      if (!invite.is_active) {
        return jsonResponse({ error: 'Thành viên này đã ngưng hoạt động.' }, 409);
      }
      const existing = await db.prepare('SELECT user_id FROM memberships WHERE room_id = ? AND member_id = ?')
        .bind(invite.room_id, invite.member_id).first();
      if (existing) {
        return jsonResponse({ error: 'Thành viên này đã có tài khoản rồi.' }, 409);
      }
      const role = normalizeRole(invite.role);
      let res;
      try {
        // PK (room_id, member_id) và UNIQUE (room_id, user_id) cùng chặn race.
        res = await db.prepare(`
          INSERT OR IGNORE INTO memberships (room_id, member_id, user_id, role)
          VALUES (?, ?, ?, ?)
        `).bind(invite.room_id, invite.member_id, user.id, role).run();
      } catch (err) {
        return jsonResponse({ error: 'Tài khoản đã là thành viên phòng này.' }, 409);
      }
      if ((res.meta?.changes ?? 0) === 0) {
        return jsonResponse({ error: 'Không nhận được link: thành viên đã có chủ hoặc tài khoản đã ở phòng này.' }, 409);
      }
      await db.prepare('DELETE FROM invites WHERE room_id = ? AND member_id = ?')
        .bind(invite.room_id, invite.member_id).run();
      return jsonResponse({
        success: true,
        room_id: invite.room_id,
        room_name: invite.room_name || invite.room_id,
        member_id: invite.member_id,
        member_name: invite.member_name,
        role,
      });
    }

    // POST /api/rooms { name, pin, owner_name? }
    if (path === 'rooms' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || '').trim().slice(0, 40);
      const pin = String(body.pin || '');
      if (name.length < 2) {
        return jsonResponse({ error: 'Tên phòng cần ít nhất 2 ký tự.' }, 400);
      }
      if (!PIN_RE.test(pin)) {
        return jsonResponse({ error: 'Mã khôi phục cần 6–12 chữ số.' }, 400);
      }
      const base = slugify(name);
      if (!base) return jsonResponse({ error: 'Tên phòng không tạo được mã slug.' }, 400);
      const roomId = await uniqueSlug(db, base);
      if (!roomId) return jsonResponse({ error: 'Quá nhiều phòng trùng tên, hãy đặt tên khác.' }, 409);

      const ownerName = String(body.owner_name || '').trim().slice(0, 60) || user.display_name;
      const ownerId = randomId('mem');
      await db.batch([
        db.prepare('INSERT INTO rooms (room_id, name, owner_member_id) VALUES (?, ?, ?)')
          .bind(roomId, name, ownerId),
        db.prepare('INSERT INTO members (id, room_id, name, nickname, is_active) VALUES (?, ?, ?, ?, 1)')
          .bind(ownerId, roomId, ownerName, ownerName.split(' ').pop()),
        db.prepare(
          "INSERT INTO memberships (room_id, member_id, user_id, role) VALUES (?, ?, ?, 'manager')"
        ).bind(roomId, ownerId, user.id),
        db.prepare('INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)')
          .bind(roomId, 'room_name', name),
        db.prepare('INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)')
          .bind(roomId, 'admin_pin_hash', await sha256Hex(pin)),
        db.prepare('INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)')
          .bind(roomId, 'transfer_prefix', 'TIEN PHONG'),
        // Mã phòng đi TRƯỚC tên người trong nội dung CK: ngân hàng cắt từ đuôi.
        db.prepare('INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)')
          .bind(roomId, 'transfer_code', deriveTransferCode(roomId)),
      ]);
      return jsonResponse({
        success: true,
        room: {
          room_id: roomId,
          room_name: name,
          member_id: ownerId,
          member_name: ownerName,
          role: 'owner',
        },
      });
    }

    // ================= Trong một phòng =================

    const roomResolve = resolveRoomId(url, null);
    if (roomResolve.error && path !== 'auth/me' && path !== 'auth/logout') {
      return jsonResponse({ error: roomResolve.error }, 400);
    }
    const roomId = roomResolve.roomId;

    // GET /api/data?p=room
    if (path === 'data' && method === 'GET') {
      const gate = await roomGate(db, user, roomId, 'viewer');
      if (gate.response) return gate.response;

      const [settingsRes, membersRes, periodsRes, expensesRes, sharesRes] = await Promise.all([
        db.prepare('SELECT key, value FROM settings WHERE room_id = ?').bind(roomId).all(),
        db.prepare(`
          SELECT m.id, m.name, m.nickname, m.phone, m.is_active, m.created_at,
                 ms.role AS role, ms.user_id AS user_id
            FROM members m
            LEFT JOIN memberships ms ON ms.room_id = m.room_id AND ms.member_id = m.id
           WHERE m.room_id = ?
           ORDER BY m.created_at ASC, m.rowid ASC
        `).bind(roomId).all(),
        db.prepare('SELECT * FROM periods WHERE room_id = ? ORDER BY id DESC').bind(roomId).all(),
        db.prepare('SELECT * FROM expenses WHERE room_id = ? ORDER BY expense_date DESC, created_at DESC')
          .bind(roomId).all(),
        db.prepare('SELECT * FROM member_shares WHERE room_id = ?').bind(roomId).all(),
      ]);

      const settings = {};
      for (const row of settingsRes.results || []) {
        if (row.key !== 'admin_pin_hash') settings[row.key] = row.value;
      }
      // SĐT chỉ trả cho chính người đó hoặc manager trở lên.
      const canSeePhone = ROLE_RANK[gate.role] >= ROLE_RANK.manager;
      const members = (membersRes.results || []).map((m) => ({
        id: m.id,
        name: m.name,
        nickname: m.nickname,
        phone: canSeePhone || m.id === gate.member.id ? m.phone : null,
        is_active: m.is_active,
        created_at: m.created_at,
        role: m.id === gate.room.owner_member_id ? 'owner' : (m.role || null),
        has_account: !!m.user_id,
      }));

      return jsonResponse({
        hasD1: true,
        room_id: roomId,
        room_name: gate.room.name,
        owner_member_id: gate.room.owner_member_id || null,
        me: {
          member_id: gate.member.id,
          name: gate.member.name,
          nickname: gate.member.nickname,
          role: gate.role,
          is_owner: gate.isOwner,
        },
        settings,
        members,
        periods: periodsRes.results || [],
        expenses: expensesRes.results || [],
        member_shares: sharesRes.results || [],
      });
    }

    // POST /api/member/toggle-share-paid { period_id, is_paid, paid_amount? }
    // member_id lấy từ phiên: không tick hộ người khác được. viewer bị chặn bởi rank.
    if (path === 'member/toggle-share-paid' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'member');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const periodId = String(body.period_id || '');
      if (!/^\d{4}-\d{2}$/.test(periodId)) return jsonResponse({ error: 'Kỳ không hợp lệ.' }, 400);
      const memberId = gate.member.id;
      const isPaid = !!body.is_paid;
      const paidAt = isPaid ? new Date().toISOString() : null;
      const paidInt = body.paid_amount === undefined || body.paid_amount === null
        ? null
        : Math.max(0, parseInt(body.paid_amount, 10) || 0);
      await db.prepare(`
        INSERT INTO member_shares (room_id, period_id, member_id, amount, is_paid, paid_at, note, paid_amount)
        VALUES (?, ?, ?, 0, ?, ?, '', COALESCE(?, 0))
        ON CONFLICT(room_id, period_id, member_id) DO UPDATE SET
          is_paid = excluded.is_paid,
          paid_at = excluded.paid_at,
          paid_amount = COALESCE(?, member_shares.paid_amount)
      `).bind(roomId, periodId, memberId, isPaid ? 1 : 0, paidAt, paidInt, paidInt).run();
      return jsonResponse({ success: true, member_id: memberId, is_paid: isPaid, paid_at: paidAt });
    }

    // POST /api/rooms/leave - tự rời, giữ lịch sử tiền, chủ phòng phải giao trước
    if (path === 'rooms/leave' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'viewer');
      if (gate.response) return gate.response;
      const blocked = await checkRemovable(db, roomId, gate.member.id);
      if (blocked) return jsonResponse({ error: blocked, room_id: roomId }, 409);
      await deactivateMember(db, roomId, gate.member.id);
      return jsonResponse({ success: true, room_id: roomId, member_id: gate.member.id, left: true });
    }

    // POST /api/admin/settings { key: value ... } - chủ phòng
    if (path === 'admin/settings' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const statements = [];
      for (const key of SETTINGS_WRITE_KEYS) {
        const value = body[key];
        if (value === undefined || value === null) continue;
        statements.push(
          db.prepare(`
            INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)
            ON CONFLICT(room_id, key) DO UPDATE SET value = excluded.value
          `).bind(roomId, key, String(value))
        );
      }
      if (body.room_name !== undefined) {
        const roomName = String(body.room_name).trim().slice(0, 40);
        if (roomName.length >= 2) {
          statements.push(
            db.prepare('UPDATE rooms SET name = ? WHERE room_id = ?').bind(roomName, roomId)
          );
        }
      }
      if (statements.length > 0) await db.batch(statements);
      return jsonResponse({ success: true, message: 'Đã cập nhật cài đặt!' });
    }

    // POST /api/admin/pin { new_pin } - đổi mã khôi phục của phòng (chủ phòng)
    if (path === 'admin/pin' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const newPin = String(body.new_pin || '');
      if (!PIN_RE.test(newPin)) {
        return jsonResponse({ error: 'Mã khôi phục cần 6–12 chữ số.' }, 400);
      }
      await db.prepare(`
        INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(room_id, key) DO UPDATE SET value = excluded.value
      `).bind(roomId, 'admin_pin_hash', await sha256Hex(newPin)).run();
      return jsonResponse({ success: true });
    }

    // POST /api/admin/members { id?, name, nickname?, phone? } - manager+
    if (path === 'admin/members' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const m = await request.json().catch(() => ({}));
      const name = String(m.name || '').trim().slice(0, 60);
      const nickname = String(m.nickname || '').trim().slice(0, 40);
      const phone = String(m.phone || '').trim().slice(0, 20);

      if (m.id) {
        const id = String(m.id);
        const target = await loadMember(db, roomId, id);
        if (!target) return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
        if (name.length < 1) return jsonResponse({ error: 'Tên thành viên không được trống.' }, 400);
        await db.prepare('UPDATE members SET name = ?, nickname = ?, phone = ? WHERE id = ? AND room_id = ?')
          .bind(name, nickname, phone, id, roomId).run();
        return jsonResponse({ success: true, id });
      }

      if (name.length < 2) return jsonResponse({ error: 'Tên thành viên cần ít nhất 2 ký tự.' }, 400);
      const id = randomId('mem');
      await db.prepare('INSERT INTO members (id, room_id, name, nickname, phone, is_active) VALUES (?, ?, ?, ?, ?, 1)')
        .bind(id, roomId, name, nickname, phone).run();
      return jsonResponse({ success: true, id });
    }

    // POST /api/admin/members/:id/(deactivate|reactivate|role|unlink)
    const memberAction = /^admin\/members\/([^/]+)\/(deactivate|reactivate|role|unlink)$/.exec(path);
    if (memberAction && method === 'POST') {
      const targetId = memberAction[1];
      const action = memberAction[2];
      const minRole = action === 'deactivate' || action === 'reactivate' ? 'manager' : 'owner';
      const gate = await roomGate(db, user, roomId, minRole);
      if (gate.response) return gate.response;

      const target = await loadMember(db, roomId, targetId);
      if (!target) return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
      const ownerId = gate.room.owner_member_id;
      const targetRank = await memberRank(db, roomId, targetId, ownerId);
      if (targetRank >= ROLE_RANK[gate.role]) {
        return jsonResponse({ error: 'Không thao tác được trên người ngang hoặc cao quyền hơn.', room_id: roomId }, 403);
      }

      if (action === 'deactivate') {
        const blocked = await checkRemovable(db, roomId, targetId);
        if (blocked) return jsonResponse({ error: blocked, room_id: roomId }, 409);
        await deactivateMember(db, roomId, targetId);
        return jsonResponse({ success: true, member_id: targetId, is_active: 0 });
      }

      if (action === 'reactivate') {
        await db.prepare('UPDATE members SET is_active = 1 WHERE id = ? AND room_id = ?')
          .bind(targetId, roomId).run();
        return jsonResponse({ success: true, member_id: targetId, is_active: 1 });
      }

      if (action === 'role') {
        const body = await request.json().catch(() => ({}));
        const role = String(body.role || '');
        if (!INVITE_ROLES.includes(role)) return jsonResponse({ error: 'Quyền không hợp lệ.' }, 400);
        const membership = await db.prepare('SELECT user_id FROM memberships WHERE room_id = ? AND member_id = ?')
          .bind(roomId, targetId).first();
        if (!membership) {
          return jsonResponse({ error: 'Thành viên chưa có tài khoản, chưa đặt được quyền.' }, 409);
        }
        await db.prepare('UPDATE memberships SET role = ? WHERE room_id = ? AND member_id = ?')
          .bind(role, roomId, targetId).run();
        return jsonResponse({ success: true, member_id: targetId, role });
      }

      // unlink: gỡ liên kết tài khoản. Người đó quay về "chưa có tài khoản" và nhận
      // quyền lại bằng link claim mới; lịch sử tiền của member row không đổi.
      const removed = await db.prepare('DELETE FROM memberships WHERE room_id = ? AND member_id = ?')
        .bind(roomId, targetId).run();
      await db.prepare('DELETE FROM invites WHERE room_id = ? AND member_id = ?')
        .bind(roomId, targetId).run();
      return jsonResponse({ success: true, member_id: targetId, unlinked: (removed.meta?.changes ?? 0) > 0 });
    }

    // POST /api/admin/periods
    if (path === 'admin/periods' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const p = await request.json().catch(() => ({}));
      const id = String(p.id || 'period_' + Date.now());
      await db.prepare(`
        INSERT INTO periods (room_id, id, title, due_date, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(room_id, id) DO UPDATE SET
          title = excluded.title,
          due_date = excluded.due_date,
          status = excluded.status
      `).bind(roomId, id, p.title, p.due_date || '', p.status || 'open').run();
      return jsonResponse({ success: true, id });
    }

    // DELETE /api/admin/periods/:id - xóa kỳ kéo theo khoản + shares, chỉ chủ phòng
    if (path.startsWith('admin/periods/') && method === 'DELETE') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const id = path.split('/')[2];
      await db.batch([
        db.prepare('DELETE FROM periods WHERE id = ? AND room_id = ?').bind(id, roomId),
        db.prepare('DELETE FROM expenses WHERE period_id = ? AND room_id = ?').bind(id, roomId),
        db.prepare('DELETE FROM member_shares WHERE period_id = ? AND room_id = ?').bind(id, roomId),
      ]);
      return jsonResponse({ success: true });
    }

    // POST /api/admin/expenses
    if (path === 'admin/expenses' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const exp = await request.json().catch(() => ({}));
      const id = String(exp.id || ('exp_' + Date.now()));

      const dateStr = String(exp.expense_date || new Date().toISOString().split('T')[0]);
      const parts = dateStr.split('-');
      const year = parts[0] || '2026';
      const month = parts[1] || '10';
      const periodId = String(exp.period_id || `${year}-${month}`);

      const targetMemberId = exp.target_member_id ? String(exp.target_member_id) : null;
      if (targetMemberId) {
        const known = await db.prepare('SELECT id FROM members WHERE id = ? AND room_id = ?')
          .bind(targetMemberId, roomId).first();
        if (!known) return jsonResponse({ error: 'Người nhận khoản không thuộc phòng này.' }, 400);
      }

      await db.prepare(
        "INSERT OR IGNORE INTO periods (room_id, id, title, due_date, status) VALUES (?, ?, ?, '', 'open')"
      ).bind(roomId, periodId, `Tháng ${month}/${year}`).run();

      const category = String(exp.category || 'khac');
      const title = String(exp.title || 'Khoản chi');
      const amount = parseInt(exp.amount, 10) || 0;
      const note = String(exp.note || '');
      const quantity = exp.quantity != null ? parseInt(exp.quantity, 10) : null;
      const unitPrice = exp.unit_price != null ? parseInt(exp.unit_price, 10) : null;
      let splitConfig = null;
      if (exp.split_config !== undefined && exp.split_config !== null && exp.split_config !== '') {
        splitConfig = typeof exp.split_config === 'string' ? exp.split_config : JSON.stringify(exp.split_config);
      }

      try {
        const res = await db.prepare(`
          INSERT INTO expenses (id, room_id, period_id, category, title, amount, note, expense_date, target_member_id, quantity, unit_price, split_config)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            room_id = excluded.room_id,
            period_id = excluded.period_id,
            category = excluded.category,
            title = excluded.title,
            amount = excluded.amount,
            note = excluded.note,
            expense_date = excluded.expense_date,
            target_member_id = excluded.target_member_id,
            quantity = excluded.quantity,
            unit_price = excluded.unit_price,
            split_config = excluded.split_config
          WHERE expenses.room_id = excluded.room_id
        `).bind(
          id, roomId, periodId, category, title, amount, note, dateStr,
          targetMemberId, quantity, unitPrice, splitConfig
        ).run();
        if ((res.meta?.changes ?? 0) === 0) {
          return jsonResponse({ error: 'Khoản chi này thuộc phòng khác.', room_id: roomId }, 409);
        }
      } catch (err) {
        return jsonResponse({ error: 'Lỗi lưu chi tiêu: ' + String(err?.message || err) }, 500);
      }
      return jsonResponse({ success: true, id, period_id: periodId });
    }

    // DELETE /api/admin/expenses/:id
    if (path.startsWith('admin/expenses/') && method === 'DELETE') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const id = path.split('/')[2];
      await db.prepare('DELETE FROM expenses WHERE id = ? AND room_id = ?').bind(id, roomId).run();
      return jsonResponse({ success: true });
    }

    // POST /api/admin/toggle-share-paid { period_id, member_id, is_paid, paid_amount? }
    if (path === 'admin/toggle-share-paid' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const periodId = String(body.period_id || '');
      const memberId = String(body.member_id || '');
      if (!/^\d{4}-\d{2}$/.test(periodId)) return jsonResponse({ error: 'Kỳ không hợp lệ.' }, 400);
      const known = await db.prepare('SELECT id FROM members WHERE id = ? AND room_id = ?')
        .bind(memberId, roomId).first();
      if (!known) return jsonResponse({ error: 'Thành viên không thuộc phòng này.' }, 400);
      const isPaid = !!body.is_paid;
      const paidAt = isPaid ? new Date().toISOString() : null;
      const paidInt = body.paid_amount === undefined || body.paid_amount === null
        ? null
        : Math.max(0, parseInt(body.paid_amount, 10) || 0);
      await db.prepare(`
        INSERT INTO member_shares (room_id, period_id, member_id, amount, is_paid, paid_at, note, paid_amount)
        VALUES (?, ?, ?, 0, ?, ?, '', COALESCE(?, 0))
        ON CONFLICT(room_id, period_id, member_id) DO UPDATE SET
          is_paid = excluded.is_paid,
          paid_at = excluded.paid_at,
          paid_amount = COALESCE(?, member_shares.paid_amount)
      `).bind(roomId, periodId, memberId, isPaid ? 1 : 0, paidAt, paidInt, paidInt).run();
      return jsonResponse({ success: true, is_paid: isPaid, paid_at: paidAt });
    }

    // POST /api/admin/invites { member_id, role?, ttl_min? }
    if (path === 'admin/invites' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      return mintInvite(db, roomId, gate, await request.json().catch(() => ({})));
    }

    // POST /api/admin/transfer-owner { member_id } - người nhận phải active VÀ có tài khoản
    if (path === 'admin/transfer-owner' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const memberId = String(body.member_id || '');
      const target = await loadMember(db, roomId, memberId);
      if (!target) return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
      if (!target.is_active) {
        return jsonResponse({ error: 'Không giao phòng cho người đã ngưng hoạt động.' }, 409);
      }
      const bound = await db.prepare('SELECT user_id FROM memberships WHERE room_id = ? AND member_id = ?')
        .bind(roomId, memberId).first();
      if (!bound) {
        return jsonResponse({ error: 'Người này chưa có tài khoản nên không đăng nhập nhận phòng được. Gửi link mời trước.' }, 409);
      }
      await db.batch([
        db.prepare('UPDATE rooms SET owner_member_id = ? WHERE room_id = ?').bind(memberId, roomId),
        // Chủ cũ hạ về manager để không mất quyền quản trị trong phòng.
        db.prepare("UPDATE memberships SET role = 'manager' WHERE room_id = ? AND member_id = ?")
          .bind(roomId, gate.member.id),
      ]);
      return jsonResponse({ success: true, room_id: roomId, owner_member_id: memberId });
    }

    return jsonResponse({ error: 'Endpoint không tồn tại' }, 404);
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Lỗi máy chủ' }, 500);
  }
}
