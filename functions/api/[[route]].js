import { FirebaseKeyFetchError, verifyFirebaseIdToken } from '../_lib/firebase.js';
import { createFirestoreStore, firestoreDocumentId } from '../_lib/firestore.js';

const DEFAULT_ROOM = 'phong-2a';
const ROOM_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const PIN_RE = /^\d{6,12}$/;
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{40,}$/;
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
  'join_approval',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

function resolveRoomId(url, body) {
  const raw = url.searchParams.get('p') || (body && body.room_id);
  if (raw === null || raw === undefined || raw === '') return { roomId: DEFAULT_ROOM };
  const value = String(raw);
  if (!ROOM_SLUG_RE.test(value)) return { error: 'Mã phòng không hợp lệ.' };
  return { roomId: value };
}

function b64url(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function newToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${b64url(crypto.getRandomValues(new Uint8Array(4)))}`;
}

function isoAfter(milliseconds) {
  return new Date(Date.now() + milliseconds).toISOString();
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function timingSafeEqualStr(a, b) {
  return timingSafeEqual(
    new TextEncoder().encode(String(a)),
    new TextEncoder().encode(String(b))
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeRole(role) {
  return INVITE_ROLES.includes(role) ? role : 'member';
}

function rowKey(table, row) {
  switch (table) {
    case 'rooms': return row.room_id;
    case 'settings': return [row.room_id, row.key];
    case 'members': return row.id;
    case 'periods': return [row.room_id, row.id];
    case 'expenses': return row.id;
    case 'member_shares': return [row.room_id, row.period_id, row.member_id];
    case 'invites': return row.token_hash;
    case 'sessions': return row.token_hash;
    case 'users': return row.id;
    case 'user_sessions': return row.token_hash;
    case 'memberships': return [row.room_id, row.member_id];
    case 'auth_throttle': return row.key;
    case 'join_requests': return row.id;
    case 'activity_logs': return [row.room_id, row.id];
    case 'schema_meta': return row.version;
    default: throw new Error(`Loại dữ liệu Firestore không được hỗ trợ: ${table}.`);
  }
}

function writeRow(table, row) {
  return { table, key: rowKey(table, row), record: row };
}

function deleteRow(table, row) {
  return { delete: true, documentId: firestoreDocumentId(table, rowKey(table, row)) };
}

async function rowsFor(db, table, predicate = () => true) {
  return (await db.list(table)).filter(predicate);
}

async function writeRows(db, table, rows) {
  await db.commit(rows.map((row) => writeRow(table, row)));
}

async function deleteRows(db, table, rows) {
  await db.commit(rows.map((row) => deleteRow(table, row)));
}

async function createUserSession(db, userId) {
  const token = newToken();
  const expiresAt = isoAfter(SESSION_TTL_MS);
  const tokenHash = await sha256Hex(token);
  await db.set('user_sessions', tokenHash, {
    token_hash: tokenHash,
    user_id: userId,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    revoked_at: null,
    last_seen_at: null,
  });
  return { token, expires_at: expiresAt };
}

async function readUserSession(db, request) {
  const raw = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!raw) return null;
  const tokenHash = await sha256Hex(raw);
  const session = await db.get('user_sessions', tokenHash);
  if (!session) return { err: 'invalid' };
  if (session.revoked_at) return { err: 'revoked' };
  if (new Date(session.expires_at).getTime() <= Date.now()) return { err: 'expired' };
  const account = await db.get('users', session.user_id);
  if (!account) return { err: 'invalid' };
  if (!account.firebase_uid) return { err: 'google_required' };
  return {
    user: {
      id: account.id,
      username: account.username,
      display_name: account.display_name,
      email: account.email || '',
      firebase_uid: account.firebase_uid,
    },
    tokenHash,
  };
}

async function throttleCheck(db, key) {
  const row = await db.get('auth_throttle', key);
  if (!row?.locked_until) return { locked: false };
  const until = new Date(row.locked_until).getTime();
  if (until > Date.now()) {
    return { locked: true, retry_after_sec: Math.ceil((until - Date.now()) / 1000) };
  }
  await db.delete('auth_throttle', key);
  return { locked: false };
}

async function recordAuthFailure(db, key) {
  const current = await db.get('auth_throttle', key);
  const failures = (current?.failures || 0) + 1;
  const locked = failures >= THROTTLE_MAX;
  await db.set('auth_throttle', key, {
    key,
    failures: locked ? 0 : failures,
    locked_until: locked ? isoAfter(THROTTLE_LOCK_MS) : null,
  });
  return { failures, locked };
}

async function clearAuthFailures(db, key) {
  await db.delete('auth_throttle', key);
}

async function getOwnerMemberId(db, roomId) {
  return (await db.get('rooms', roomId))?.owner_member_id || null;
}

async function roomGate(db, user, roomId, minRole = 'viewer') {
  const room = await db.get('rooms', roomId);
  if (!room) {
    return { response: jsonResponse({ error: 'Phòng không tồn tại.', room_id: roomId }, 404) };
  }
  const membership = (await rowsFor(
    db,
    'memberships',
    (row) => row.room_id === roomId && row.user_id === user.id
  ))[0];
  if (!membership) {
    return {
      response: jsonResponse({ error: 'Bạn không phải thành viên của phòng này.', room_id: roomId }, 403),
    };
  }
  const member = await db.get('members', membership.member_id);
  if (!member || member.room_id !== roomId) {
    return {
      response: jsonResponse({ error: 'Hồ sơ thành viên của phòng không hợp lệ.', room_id: roomId }, 403),
    };
  }
  if (!member.is_active) {
    return {
      response: jsonResponse({
        error: 'Bạn đã bị ngưng khỏi phòng này.',
        room_id: roomId,
        inactive: true,
      }, 403),
    };
  }
  const isOwner = room.owner_member_id === member.id;
  const role = isOwner ? 'owner' : normalizeRole(membership.role);
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    return {
      response: jsonResponse({
        error: 'Bạn không đủ quyền cho thao tác này.',
        room_id: roomId,
        role,
      }, 403),
    };
  }
  return { user, room, member, role, isOwner };
}

async function loadMember(db, roomId, memberId) {
  const member = await db.get('members', memberId);
  return member?.room_id === roomId ? member : null;
}

async function memberRank(db, roomId, memberId, ownerId) {
  if (memberId === ownerId) return ROLE_RANK.owner;
  const membership = (await rowsFor(
    db,
    'memberships',
    (row) => row.room_id === roomId && row.member_id === memberId
  ))[0];
  return ROLE_RANK[normalizeRole(membership?.role)] || ROLE_RANK.viewer;
}

async function deactivateMember(db, roomId, memberId) {
  const member = await loadMember(db, roomId, memberId);
  const invites = await rowsFor(
    db,
    'invites',
    (row) => row.room_id === roomId && row.member_id === memberId
  );
  const requests = await rowsFor(
    db,
    'join_requests',
    (row) => row.room_id === roomId && row.member_id === memberId && row.status === 'pending'
  );
  const now = new Date().toISOString();
  await db.commit([
    ...(member ? [writeRow('members', { ...member, is_active: 0 })] : []),
    ...invites.map((row) => deleteRow('invites', row)),
    ...requests.map((row) => writeRow('join_requests', {
      ...row,
      status: 'rejected',
      reviewed_at: now,
    })),
  ]);
}

async function checkRemovable(db, roomId, memberId) {
  const ownerId = await getOwnerMemberId(db, roomId);
  if (memberId && ownerId && memberId === ownerId) {
    return 'Chủ phòng không rời/xóa được khi chưa giao phòng lại cho người khác.';
  }
  const members = await rowsFor(db, 'members', (row) => row.room_id === roomId);
  const activeCount = members.filter((row) => row.is_active).length;
  const target = members.find((row) => row.id === memberId);
  if (target?.is_active && activeCount <= 1) {
    return 'Phòng cần còn ít nhất một thành viên đang hoạt động.';
  }
  return null;
}

async function findInviteByToken(db, token) {
  const tokenHash = await sha256Hex(token);
  const invite = await db.get('invites', tokenHash);
  if (!invite) return null;
  const [member, room, setting] = await Promise.all([
    loadMember(db, invite.room_id, invite.member_id),
    db.get('rooms', invite.room_id),
    db.get('settings', [invite.room_id, 'join_approval']),
  ]);
  return {
    ...invite,
    member_name: member?.name || '',
    is_active: member?.is_active || 0,
    room_name: room?.name || invite.room_id,
    join_approval: setting?.value ?? '1',
  };
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
  if (body.role && body.role !== 'member') {
    return jsonResponse({
      error: 'Link mời chỉ cấp quyền member; chủ phòng có thể đổi quyền sau khi tham gia.',
    }, 400);
  }
  const member = await loadMember(db, roomId, memberId);
  if (!member) {
    return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
  }
  if (!member.is_active) {
    return jsonResponse({ error: 'Thành viên đã ngưng hoạt động, hãy thêm lại rồi mới mời.' }, 409);
  }
  if (memberId === await getOwnerMemberId(db, roomId)) {
    return jsonResponse({ error: 'Chủ phòng nhận quyền bằng mã khôi phục, không dùng link mời.' }, 409);
  }
  const memberships = await rowsFor(
    db,
    'memberships',
    (row) => row.room_id === roomId && row.member_id === memberId
  );
  if (memberships.length) {
    return jsonResponse({ error: 'Thành viên này đã có tài khoản, không cần link nữa.' }, 409);
  }

  const token = newToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = isoAfter(ttlMin * 60 * 1000);
  const oldInvites = await rowsFor(
    db,
    'invites',
    (row) => row.room_id === roomId && row.member_id === memberId
  );
  await db.commit([
    ...oldInvites.map((row) => deleteRow('invites', row)),
    writeRow('invites', {
      token_hash: tokenHash,
      room_id: roomId,
      member_id: memberId,
      role: 'member',
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      uses_left: 1,
    }),
  ]);
  return jsonResponse({
    success: true,
    room_id: roomId,
    member_id: memberId,
    member_name: member.name,
    role: 'member',
    token,
    expires_at: expiresAt,
  });
}

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

async function uniqueSlug(db, base) {
  const existing = new Set((await db.list('rooms')).map((room) => room.room_id));
  for (let index = 1; index < 50; index += 1) {
    const slug = index === 1 ? base : `${base.slice(0, 24)}-${index}`;
    if (!existing.has(slug)) return slug;
  }
  return null;
}

const GENERIC_ROOM_TOKENS = ['phong', 'tro', 'nha', 'nhatro', 'phongtro'];
function deriveTransferCode(slug) {
  const tokens = String(slug || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const meaningful = tokens.filter((token) => !GENERIC_ROOM_TOKENS.includes(token));
  return (meaningful.length ? meaningful : tokens).join('').toUpperCase().slice(0, 6);
}

async function authMeResponse(db, user) {
  const memberships = await rowsFor(
    db,
    'memberships',
    (row) => row.user_id === user.id
  );
  const rooms = [];
  for (const membership of memberships) {
    const [member, room] = await Promise.all([
      loadMember(db, membership.room_id, membership.member_id),
      db.get('rooms', membership.room_id),
    ]);
    if (!member?.is_active || !room) continue;
    rooms.push({
      room_id: membership.room_id,
      room_name: room.name || membership.room_id,
      member_id: membership.member_id,
      member_name: member.name,
      role: room.owner_member_id === member.id ? 'owner' : normalizeRole(membership.role),
      created_at: membership.created_at || '',
    });
  }
  rooms.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const pendingRequests = await rowsFor(
    db,
    'join_requests',
    (row) => row.user_id === user.id
      && (row.status === 'pending'
        || (row.status === 'rejected' && new Date(row.reviewed_at || 0).getTime() >= cutoff))
  );
  const requests = [];
  for (const row of pendingRequests) {
    const [room, member] = await Promise.all([
      db.get('rooms', row.room_id),
      loadMember(db, row.room_id, row.member_id),
    ]);
    if (room && member) {
      requests.push({
        id: row.id,
        room_id: row.room_id,
        status: row.status,
        room_name: room.name,
        member_name: member.name,
        created_at: row.created_at,
      });
    }
  }
  requests.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email || '',
    },
    rooms,
    pending_requests: requests.slice(0, 20),
  };
}

async function dataForRoom(db, gate, roomId) {
  const [settingsRows, membersRows, membershipRows, periods, expenses, shares, rawLogs] = await Promise.all([
    rowsFor(db, 'settings', (row) => row.room_id === roomId),
    rowsFor(db, 'members', (row) => row.room_id === roomId),
    rowsFor(db, 'memberships', (row) => row.room_id === roomId),
    rowsFor(db, 'periods', (row) => row.room_id === roomId),
    rowsFor(db, 'expenses', (row) => row.room_id === roomId),
    rowsFor(db, 'member_shares', (row) => row.room_id === roomId),
    rowsFor(db, 'activity_logs', (row) => row.room_id === roomId),
  ]);
  const settings = {};
  for (const row of settingsRows) {
    if (row.key !== 'admin_pin_hash') settings[row.key] = row.value;
  }
  const membershipByMember = new Map(membershipRows.map((row) => [row.member_id, row]));
  const canSeePhone = ROLE_RANK[gate.role] >= ROLE_RANK.manager;
  const members = membersRows
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((member) => {
      const membership = membershipByMember.get(member.id);
      return {
        id: member.id,
        name: member.name,
        nickname: member.nickname,
        phone: canSeePhone || member.id === gate.member.id ? member.phone : null,
        is_active: member.is_active,
        created_at: member.created_at,
        role: member.id === gate.room.owner_member_id ? 'owner' : (membership?.role || null),
        has_account: !!membership?.user_id,
      };
    });
  periods.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  expenses.sort((a, b) =>
    String(b.expense_date || '').localeCompare(String(a.expense_date || ''))
      || String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  const activityLogs = (rawLogs || []).sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  ).slice(0, 50);

  return {
    hasFirestore: true,
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
    periods,
    expenses,
    member_shares: shares,
    activity_logs: activityLogs,
  };
}

async function logActivity(db, roomId, userName, action, content) {
  try {
    const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.set('activity_logs', [roomId, id], {
      id,
      room_id: roomId,
      user_name: userName || 'Hệ thống',
      action,
      content,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write activity log', err);
  }
}

async function upsertShare(db, roomId, periodId, memberId, isPaid, paidAt, paidAmount) {
  const key = [roomId, periodId, memberId];
  const existing = await db.get('member_shares', key);
  await db.set('member_shares', key, {
    room_id: roomId,
    period_id: periodId,
    member_id: memberId,
    amount: existing?.amount || 0,
    is_paid: isPaid ? 1 : 0,
    paid_at: paidAt,
    paid_amount: paidAmount === null ? (existing?.paid_amount || 0) : paidAmount,
    note: existing?.note || '',
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }
  if (!env.FIREBASE_PROJECT_ID) {
    return jsonResponse({ error: 'Thiếu cấu hình FIREBASE_PROJECT_ID trên Cloudflare Pages.' }, 503);
  }
  if (!env.FIRESTORE_SERVICE_ACCOUNT) {
    return jsonResponse({ error: 'Firestore chưa được cấu hình trên Cloudflare Pages.' }, 503);
  }

  const db = createFirestoreStore(env);
  try {
    const schema = await db.get('schema_meta', 5);
    if (!schema) {
      return jsonResponse({
        error: 'Firestore chưa có dữ liệu schema version 5. Hãy hoàn tất sao chép D1 vào collection phongthuchi trước khi dùng.',
      }, 503);
    }

    // ================= Không cần phiên =================

    if (path === 'auth/google' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      let identity;
      try {
        identity = await verifyFirebaseIdToken(body.id_token, env.FIREBASE_PROJECT_ID);
      } catch (error) {
        if (error instanceof FirebaseKeyFetchError) {
          return jsonResponse({ error: 'Dịch vụ xác minh Google tạm thời không khả dụng. Hãy thử lại.' }, 503);
        }
        return jsonResponse({ error: 'Không xác thực được tài khoản Google. Hãy đăng nhập lại.' }, 401);
      }

      const usersList = await db.list('users');
      let account = usersList.find((row) => row.firebase_uid === identity.uid)
        || (identity.email ? usersList.find((row) => row.email === identity.email) : null);

      if (!account) {
        account = {
          id: randomId('usr'),
          username: `google-${(await sha256Hex(identity.uid)).slice(0, 24)}`,
          display_name: identity.displayName || identity.email,
          password_hash: 'google-auth-only',
          firebase_uid: identity.uid,
          email: identity.email,
          created_at: new Date().toISOString(),
        };
        await db.set('users', account.id, account);
      } else {
        const updates = {};
        if (account.firebase_uid !== identity.uid) updates.firebase_uid = identity.uid;
        if (identity.email && account.email !== identity.email) updates.email = identity.email;
        if (identity.displayName && !account.display_name) updates.display_name = identity.displayName;
        if (Object.keys(updates).length > 0) {
          account = { ...account, ...updates };
          await db.set('users', account.id, account);
        }
      }
      const session = await createUserSession(db, account.id);
      return jsonResponse({
        success: true,
        token: session.token,
        expires_at: session.expires_at,
        user: {
          id: account.id,
          username: account.username,
          display_name: account.display_name,
          email: account.email,
        },
      });
    }

    if (
      method === 'POST'
      && ['auth/register', 'auth/login', 'auth/change-password'].includes(path)
    ) {
      return jsonResponse({
        error: 'Đăng nhập và tạo tài khoản bằng Google; việc đổi mật khẩu thực hiện trong tài khoản Google.',
      }, 410);
    }

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
        requires_approval: invite.join_approval !== '0',
      });
    }

    if (path === 'rooms/recover-owner' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const roomResolve = resolveRoomId(url, body);
      if (roomResolve.error) return jsonResponse({ error: roomResolve.error }, 400);
      const roomId = roomResolve.roomId;
      const room = await db.get('rooms', roomId);
      if (!room) return jsonResponse({ error: 'Phòng không tồn tại.', room_id: roomId }, 404);

      const pin = String(body.pin || '');
      const newPin = String(body.new_pin || '');
      const throttleKey = `pin:${roomId}`;
      const throttle = await throttleCheck(db, throttleKey);
      if (throttle.locked) {
        return jsonResponse({
          error: 'Sai PIN quá nhiều lần. Thử lại sau ít phút.',
          retry_after_sec: throttle.retry_after_sec,
        }, 429);
      }
      const pinSetting = await db.get('settings', [roomId, 'admin_pin_hash']);
      if (!pinSetting?.value) {
        return jsonResponse({ error: 'Phòng chưa có mã khôi phục.', room_id: roomId }, 409);
      }
      if (!pin || /^[0-9a-f]{64}$/i.test(pin)) {
        await recordAuthFailure(db, throttleKey);
        await sleep(200);
        return jsonResponse({ error: 'Mã PIN không đúng.' }, 403);
      }
      if (!timingSafeEqualStr(
        await sha256Hex(pin),
        String(pinSetting.value).toLowerCase()
      )) {
        const failure = await recordAuthFailure(db, throttleKey);
        await sleep(200);
        return jsonResponse({ error: 'Mã PIN không đúng.', locked: failure.locked }, 403);
      }
      if (newPin && !PIN_RE.test(newPin)) {
        return jsonResponse({ error: 'Mã khôi phục mới cần 6–12 chữ số.' }, 400);
      }

      let ownerMemberId = room.owner_member_id;
      if (!ownerMemberId) {
        const activeMembers = await rowsFor(
          db,
          'members',
          (row) => row.room_id === roomId && row.is_active
        );
        activeMembers.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        ownerMemberId = activeMembers[0]?.id || null;
      }
      if (!ownerMemberId) {
        return jsonResponse({ error: 'Phòng chưa có thành viên đang hoạt động để nhận quyền chủ.' }, 409);
      }
      const current = await readUserSession(db, request);
      if (!current || current.err) {
        return jsonResponse({ error: 'Đăng nhập Google trước khi khôi phục chủ phòng.', needs_auth: true }, 401);
      }
      if (!current.user.firebase_uid) {
        return jsonResponse({ error: 'Khôi phục chủ phòng yêu cầu tài khoản Google.' }, 403);
      }

      const member = await loadMember(db, roomId, ownerMemberId);
      if (!member) return jsonResponse({ error: 'Hồ sơ chủ phòng không còn tồn tại.' }, 409);
      const memberships = await rowsFor(
        db,
        'memberships',
        (row) => row.room_id === roomId
          && (row.user_id === current.user.id || row.member_id === ownerMemberId)
      );
      const writes = [
        writeRow('rooms', { ...room, owner_member_id: ownerMemberId }),
        writeRow('members', { ...member, is_active: 1 }),
        ...memberships.map((row) => deleteRow('memberships', row)),
        writeRow('memberships', {
          room_id: roomId,
          member_id: ownerMemberId,
          user_id: current.user.id,
          role: 'manager',
          created_at: new Date().toISOString(),
        }),
      ];
      if (newPin) {
        writes.push(
          writeRow('settings', {
            room_id: roomId,
            key: 'admin_pin_hash',
            value: await sha256Hex(newPin),
          })
        );
      }
      await db.commit(writes);
      await clearAuthFailures(db, throttleKey);
      const session = await createUserSession(db, current.user.id);
      return jsonResponse({
        success: true,
        room_id: roomId,
        room_name: room.name,
        token: session.token,
        expires_at: session.expires_at,
        user: {
          id: current.user.id,
          username: current.user.username,
          display_name: current.user.display_name,
          email: current.user.email || '',
        },
        member_id: ownerMemberId,
        member_name: member.name,
        role: 'owner',
      });
    }

    // ================= Cần phiên tài khoản =================

    const session = await readUserSession(db, request);
    if (!session) return jsonResponse({ error: 'Chưa đăng nhập.', needs_auth: true }, 401);
    if (session.err) {
      return jsonResponse({
        error: 'Phiên đã hết hạn, đăng nhập lại.',
        needs_auth: true,
        reason: session.err,
      }, 401);
    }
    const user = session.user;

    if (path === 'auth/me' && method === 'GET') {
      return jsonResponse(await authMeResponse(db, user));
    }

    if (path === 'auth/logout' && method === 'POST') {
      const activeSession = await db.get('user_sessions', session.tokenHash);
      if (activeSession && !activeSession.revoked_at) {
        await db.set('user_sessions', session.tokenHash, {
          ...activeSession,
          revoked_at: new Date().toISOString(),
        });
      }
      return jsonResponse({ success: true });
    }

    if (path === 'rooms/search' && method === 'GET') {
      const query = (url.searchParams.get('q') || '').trim().toLowerCase();
      const allRooms = await db.list('rooms');
      const activeRooms = allRooms.filter((r) => r.is_active !== 0);

      // Lấy danh sách phòng người dùng đã tham gia
      const myMemberships = await rowsFor(
        db,
        'memberships',
        (row) => row.user_id === user.id
      );
      const joinedRoomIds = new Set(myMemberships.map((m) => m.room_id));

      const results = [];
      for (const room of activeRooms) {
        const roomName = room.name || room.room_id || '';
        const roomId = room.room_id;
        if (query && !roomName.toLowerCase().includes(query) && !roomId.toLowerCase().includes(query)) {
          continue;
        }

        // Lấy thông tin chủ phòng
        let ownerName = 'Chủ phòng';
        let ownerEmail = '';
        if (room.owner_member_id) {
          const ownerMember = await loadMember(db, roomId, room.owner_member_id);
          if (ownerMember) {
            ownerName = ownerMember.nickname || ownerMember.name || ownerName;
            // Tìm user của owner nếu có
            const ownerMembership = (await rowsFor(
              db,
              'memberships',
              (row) => row.room_id === roomId && row.member_id === room.owner_member_id
            ))[0];
            if (ownerMembership) {
              const ownerAccount = await db.get('users', ownerMembership.user_id);
              if (ownerAccount) {
                ownerEmail = ownerAccount.email || '';
                ownerName = ownerAccount.display_name || ownerName;
              }
            }
          }
        }

        results.push({
          room_id: roomId,
          room_name: roomName,
          owner_name: ownerName,
          owner_email: ownerEmail,
          is_joined: joinedRoomIds.has(roomId),
        });
        if (results.length >= 20) break;
      }
      return jsonResponse({ rooms: results });
    }

    if (path === 'rooms/request-join' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const targetRoomId = String(body.room_id || '').trim();
      const targetRoom = await db.get('rooms', targetRoomId);
      if (!targetRoom || targetRoom.is_active === 0) {
        return jsonResponse({ error: 'Phòng không tồn tại hoặc đã ngưng hoạt động.' }, 404);
      }

      // Kiểm tra xem đã là thành viên chưa
      const myMemberships = await rowsFor(
        db,
        'memberships',
        (row) => row.room_id === targetRoomId && row.user_id === user.id
      );
      if (myMemberships.length > 0) {
        return jsonResponse({ error: 'Bạn đã là thành viên của phòng này rồi.', room_id: targetRoomId }, 409);
      }

      // Kiểm tra có yêu cầu đang pending không
      const pending = await rowsFor(
        db,
        'join_requests',
        (row) => row.room_id === targetRoomId && row.user_id === user.id && row.status === 'pending'
      );
      if (pending.length > 0) {
        return jsonResponse({
          success: true,
          pending: true,
          room_id: targetRoomId,
          room_name: targetRoom.name,
          message: 'Bạn đã gửi yêu cầu gia nhập trước đó, vui lòng chờ chủ phòng duyệt.',
        });
      }

      // Tạo một member profile tạm cho user nếu chưa có
      const memberId = randomId('mem');
      const now = new Date().toISOString();
      await db.commit([
        writeRow('members', {
          id: memberId,
          room_id: targetRoomId,
          name: user.display_name || user.email || 'Thành viên mới',
          nickname: '',
          weight: 1,
          is_active: 1,
          created_at: now,
        }),
        writeRow('join_requests', {
          id: randomId('join'),
          room_id: targetRoomId,
          member_id: memberId,
          user_id: user.id,
          role: 'member',
          status: 'pending',
          created_at: now,
          reviewed_at: null,
        }),
      ]);

      return jsonResponse({
        success: true,
        pending: true,
        room_id: targetRoomId,
        room_name: targetRoom.name,
      });
    }

    if (path === 'invites/claim' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const token = String(body.token || '');
      if (!INVITE_TOKEN_RE.test(token)) {
        return jsonResponse({ error: 'Link mời không hợp lệ.' }, 400);
      }
      const tokenHash = await sha256Hex(token);
      const invite = await findInviteByToken(db, token);
      if (!inviteUsable(invite)) return jsonResponse({ error: 'Link mời không còn hiệu lực.' }, 410);
      if (!invite.is_active) return jsonResponse({ error: 'Thành viên này đã ngưng hoạt động.' }, 409);

      const roomMemberships = await rowsFor(
        db,
        'memberships',
        (row) => row.room_id === invite.room_id
      );
      if (roomMemberships.some((row) => row.member_id === invite.member_id)) {
        return jsonResponse({ error: 'Thành viên này đã có tài khoản rồi.' }, 409);
      }
      if (roomMemberships.some((row) => row.user_id === user.id)) {
        return jsonResponse({ error: 'Tài khoản đã là thành viên khác trong phòng này.' }, 409);
      }

      const role = normalizeRole(invite.role);
      const requiresApproval = invite.join_approval !== '0';
      if (requiresApproval) {
        const existing = await rowsFor(
          db,
          'join_requests',
          (row) => row.room_id === invite.room_id
            && row.member_id === invite.member_id
            && row.user_id === user.id
            && row.status === 'pending'
        );
        if (existing.length) {
          await db.delete('invites', tokenHash);
          return jsonResponse({
            success: true,
            pending: true,
            room_id: invite.room_id,
            room_name: invite.room_name || invite.room_id,
          });
        }
        await db.commit([
          writeRow('join_requests', {
            id: randomId('join'),
            room_id: invite.room_id,
            member_id: invite.member_id,
            user_id: user.id,
            role,
            status: 'pending',
            created_at: new Date().toISOString(),
            reviewed_at: null,
          }),
          deleteRow('invites', invite),
        ]);
        return jsonResponse({
          success: true,
          pending: true,
          room_id: invite.room_id,
          room_name: invite.room_name || invite.room_id,
        });
      }

      await db.commit([
        writeRow('memberships', {
          room_id: invite.room_id,
          member_id: invite.member_id,
          user_id: user.id,
          role,
          created_at: new Date().toISOString(),
        }),
        ...roomMemberships
          .filter((row) => row.member_id === invite.member_id)
          .map((row) => deleteRow('memberships', row)),
        deleteRow('invites', invite),
      ]);
      return jsonResponse({
        success: true,
        room_id: invite.room_id,
        room_name: invite.room_name || invite.room_id,
        member_id: invite.member_id,
        member_name: invite.member_name,
        role,
      });
    }

    if (path === 'rooms' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || '').trim().slice(0, 40);
      const pin = String(body.pin || '');
      if (name.length < 2) return jsonResponse({ error: 'Tên phòng cần ít nhất 2 ký tự.' }, 400);
      if (!PIN_RE.test(pin)) return jsonResponse({ error: 'Mã khôi phục cần 6–12 chữ số.' }, 400);
      const base = slugify(name);
      if (!base) return jsonResponse({ error: 'Tên phòng không tạo được mã slug.' }, 400);
      const roomId = await uniqueSlug(db, base);
      if (!roomId) return jsonResponse({ error: 'Quá nhiều phòng trùng tên, hãy đặt tên khác.' }, 409);

      const ownerName = String(body.owner_name || '').trim().slice(0, 60) || user.display_name;
      const ownerId = randomId('mem');
      const now = new Date().toISOString();
      const room = { room_id: roomId, name, owner_member_id: ownerId, created_at: now };
      const ownerMember = {
        id: ownerId,
        room_id: roomId,
        name: ownerName,
        nickname: ownerName.split(' ').pop(),
        phone: null,
        is_active: 1,
        created_at: now,
      };
      await db.commit([
        writeRow('rooms', room),
        writeRow('members', ownerMember),
        writeRow('memberships', {
          room_id: roomId,
          member_id: ownerId,
          user_id: user.id,
          role: 'manager',
          created_at: now,
        }),
        ...[
          ['room_name', name],
          ['admin_pin_hash', await sha256Hex(pin)],
          ['transfer_prefix', 'TIEN PHONG'],
          ['transfer_code', deriveTransferCode(roomId)],
          ['join_approval', '1'],
        ].map(([key, value]) => writeRow('settings', { room_id: roomId, key, value })),
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

    const roomResolve = resolveRoomId(url, null);
    if (roomResolve.error && path !== 'auth/me' && path !== 'auth/logout') {
      return jsonResponse({ error: roomResolve.error }, 400);
    }
    const roomId = roomResolve.roomId;

    if (path === 'data' && method === 'GET') {
      const gate = await roomGate(db, user, roomId, 'viewer');
      if (gate.response) return gate.response;
      return jsonResponse(await dataForRoom(db, gate, roomId));
    }

    if (path === 'member/toggle-share-paid' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'member');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const periodId = String(body.period_id || '');
      if (!/^\d{4}-\d{2}$/.test(periodId)) return jsonResponse({ error: 'Kỳ không hợp lệ.' }, 400);
      const isPaid = !!body.is_paid;
      const paidAt = isPaid ? new Date().toISOString() : null;
      const paidAmount = body.paid_amount === undefined || body.paid_amount === null
        ? null
        : Math.max(0, parseInt(body.paid_amount, 10) || 0);
      await upsertShare(db, roomId, periodId, gate.member.id, isPaid, paidAt, paidAmount);
      const actionName = isPaid ? 'đã thanh toán' : (paidAmount ? `đã thanh toán ${paidAmount.toLocaleString('vi-VN')} ₫` : 'đã hủy thanh toán');
      await logActivity(db, roomId, gate.member.nickname || gate.member.name, 'payment', `${gate.member.nickname || gate.member.name} ${actionName} kỳ ${periodId}`);
      return jsonResponse({
        success: true,
        member_id: gate.member.id,
        is_paid: isPaid,
        paid_at: paidAt,
      });
    }

    if (path === 'rooms/leave' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'viewer');
      if (gate.response) return gate.response;
      const blocked = await checkRemovable(db, roomId, gate.member.id);
      if (blocked) return jsonResponse({ error: blocked, room_id: roomId }, 409);
      await deactivateMember(db, roomId, gate.member.id);
      return jsonResponse({ success: true, room_id: roomId, member_id: gate.member.id, left: true });
    }

    if (path === 'admin/settings' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const writes = [];
      for (const key of SETTINGS_WRITE_KEYS) {
        if (body[key] === undefined || body[key] === null) continue;
        const existing = await db.get('settings', [roomId, key]);
        writes.push(writeRow('settings', {
          ...existing,
          room_id: roomId,
          key,
          value: String(body[key]),
        }));
      }
      if (body.room_name !== undefined) {
        const roomName = String(body.room_name).trim().slice(0, 40);
        if (roomName.length >= 2) {
          writes.push(writeRow('rooms', { ...gate.room, name: roomName }));
        }
      }
      await db.commit(writes);
      return jsonResponse({ success: true, message: 'Đã cập nhật cài đặt!' });
    }

    if (path === 'admin/pin' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const newPin = String(body.new_pin || '');
      if (!PIN_RE.test(newPin)) return jsonResponse({ error: 'Mã khôi phục cần 6–12 chữ số.' }, 400);
      await db.set('settings', [roomId, 'admin_pin_hash'], {
        room_id: roomId,
        key: 'admin_pin_hash',
        value: await sha256Hex(newPin),
      });
      return jsonResponse({ success: true });
    }

    if (path === 'admin/members' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || '').trim().slice(0, 60);
      const nickname = String(body.nickname || '').trim().slice(0, 40);
      const phone = String(body.phone || '').trim().slice(0, 20);
      if (body.id) {
        const id = String(body.id);
        const target = await loadMember(db, roomId, id);
        if (!target) return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
        if (name.length < 1) return jsonResponse({ error: 'Tên thành viên không được trống.' }, 400);
        await db.set('members', id, { ...target, name, nickname, phone });
        return jsonResponse({ success: true, id });
      }
      if (name.length < 2) return jsonResponse({ error: 'Tên thành viên cần ít nhất 2 ký tự.' }, 400);
      const id = randomId('mem');
      await db.set('members', id, {
        id,
        room_id: roomId,
        name,
        nickname,
        phone,
        is_active: 1,
        created_at: new Date().toISOString(),
      });
      return jsonResponse({ success: true, id });
    }

    const memberAction = /^admin\/members\/([^/]+)\/(deactivate|reactivate|role|unlink)$/.exec(path);
    if (memberAction && method === 'POST') {
      const [, targetId, action] = memberAction;
      const minRole = action === 'deactivate' || action === 'reactivate' ? 'manager' : 'owner';
      const gate = await roomGate(db, user, roomId, minRole);
      if (gate.response) return gate.response;
      const target = await loadMember(db, roomId, targetId);
      if (!target) return jsonResponse({ error: 'Thành viên không thuộc phòng này.', room_id: roomId }, 404);
      const targetRank = await memberRank(db, roomId, targetId, gate.room.owner_member_id);
      if (targetRank >= ROLE_RANK[gate.role]) {
        return jsonResponse({ error: 'Không thao tác được trên người ngang hoặc cao quyền hơn.' }, 403);
      }

      if (action === 'deactivate') {
        const blocked = await checkRemovable(db, roomId, targetId);
        if (blocked) return jsonResponse({ error: blocked, room_id: roomId }, 409);
        await deactivateMember(db, roomId, targetId);
        return jsonResponse({ success: true, member_id: targetId, is_active: 0 });
      }
      if (action === 'reactivate') {
        await db.set('members', targetId, { ...target, is_active: 1 });
        return jsonResponse({ success: true, member_id: targetId, is_active: 1 });
      }

      const memberships = await rowsFor(
        db,
        'memberships',
        (row) => row.room_id === roomId && row.member_id === targetId
      );
      if (action === 'role') {
        const body = await request.json().catch(() => ({}));
        const role = String(body.role || '');
        if (!INVITE_ROLES.includes(role)) return jsonResponse({ error: 'Quyền không hợp lệ.' }, 400);
        if (!memberships.length) {
          return jsonResponse({ error: 'Thành viên chưa có tài khoản, chưa đặt được quyền.' }, 409);
        }
        await writeRows(db, 'memberships', memberships.map((row) => ({ ...row, role })));
        return jsonResponse({ success: true, member_id: targetId, role });
      }
      const invites = await rowsFor(
        db,
        'invites',
        (row) => row.room_id === roomId && row.member_id === targetId
      );
      await db.commit([
        ...memberships.map((row) => deleteRow('memberships', row)),
        ...invites.map((row) => deleteRow('invites', row)),
      ]);
      return jsonResponse({ success: true, member_id: targetId, unlinked: memberships.length > 0 });
    }

    if (path === 'admin/periods' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const id = String(body.id || `period_${Date.now()}`);
      const key = [roomId, id];
      const existing = await db.get('periods', key);
      await db.set('periods', key, {
        ...existing,
        room_id: roomId,
        id,
        title: body.title,
        due_date: body.due_date || '',
        status: body.status || 'open',
        created_at: existing?.created_at || new Date().toISOString(),
      });
      return jsonResponse({ success: true, id });
    }

    if (path.startsWith('admin/periods/') && method === 'DELETE') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const id = path.split('/')[2];
      const [period, expenses, shares] = await Promise.all([
        db.get('periods', [roomId, id]),
        rowsFor(db, 'expenses', (row) => row.room_id === roomId && row.period_id === id),
        rowsFor(db, 'member_shares', (row) => row.room_id === roomId && row.period_id === id),
      ]);
      await db.commit([
        ...(period ? [deleteRow('periods', period)] : []),
        ...expenses.map((row) => deleteRow('expenses', row)),
        ...shares.map((row) => deleteRow('member_shares', row)),
      ]);
      return jsonResponse({ success: true });
    }

    if (path === 'admin/expenses' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const expense = await request.json().catch(() => ({}));
      const id = String(expense.id || `exp_${Date.now()}`);
      const dateStr = String(expense.expense_date || new Date().toISOString().split('T')[0]);
      const [year = '2026', month = '10'] = dateStr.split('-');
      const periodId = String(expense.period_id || `${year}-${month}`);
      const targetMemberId = expense.target_member_id ? String(expense.target_member_id) : null;
      if (targetMemberId && !await loadMember(db, roomId, targetMemberId)) {
        return jsonResponse({ error: 'Người nhận khoản không thuộc phòng này.' }, 400);
      }

      const [existingPeriod, existingExpense] = await Promise.all([
        db.get('periods', [roomId, periodId]),
        db.get('expenses', id),
      ]);
      if (existingExpense && existingExpense.room_id !== roomId) {
        return jsonResponse({ error: 'Khoản chi này thuộc phòng khác.', room_id: roomId }, 409);
      }
      const category = String(expense.category || 'khac');
      const title = String(expense.title || 'Khoản chi');
      const splitConfig = expense.split_config === undefined
        || expense.split_config === null
        || expense.split_config === ''
        ? null
        : (typeof expense.split_config === 'string'
          ? expense.split_config
          : JSON.stringify(expense.split_config));
      const record = {
        ...existingExpense,
        id,
        room_id: roomId,
        period_id: periodId,
        category,
        title,
        amount: parseInt(expense.amount, 10) || 0,
        note: String(expense.note || ''),
        expense_date: dateStr,
        target_member_id: targetMemberId,
        quantity: expense.quantity != null ? parseInt(expense.quantity, 10) : null,
        unit_price: expense.unit_price != null ? parseInt(expense.unit_price, 10) : null,
        split_config: splitConfig,
        created_at: existingExpense?.created_at || new Date().toISOString(),
      };
      await db.commit([
        ...(!existingPeriod ? [writeRow('periods', {
          room_id: roomId,
          id: periodId,
          title: `Tháng ${month}/${year}`,
          due_date: '',
          status: 'open',
          created_at: new Date().toISOString(),
        })] : []),
        writeRow('expenses', record),
      ]);
      const actorName = gate.member.nickname || gate.member.name;
      const act = existingExpense ? 'cập nhật khoản chi' : 'thêm khoản chi';
      await logActivity(db, roomId, actorName, 'expense', `${actorName} ${act} "${record.title}" (${(record.amount || 0).toLocaleString('vi-VN')} ₫)`);
      return jsonResponse({ success: true, id, period_id: periodId });
    }

    if (path.startsWith('admin/expenses/') && method === 'DELETE') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const id = path.split('/')[2];
      const expense = await db.get('expenses', id);
      if (expense?.room_id === roomId) {
        await db.delete('expenses', id);
        const actorName = gate.member.nickname || gate.member.name;
        await logActivity(db, roomId, actorName, 'expense_delete', `${actorName} đã xóa khoản chi "${expense.title}" (${(expense.amount || 0).toLocaleString('vi-VN')} ₫)`);
      }
      return jsonResponse({ success: true });
    }

    if (path === 'admin/toggle-share-paid' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const periodId = String(body.period_id || '');
      const memberId = String(body.member_id || '');
      if (!/^\d{4}-\d{2}$/.test(periodId)) return jsonResponse({ error: 'Kỳ không hợp lệ.' }, 400);
      if (!await loadMember(db, roomId, memberId)) {
        return jsonResponse({ error: 'Thành viên không thuộc phòng này.' }, 400);
      }
      const isPaid = !!body.is_paid;
      const paidAt = isPaid ? new Date().toISOString() : null;
      const paidAmount = body.paid_amount === undefined || body.paid_amount === null
        ? null
        : Math.max(0, parseInt(body.paid_amount, 10) || 0);
      await upsertShare(db, roomId, periodId, memberId, isPaid, paidAt, paidAmount);
      const targetMember = await loadMember(db, roomId, memberId);
      const targetName = targetMember ? (targetMember.nickname || targetMember.name) : 'thành viên';
      const actorName = gate.member.nickname || gate.member.name;
      const actionName = isPaid ? 'đánh dấu đã nộp đủ' : (paidAmount ? `ghi nhận thu ${paidAmount.toLocaleString('vi-VN')} ₫` : 'xóa/hủy thanh toán');
      await logActivity(db, roomId, actorName, 'payment', `${actorName} ${actionName} cho ${targetName} kỳ ${periodId}`);
      return jsonResponse({ success: true, is_paid: isPaid, paid_at: paidAt });
    }

    if (path === 'admin/join-requests' && method === 'GET') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const joinRequests = await rowsFor(
        db,
        'join_requests',
        (row) => row.room_id === roomId && row.status === 'pending'
      );
      const requests = [];
      for (const row of joinRequests) {
        const [member, account] = await Promise.all([
          loadMember(db, roomId, row.member_id),
          db.get('users', row.user_id),
        ]);
        if (member && account) {
          requests.push({
            id: row.id,
            member_id: row.member_id,
            user_id: row.user_id,
            role: row.role,
            created_at: row.created_at,
            member_name: member.name,
            display_name: account.display_name,
            email: account.email,
          });
        }
      }
      requests.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return jsonResponse({ requests });
    }

    const joinDecisionMatch = /^admin\/join-requests\/([^/]+)\/(approve|reject)$/.exec(path);
    if (joinDecisionMatch && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const [, requestId, decision] = joinDecisionMatch;
      const joinRequest = await db.get('join_requests', requestId);
      if (
        !joinRequest
        || joinRequest.room_id !== roomId
        || joinRequest.status !== 'pending'
      ) {
        return jsonResponse({ error: 'Yêu cầu không còn chờ duyệt.' }, 404);
      }
      const reviewedAt = new Date().toISOString();
      if (decision === 'reject') {
        await db.set('join_requests', requestId, {
          ...joinRequest,
          status: 'rejected',
          reviewed_at: reviewedAt,
        });
        return jsonResponse({ success: true, rejected: true });
      }
      const member = await loadMember(db, roomId, joinRequest.member_id);
      if (!member?.is_active) {
        return jsonResponse({ error: 'Thành viên đã ngưng hoạt động; không thể duyệt.' }, 409);
      }
      const roomMemberships = await rowsFor(
        db,
        'memberships',
        (row) => row.room_id === roomId
      );
      if (roomMemberships.some((row) =>
        row.member_id === joinRequest.member_id || row.user_id === joinRequest.user_id
      )) {
        return jsonResponse({
          error: 'Không thể duyệt: tài khoản hoặc thành viên đã được liên kết với hồ sơ khác trong phòng.',
        }, 409);
      }
      await db.commit([
        writeRow('memberships', {
          room_id: roomId,
          member_id: joinRequest.member_id,
          user_id: joinRequest.user_id,
          role: normalizeRole(joinRequest.role),
          created_at: reviewedAt,
        }),
        writeRow('join_requests', {
          ...joinRequest,
          status: 'approved',
          reviewed_at: reviewedAt,
        }),
      ]);
      return jsonResponse({ success: true, approved: true, member_id: joinRequest.member_id });
    }

    if (path === 'admin/invites' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'manager');
      if (gate.response) return gate.response;
      return mintInvite(db, roomId, gate, await request.json().catch(() => ({})));
    }

    if (path === 'admin/transfer-owner' && method === 'POST') {
      const gate = await roomGate(db, user, roomId, 'owner');
      if (gate.response) return gate.response;
      const body = await request.json().catch(() => ({}));
      const memberId = String(body.member_id || '');
      const target = await loadMember(db, roomId, memberId);
      if (!target) return jsonResponse({ error: 'Thành viên không thuộc phòng này.' }, 404);
      if (!target.is_active) {
        return jsonResponse({ error: 'Không giao phòng cho người đã ngưng hoạt động.' }, 409);
      }
      const memberships = await rowsFor(
        db,
        'memberships',
        (row) => row.room_id === roomId
      );
      const targetMembership = memberships.find((row) => row.member_id === memberId);
      if (!targetMembership) {
        return jsonResponse({
          error: 'Người này chưa có tài khoản nên không đăng nhập nhận phòng được. Gửi link mời trước.',
        }, 409);
      }
      const currentMembership = memberships.find((row) => row.member_id === gate.member.id);
      if (!currentMembership) return jsonResponse({ error: 'Không tìm thấy quyền chủ hiện tại.' }, 409);
      await db.commit([
        writeRow('rooms', { ...gate.room, owner_member_id: memberId }),
        writeRow('memberships', { ...currentMembership, role: 'manager' }),
      ]);
      return jsonResponse({ success: true, room_id: roomId, owner_member_id: memberId });
    }

    return jsonResponse({ error: 'Endpoint không tồn tại' }, 404);
  } catch (error) {
    console.error('Firestore-backed API failed', { path, message: error?.message });
    return jsonResponse({ error: error?.message || 'Lỗi máy chủ' }, 500);
  }
}
