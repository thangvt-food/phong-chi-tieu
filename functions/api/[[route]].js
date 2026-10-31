// Cloudflare Pages Functions - Catch-all API Route for /api/*

// Phòng kế thừa: client cũ (chưa gửi ?p) và URL cũ vẫn trỏ đúng phòng này.
const DEFAULT_ROOM = 'phong-2a';
const ROOM_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
    },
  });
}

// slug không hợp lệ -> trả về lỗi, không âm thầm fallback (fallback chỉ dành cho
// request thiếu hẳn ?p, tức client cũ).
function resolveRoomId(url) {
  const raw = url.searchParams.get('p');
  if (raw === null || raw === '') return { roomId: DEFAULT_ROOM };
  if (!ROOM_SLUG_RE.test(raw)) return { error: 'Mã phòng không hợp lệ.' };
  return { roomId: raw };
}

async function verifyAdmin(env, roomId, providedHash) {
  if (!providedHash || !env.DB) return false;
  // Không có fallback PIN mặc định nữa: DB lỗi hoặc phòng chưa set PIN => từ chối.
  // (Trước đây cả hai trường hợp đều âm thầm accept hash của "123456".)
  const row = await env.DB.prepare(
    'SELECT value FROM settings WHERE room_id = ? AND key = ?'
  ).bind(roomId, 'admin_pin_hash').first();
  if (!row || !row.value) return false;
  return providedHash.toLowerCase() === String(row.value).toLowerCase();
}

// ---- Phiên & lời mời (token opaque, chỉ lưu SHA-256 trong DB) ----
// Lý do không dùng JWT: yêu cầu "đá người khỏi phòng" phải thu hồi được ngay ở
// request kế tiếp, mà token stateless thì không - bảng sessions ít code hơn và
// thu hồi = SET revoked_at.
const SESSION_TTL_MS = 90 * 24 * 3600 * 1000;
const INVITE_TTL_MIN_DEFAULT = 15;

function b64url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function newToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

function isoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

async function createSession(db, roomId, memberId, role) {
  const token = await newToken();
  const expiresAt = isoAfter(SESSION_TTL_MS);
  await db.prepare(`
    INSERT INTO sessions (token_hash, room_id, member_id, role, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(await sha256Hex(token), roomId, memberId, role, expiresAt).run();
  return { token, expires_at: expiresAt, room_id: roomId, member_id: memberId, role };
}

// null = không có phiên hợp lệ. err = có token nhưng đã bị thu hồi/hết hạn.
async function readSession(db, request) {
  const raw = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!raw) return null;
  const row = await db.prepare(`
    SELECT room_id, member_id, role, expires_at, revoked_at
      FROM sessions WHERE token_hash = ?
  `).bind(await sha256Hex(raw)).first();
  if (!row) return { err: 'invalid' };
  if (row.revoked_at) return { err: 'revoked' };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { err: 'expired' };
  return { roomId: row.room_id, memberId: row.member_id, role: row.role, token: raw };
}

// Ba mức quyền của link mời (cột invites.role, migration 003):
//   viewer  - chỉ xem sổ
//   member  - xem + tự tick "đã nộp" cho phần của mình (mặc định, = hành vi cũ)
//   manager - như member + tạo lại link mời + thu hồi phiên; KHÔNG sửa được sổ
const INVITE_ROLES = ['viewer', 'member', 'manager'];
const INVITE_PATHS_FOR_MANAGER = ['admin/invites', 'admin/revoke'];

function normalizeRole(role) {
  return INVITE_ROLES.includes(role) ? role : 'member';
}

async function getOwnerMemberId(db, roomId) {
  const row = await db.prepare('SELECT owner_member_id FROM rooms WHERE room_id = ?').bind(roomId).first();
  return row?.owner_member_id || null;
}

// "Xóa thành viên" = NGƯNG HOẠT ĐỘNG, không phải xóa dòng. Một sổ cái không được
// phép viết lại quá khứ: member_shares của người đó là dữ liệu tiền thật, và
// expenses.split_config vẫn tham chiếu id của họ — xóa cứng làm client tính lại
// và chia khoản cũ cho những người còn ở (xem src/services/api.js calcExpenseShares).
// Quyền vào phòng thì mất ngay: mọi phiên thu hồi, mọi link mời bị xóa.
async function deactivateMember(db, roomId, memberId) {
  const nowIso = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE members SET is_active = 0 WHERE id = ? AND room_id = ?').bind(memberId, roomId),
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE room_id = ? AND member_id = ? AND revoked_at IS NULL')
      .bind(nowIso, roomId, memberId),
    db.prepare('DELETE FROM invites WHERE room_id = ? AND member_id = ?').bind(roomId, memberId),
  ]);
  return nowIso;
}

// Chặn hai tình huống phòng bị mất chủ / mất người cuối cùng. Trả về message lỗi
// hoặc null khi được phép. Dùng chung cho DELETE member và POST rooms/leave.
async function checkRemovable(db, roomId, memberId) {
  const owner = await getOwnerMemberId(db, roomId);
  if (memberId && owner && memberId === owner) {
    return 'Chủ phòng không rời/xóa được khi chưa giao phòng lại cho người khác.';
  }
  const active = await db
    .prepare('SELECT COUNT(*) AS c FROM members WHERE room_id = ? AND is_active = 1')
    .bind(roomId)
    .first();
  const target = await db
    .prepare('SELECT is_active FROM members WHERE id = ? AND room_id = ?')
    .bind(memberId, roomId)
    .first();
  if (target && target.is_active && (active?.c ?? 0) <= 1) {
    return 'Phòng cần còn ít nhất một thành viên đang hoạt động.';
  }
  return null;
}

// 11/12 - mint link mời và thu hồi phiên, dùng cho CẢ hai đường credential:
// chủ phòng (x-admin-hash = PIN) và manager (Bearer session role='manager').
// Tách khỏi thân handler để hai đường không thể lệch nhau về validate.
async function mintInvite(env, roomId, body) {
  const memberId = String(body.member_id || '');
  const ttlMin = Math.min(1440, Math.max(1, parseInt(body.ttl_min) || INVITE_TTL_MIN_DEFAULT));
  const uses = Math.min(5, Math.max(1, parseInt(body.uses) || 1));
  const role = normalizeRole(body.role);

  const member = await env.DB.prepare('SELECT id, name, nickname, is_active FROM members WHERE id = ? AND room_id = ?')
    .bind(memberId, roomId).first();
  if (!member) return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
  if (!member.is_active) {
    return jsonResponse({ error: 'Thành viên đã ngưng hoạt động, hãy thêm lại rồi mới mời.', room_id: roomId }, 409);
  }

  const expiresAt = isoAfter(ttlMin * 60 * 1000);
  // Tạo link mới = vô hiệu hoá link cũ còn sót của đúng thành viên đó.
  const token = await newToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM invites WHERE room_id = ? AND member_id = ?').bind(roomId, memberId),
    env.DB.prepare(
      'INSERT INTO invites (token_hash, room_id, member_id, role, expires_at, uses_left) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(await sha256Hex(token), roomId, memberId, role, expiresAt, uses),
  ]);
  return jsonResponse({
    success: true,
    room_id: roomId,
    member_id: memberId,
    role,
    token,
    ttl_min: ttlMin,
    uses_left: uses,
    expires_at: expiresAt,
  });
}

async function revokeMemberSessions(env, roomId, body) {
  const memberId = String(body.member_id || '');
  const res = await env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE room_id = ? AND member_id = ? AND revoked_at IS NULL'
  ).bind(new Date().toISOString(), roomId, memberId).run();
  await env.DB.prepare(
    'DELETE FROM invites WHERE room_id = ? AND member_id = ?'
  ).bind(roomId, memberId).run();
  return jsonResponse({ success: true, revoked: res.meta?.changes ?? 0 });
}

async function inviteAdminResponse(env, roomId, request, path) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Endpoint không tồn tại' }, 404);
  const body = await request.json().catch(() => ({}));
  if (path === 'admin/invites') return mintInvite(env, roomId, body);
  if (path === 'admin/revoke') return revokeMemberSessions(env, roomId, body);
  return jsonResponse({ error: 'Endpoint không tồn tại' }, 404);
}

// slug từ tên phòng: bỏ dấu, lowercase, ký tự không hợp lệ -> '-'
function slugify(name) {
  const noAccents = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd').replace(/\u0110/g, 'D');
  const slug = noAccents.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return ROOM_SLUG_RE.test(slug) ? slug : '';
}

// Mã phòng cho nội dung chuyển khoản: bỏ các từ chung, giữ phần còn lại <=6 ký tự.
// Phải khớp defaultTransferCode() trong src/services/api.js - client dùng nó làm
// fallback cho phòng cũ chưa có setting transfer_code.
const GENERIC_ROOM_TOKENS = ['phong', 'tro', 'nha', 'nhatro', 'phongtro'];
function deriveTransferCode(slug) {
  const tokens = String(slug || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !GENERIC_ROOM_TOKENS.includes(t));
  return (meaningful.length ? meaningful : tokens).join('').toUpperCase().slice(0, 6);
}

// Kiểm tra schema đủ version chưa.
// Thay cho cờ `isMigrated` cũ: cờ đó set true kể cả khi ALTER thất bại, nên một isolate
// đã "khuôn" là DB sẵn sàng dù thật ra thiếu cột. Ở đây chỉ cache khi D1 xác nhận đúng
// version; lỗi thì lần request sau probe lại.
const SCHEMA_VERSION = 3;
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady || !db) return { ok: schemaReady || !db };
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
  const { request, env, params } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  const method = request.method;

  // App và Functions cùng origin (Pages) nên không cần CORS. vite dev cũng proxy
  // /api nên same-origin. Bỏ "Access-Control-Allow-Origin: *" để không mở mặt
  // đọc dữ liệu cho mọi website khác.
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // If D1 is not bound, notify client
  const hasD1 = !!env.DB;
  if (hasD1) {
    const schema = await ensureSchema(env.DB);
    // Đọc vẫn chạy trên schema cũ; ghi thì chặn sớm và nói rõ nguyên nhân,
    // để window migrate không sinh ra lỗi "no such column" khó hiểu ở client.
    if (!schema.ok && method !== 'GET') {
      return jsonResponse(
        { error: `Schema D1 chưa ở version ${SCHEMA_VERSION}. Chạy migrations/003_invite_roles.sql (theo thứ tự sau 002) trước khi ghi.`, schemaError: schema.error },
        503
      );
    }
  }

  const roomResolve = resolveRoomId(url);
  if (roomResolve.error) return jsonResponse({ error: roomResolve.error }, 400);
  const roomId = roomResolve.roomId;

  try {
    // 1. GET /api/data - Load all public data của một phòng
    if (path === 'data' && method === 'GET') {
      if (!hasD1) {
        return jsonResponse({
          hasD1: false,
          message: 'D1 chưa được cấu hình. Sử dụng chế độ LocalStorage.',
        });
      }

      const roomRow = await env.DB
        .prepare('SELECT room_id, name, owner_member_id FROM rooms WHERE room_id = ?')
        .bind(roomId)
        .first();
      if (!roomRow) {
        return jsonResponse(
          { error: 'Phòng không tồn tại hoặc bạn chưa được mời.', room_id: roomId, need_invite: true },
          404
        );
      }

      // Fetch all tables
      const [settingsRes, membersRes, periodsRes, expensesRes, sharesRes] = await Promise.all([
        env.DB.prepare('SELECT key, value FROM settings WHERE room_id = ?').bind(roomId).all(),
        env.DB.prepare('SELECT * FROM members WHERE room_id = ? ORDER BY created_at ASC').bind(roomId).all(),
        env.DB.prepare('SELECT * FROM periods WHERE room_id = ? ORDER BY id DESC').bind(roomId).all(),
        env.DB.prepare('SELECT * FROM expenses WHERE room_id = ? ORDER BY expense_date DESC, created_at DESC').bind(roomId).all(),
        env.DB.prepare('SELECT * FROM member_shares WHERE room_id = ?').bind(roomId).all(),
      ]);

      const settings = {};
      (settingsRes.results || []).forEach((row) => {
        if (row.key !== 'admin_pin_hash') {
          settings[row.key] = row.value;
        }
      });

      return jsonResponse({
        hasD1: true,
        room_id: roomId,
        room_name: roomRow.name,
        // client cần để ẩn nút "Ngưng hoạt động" đúng người và hiện badge "Chủ".
        // member_id vốn đã nằm trong payload nên đây không phải thông tin mới lộ.
        owner_member_id: roomRow.owner_member_id || null,
        settings,
        members: membersRes.results || [],
        periods: periodsRes.results || [],
        expenses: expensesRes.results || [],
        member_shares: sharesRes.results || [],
      });
    }

    // 2. POST /api/admin/verify - Check admin PIN hash
    if (path === 'admin/verify' && method === 'POST') {
      const body = await request.json();
      const isValid = await verifyAdmin(env, roomId, body.pin_hash);
      return jsonResponse({ valid: isValid, room_id: roomId });
    }

    if (!hasD1) {
      return jsonResponse({ error: 'D1 database chưa được cấu hình trên Cloudflare.' }, 500);
    }

    // ---- Các endpoint KHÔNG cần PIN của admin (tự phục vụ / dùng link mời) ----

    // 3. POST /api/rooms - Tạo phòng mới.
    // Open by design: ai cũng tạo được phòng của mình, người tạo tự đặt PIN cho phòng đó.
    // Body: { name, pin_hash, owner_name? }
    if (path === 'rooms' && method === 'POST') {
      const body = await request.json();
      const name = String(body.name || '').trim().slice(0, 40);
      const pinHash = String(body.pin_hash || '').toLowerCase();
      if (name.length < 2) return jsonResponse({ error: 'Tên phòng cần ít nhất 2 ký tự.' }, 400);
      if (!/^[0-9a-f]{64}$/.test(pinHash)) {
        return jsonResponse({ error: 'PIN không hợp lệ (thiếu pin_hash).' }, 400);
      }
      const slug = slugify(name);
      if (!slug) return jsonResponse({ error: 'Tên phòng không tạo được mã slug.' }, 400);

      const clash = await env.DB.prepare('SELECT room_id FROM rooms WHERE room_id = ?').bind(slug).first();
      if (clash) {
        return jsonResponse({ error: `Mã phòng "${slug}" đã tồn tại, hãy đặt tên khác.`, slug }, 409);
      }

      const ownerName = String(body.owner_name || '').trim().slice(0, 60);
      const ownerId = ownerName ? 'mem_' + Date.now() : null;
      const transferCode = deriveTransferCode(slug);

      const stmts = [
        env.DB.prepare('INSERT INTO rooms (room_id, name, owner_member_id) VALUES (?, ?, ?)')
          .bind(slug, name, ownerId),
        env.DB.prepare('INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)').bind(slug, 'room_name', name),
        env.DB.prepare('INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)').bind(slug, 'admin_pin_hash', pinHash),
        env.DB.prepare('INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)').bind(slug, 'transfer_prefix', 'TIEN PHONG'),
        // Mã phòng đi TRƯỚC tên người trong nội dung CK: ngân hàng cắt nội dung từ
        // đuôi, nên mã đứng sau sẽ bị mất khi chủ phòng dùng chung một STK cho nhiều phòng.
        env.DB.prepare('INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?)').bind(slug, 'transfer_code', transferCode),
      ];
      if (ownerId) {
        stmts.push(
          env.DB.prepare('INSERT INTO members (id, room_id, name, nickname, is_active) VALUES (?, ?, ?, ?, 1)')
            .bind(ownerId, slug, ownerName, ownerName.split(' ').pop())
        );
      }
      await env.DB.batch(stmts);

      return jsonResponse({ success: true, room_id: slug, name, member_id: ownerId });
    }

    // 4. POST /api/join - Vào phòng bằng link mời (token thô, không lưu trong DB)
    // Body: { token, name?, phone? }
    if (path === 'join' && method === 'POST') {
      const body = await request.json();
      const token = String(body.token || '');
      if (token.length < 40) return jsonResponse({ error: 'Link mời không hợp lệ.', need_invite: true }, 400);

      const tokenHash = await sha256Hex(token);
      const invite = await env.DB.prepare(`
        SELECT room_id, member_id, role, expires_at, uses_left FROM invites WHERE token_hash = ?
      `).bind(tokenHash).first();
      if (!invite) {
        return jsonResponse({ error: 'Link mời không tồn tại hoặc đã bị thu hồi.', need_invite: true }, 404);
      }

      // Trừ số lần dùng trong chính câu UPDATE: hai request song song không cùng "tiêu thụ"
      // một lượt (changes = 0 nghĩa là đã hết lượt/hết hạn).
      const nowIso = new Date().toISOString();
      const consumed = await env.DB.prepare(`
        UPDATE invites SET uses_left = uses_left - 1
        WHERE token_hash = ? AND uses_left > 0 AND expires_at > ?
      `).bind(tokenHash, nowIso).run();
      if ((consumed.meta?.changes ?? 0) === 0) {
        return jsonResponse({ error: 'Link mời đã hết hạn hoặc đã dùng.', need_invite: true }, 410);
      }

      const { room_id: roomId2, member_id: memberId } = invite;
      const newName = String(body.name || '').trim().slice(0, 60);
      const newPhone = String(body.phone || '').trim().slice(0, 20);
      if (newName || newPhone) {
        await env.DB.prepare(
          'UPDATE members SET name = COALESCE(NULLIF(?, ""), name), phone = COALESCE(NULLIF(?, ""), phone) WHERE id = ? AND room_id = ?'
        ).bind(newName, newPhone, memberId, roomId2).run();
      }

      // Quyền đi từ link, không từ client: người mở link nhận đúng mức chủ phòng đã chọn.
      const role = normalizeRole(invite.role);
      const session = await createSession(env.DB, roomId2, memberId, role);
      const roomRow = await env.DB.prepare('SELECT name FROM rooms WHERE room_id = ?').bind(roomId2).first();
      const meRow = await env.DB.prepare('SELECT name, nickname FROM members WHERE id = ? AND room_id = ?')
        .bind(memberId, roomId2).first();

      return jsonResponse({
        success: true,
        room_id: roomId2,
        room_name: roomRow?.name || roomId2,
        member_id: memberId,
        member_name: meRow?.name || '',
        role,
        session,
      });
    }

    // 5. GET /api/me - Phiên member hiện tại (client dùng để biết mình là ai / hết phiên)
    if (path === 'me' && method === 'GET') {
      const session = await readSession(env.DB, request);
      if (!session) return jsonResponse({ error: 'Chưa có phiên.', need_invite: true }, 401);
      if (session.err) {
        return jsonResponse({ error: 'Phiên đã hết hạn hoặc bị thu hồi.', need_invite: true, reason: session.err }, 401);
      }
      if (session.roomId !== roomId) {
        return jsonResponse({ error: 'Phiên không thuộc phòng này.', room_id: roomId }, 403);
      }
      const me = await env.DB.prepare('SELECT id, name, nickname, phone FROM members WHERE id = ? AND room_id = ?')
        .bind(session.memberId, roomId).first();
      await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
        .bind(new Date().toISOString(), await sha256Hex(session.token)).run();
      return jsonResponse({ room_id: roomId, member_id: session.memberId, role: session.role, member: me });
    }

    // 6. POST /api/member/toggle-share-paid - Member tự đánh dấu ĐÃ NỘP cho phần của mình.
    // member_id lấy từ phiên, không lấy từ body: người ta không tick hộ/cho phòng khác được.
    if (path === 'member/toggle-share-paid' && method === 'POST') {
      const session = await readSession(env.DB, request);
      if (!session || session.err) {
        return jsonResponse({ error: 'Cần link mời để vào phòng.', need_invite: true, reason: session?.err }, 401);
      }
      if (session.roomId !== roomId) {
        return jsonResponse({ error: 'Phiên không thuộc phòng này.', room_id: roomId }, 403);
      }
      if (session.role === 'viewer') {
        return jsonResponse({ error: 'Link mời này chỉ cho xem sổ, không đánh dấu được.', room_id: roomId }, 403);
      }
      const body = await request.json();
      const periodId = String(body.period_id || '');
      if (!/^\d{4}-\d{2}$/.test(periodId)) return jsonResponse({ error: 'Kỳ không hợp lệ.' }, 400);
      const memberId = session.memberId;
      const isPaid = !!body.is_paid;
      const paidAt = isPaid ? new Date().toISOString() : null;
      // Member chỉ được tự khai số đã nộp <= phần còn lại; phần thu thực tế vẫn do admin xác nhận.
      const paidInt = body.paid_amount === undefined || body.paid_amount === null
        ? null
        : Math.max(0, parseInt(body.paid_amount) || 0);
      await env.DB.prepare(`
        INSERT INTO member_shares (room_id, period_id, member_id, amount, is_paid, paid_at, note, paid_amount)
        VALUES (?, ?, ?, 0, ?, ?, '', COALESCE(?, 0))
        ON CONFLICT(room_id, period_id, member_id) DO UPDATE SET
          is_paid = excluded.is_paid,
          paid_at = excluded.paid_at,
          paid_amount = COALESCE(?, member_shares.paid_amount)
      `).bind(roomId, periodId, memberId, isPaid ? 1 : 0, paidAt, paidInt, paidInt).run();
      return jsonResponse({ success: true, member_id: memberId, is_paid: isPaid, paid_at: paidAt });
    }

    // 6b. POST /api/rooms/leave - Tự rời khỏi phòng (server), khác "gỡ khỏi máy này".
    // Credential tự chọn: Bearer session (member_id LẤY TỪ PHIÊN, không từ body — cùng
    // nguyên tắc với toggle-share-paid) HOẶC PIN + member_id trong body, để chủ phòng
    // tạo phòng bằng PIN mà chưa từng có phiên cũng rời được.
    // Hậu quả giống DELETE member: is_active=0, mọi phiên thu hồi, mọi link mời bị xóa;
    // member_shares và split_config vẫn còn -> lịch sử tiền không đổi.
    if (path === 'rooms/leave' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const session = await readSession(env.DB, request);
      const byPin = await verifyAdmin(env, roomId, request.headers.get('x-admin-hash'));
      let memberId;
      if (session && !session.err && session.roomId === roomId) {
        memberId = session.memberId;
      } else if (byPin) {
        memberId = String(body.member_id || '');
        if (!memberId) return jsonResponse({ error: 'Cần member_id khi dùng PIN.' }, 400);
        const known = await env.DB.prepare('SELECT id FROM members WHERE id = ? AND room_id = ?')
          .bind(memberId, roomId).first();
        if (!known) return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
      } else {
        return jsonResponse(
          { error: 'Cần phiên đăng nhập hoặc PIN của phòng để rời phòng.', need_invite: true },
          401
        );
      }
      const blocked = await checkRemovable(env.DB, roomId, memberId);
      if (blocked) return jsonResponse({ error: blocked, room_id: roomId }, 409);
      await deactivateMember(env.DB, roomId, memberId);
      return jsonResponse({ success: true, room_id: roomId, member_id: memberId, left: true });
    }

    // ---- Từ đây trở xuống cần PIN admin (theo từng phòng) ----
    // Bearer session chỉ thay được PIN ở đúng hai endpoint mời/thu hồi, và chỉ khi
    // phiên đó có role='manager' (link mời mức manager). Mọi đường ghi khác vẫn
    // 401 với session: quyền "mời người" không kéo theo quyền "sửa sổ".
    const adminHash = request.headers.get('x-admin-hash');
    const isPin = await verifyAdmin(env, roomId, adminHash);
    if (!isPin && INVITE_PATHS_FOR_MANAGER.includes(path)) {
      const session = await readSession(env.DB, request);
      if (session && !session.err && session.roomId === roomId && session.role === 'manager') {
        return inviteAdminResponse(env, roomId, request, path);
      }
    }
    if (!isPin) {
      return jsonResponse({ error: 'Mã xác thực Admin không hợp lệ hoặc hết hạn!', room_id: roomId }, 401);
    }

    if (!hasD1) {
      return jsonResponse({ error: 'D1 database chưa được cấu hình trên Cloudflare.' }, 500);
    }

    // 3. POST /api/admin/settings - Update settings
    if (path === 'admin/settings' && method === 'POST') {
      const body = await request.json();
      const updates = [];
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined && v !== null) {
          updates.push(
            env.DB.prepare(
              'INSERT INTO settings (room_id, key, value) VALUES (?, ?, ?) ON CONFLICT(room_id, key) DO UPDATE SET value = excluded.value'
            ).bind(roomId, k, String(v))
          );
        }
      }
      if (updates.length > 0) {
        await env.DB.batch(updates);
      }
      return jsonResponse({ success: true, message: 'Đã cập nhật cài đặt!' });
    }

    // 4. POST /api/admin/members - Add or update member
    if (path === 'admin/members' && method === 'POST') {
      const m = await request.json();
      const id = m.id || 'mem_' + Date.now();
      // WHERE members.room_id = excluded.room_id: id đã thuộc phòng khác thì UPSERT
      // bị bỏ qua (changes = 0) thay vì "bốc" thành viên sang phòng đang gọi.
      const res = await env.DB.prepare(`
        INSERT INTO members (id, room_id, name, nickname, phone, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id,
          name = excluded.name,
          nickname = excluded.nickname,
          phone = excluded.phone,
          is_active = excluded.is_active
        WHERE members.room_id = excluded.room_id
      `).bind(id, roomId, m.name, m.nickname || '', m.phone || '', m.is_active ?? 1).run();
      if ((res.meta?.changes ?? 0) === 0) {
        return jsonResponse({ error: 'Thành viên này thuộc phòng khác.', room_id: roomId }, 409);
      }

      return jsonResponse({ success: true, id });
    }

    // 5. DELETE /api/admin/members/:id - Ngưng hoạt động + cắt quyền, KHÔNG xóa lịch sử.
    // member_shares và expenses.split_config giữ nguyên: khoản nước tháng trước vẫn thuộc
    // về người đó, và số tiền của những người còn lại không đổi khi có người rời.
    if (path.startsWith('admin/members/') && method === 'DELETE') {
      const id = path.split('/')[2];
      const blocked = await checkRemovable(env.DB, roomId, id);
      if (blocked) return jsonResponse({ error: blocked, room_id: roomId }, 409);
      const exists = await env.DB.prepare('SELECT id FROM members WHERE id = ? AND room_id = ?')
        .bind(id, roomId).first();
      if (!exists) return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
      await deactivateMember(env.DB, roomId, id);
      return jsonResponse({ success: true, deactivated: true, member_id: id });
    }

    // 6. POST /api/admin/periods - Add or update period
    if (path === 'admin/periods' && method === 'POST') {
      const p = await request.json();
      const id = p.id || 'period_' + Date.now();
      await env.DB.prepare(`
        INSERT INTO periods (room_id, id, title, due_date, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(room_id, id) DO UPDATE SET
          title = excluded.title,
          due_date = excluded.due_date,
          status = excluded.status
      `).bind(roomId, id, p.title, p.due_date || '', p.status || 'open').run();

      return jsonResponse({ success: true, id });
    }

    // 7. DELETE /api/admin/periods - Delete period
    if (path.startsWith('admin/periods/') && method === 'DELETE') {
      const id = path.split('/')[2];
      await env.DB.batch([
        env.DB.prepare('DELETE FROM periods WHERE id = ? AND room_id = ?').bind(id, roomId),
        env.DB.prepare('DELETE FROM expenses WHERE period_id = ? AND room_id = ?').bind(id, roomId),
        env.DB.prepare('DELETE FROM member_shares WHERE period_id = ? AND room_id = ?').bind(id, roomId),
      ]);
      return jsonResponse({ success: true });
    }

    // 8. POST /api/admin/expenses - Add or update expense with auto-period resolution
    if (path === 'admin/expenses' && method === 'POST') {
      const exp = await request.json();
      const id = String(exp.id || ('exp_' + Date.now()));
      
      const dateStr = String(exp.expense_date || new Date().toISOString().split('T')[0]);
      const parts = dateStr.split('-');
      const year = parts[0] || '2026';
      const month = parts[1] || '10';
      const periodId = String(exp.period_id || `${year}-${month}`);
      const periodTitle = `Tháng ${month}/${year}`;

      try {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO periods (room_id, id, title, due_date, status) VALUES (?, ?, ?, '', 'open')"
        ).bind(roomId, periodId, periodTitle).run();
      } catch (e1) {
        return jsonResponse({ error: 'Lỗi tạo kỳ: ' + e1.message }, 500);
      }

      const category = String(exp.category || 'khac');
      const title = String(exp.title || 'Khoản chi');
      const amount = parseInt(exp.amount) || 0;
      const note = String(exp.note || '');
      const targetMemberId = exp.target_member_id ? String(exp.target_member_id) : null;
      const quantity = exp.quantity != null ? parseInt(exp.quantity) : null;
      const unitPrice = exp.unit_price != null ? parseInt(exp.unit_price) : null;
      let splitConfig = null;
      if (exp.split_config !== undefined && exp.split_config !== null && exp.split_config !== '') {
        splitConfig = typeof exp.split_config === 'string' ? exp.split_config : JSON.stringify(exp.split_config);
      }

      try {
        const res = await env.DB.prepare(`
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
          id,
          roomId,
          periodId,
          category,
          title,
          amount,
          note,
          dateStr,
          targetMemberId,
          quantity,
          unitPrice,
          splitConfig
        ).run();
        if ((res.meta?.changes ?? 0) === 0) {
          return jsonResponse({ error: 'Khoản chi này thuộc phòng khác.', room_id: roomId }, 409);
        }
      } catch (e2) {
        return jsonResponse({
          error: 'Lỗi lưu chi tiêu: ' + e2.message,
          debug: { id, periodId, category, title, amount, note, dateStr, targetMemberId, quantity, unitPrice }
        }, 500);
      }

      return jsonResponse({ success: true, id, period_id: periodId });
    }


    // 9. DELETE /api/admin/expenses - Delete expense
    if (path.startsWith('admin/expenses/') && method === 'DELETE') {
      const id = path.split('/')[2];
      await env.DB.prepare('DELETE FROM expenses WHERE id = ? AND room_id = ?').bind(id, roomId).run();
      return jsonResponse({ success: true });
    }

    // 10. POST /api/admin/toggle-share-paid - Quick toggle payment status
    // Body: { period_id, member_id, is_paid, paid_amount? }
    // - paid_amount: số tiền thực tế đã trả (hỗ trợ trả góp từng phần).
    //   Nếu không gửi, giữ nguyên giá trị cũ (tương thích bản trước).
    if (path === 'admin/toggle-share-paid' && method === 'POST') {
      const { period_id, member_id, is_paid, paid_amount } = await request.json();
      const paidAt = is_paid ? new Date().toISOString() : null;
      const paidInt = paid_amount === undefined || paid_amount === null
        ? null
        : Math.max(0, parseInt(paid_amount) || 0);
      // paid_amount = null => ghi 0 khi mới có dòng, giữ giá trị cũ khi đã có dòng.
      await env.DB.prepare(`
        INSERT INTO member_shares (room_id, period_id, member_id, amount, is_paid, paid_at, note, paid_amount)
        VALUES (?, ?, ?, 0, ?, ?, '', COALESCE(?, 0))
        ON CONFLICT(room_id, period_id, member_id) DO UPDATE SET
          is_paid = excluded.is_paid,
          paid_at = excluded.paid_at,
          paid_amount = COALESCE(?, member_shares.paid_amount)
      `).bind(roomId, period_id, member_id, is_paid ? 1 : 0, paidAt, paidInt, paidInt).run();

      return jsonResponse({ success: true, is_paid, paid_at: paidAt });
    }

    // 11. POST /api/admin/invites - Sinh link mời cho MỘT thành viên cụ thể
    // Body: { member_id, role?, ttl_min?, uses? } -> { token, expires_at, role }
    // Token thô chỉ đi qua dây một lần; DB chỉ chứa SHA-256 của nó.
    if (path === 'admin/invites' && method === 'POST') {
      return mintInvite(env, roomId, await request.json());
    }

    // 12. POST /api/admin/revoke - Đá khỏi phòng: thu hồi mọi phiên của một thành viên
    // (ngưng luôn tư cách thành viên thì dùng DELETE /api/admin/members/:id).
    if (path === 'admin/revoke' && method === 'POST') {
      return revokeMemberSessions(env, roomId, await request.json());
    }

    // 13. POST /api/admin/transfer-owner - Giao phòng cho một thành viên đang hoạt động.
    // Không có endpoint này thì guard "chủ phòng không tự rời" thành bẫy: phòng có chủ
    // vĩnh viễn không bỏ được.
    if (path === 'admin/transfer-owner' && method === 'POST') {
      const body = await request.json();
      const memberId = String(body.member_id || '');
      const target = await env.DB.prepare('SELECT id, is_active FROM members WHERE id = ? AND room_id = ?')
        .bind(memberId, roomId).first();
      if (!target) return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
      if (!target.is_active) {
        return jsonResponse({ error: 'Không giao phòng cho người đã ngưng hoạt động.', room_id: roomId }, 409);
      }
      await env.DB.prepare('UPDATE rooms SET owner_member_id = ? WHERE room_id = ?').bind(memberId, roomId).run();
      return jsonResponse({ success: true, room_id: roomId, owner_member_id: memberId });
    }

    return jsonResponse({ error: 'Endpoint không tồn tại' }, 404);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Lỗi máy chủ' }, 500);
  }
}
