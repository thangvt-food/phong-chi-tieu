// Cloudflare Pages Functions - Catch-all API Route for /api/*
const DEFAULT_PIN_HASH = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'; // "123456"

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-hash',
    },
  });
}

async function verifyAdmin(env, providedHash) {
  if (!providedHash) return false;
  if (!env.DB) {
    return providedHash === DEFAULT_PIN_HASH;
  }
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_pin_hash'").first();
    const storedHash = row ? row.value : DEFAULT_PIN_HASH;
    return providedHash.toLowerCase() === storedHash.toLowerCase();
  } catch (err) {
    return providedHash === DEFAULT_PIN_HASH;
  }
}

// Ensure schema migration for new columns.
// NOTE: Không dùng PRAGMA (D1 thật không hỗ trợ đầy đủ) — cứ ALTER TABLE,
// cột nào có rồi thì D1 báo lỗi "duplicate column" và ta bỏ qua.
let isMigrated = false;
async function ensureMigration(db) {
  if (isMigrated || !db) return;
  const alters = [
    'ALTER TABLE expenses ADD COLUMN expense_date TEXT',
    'ALTER TABLE expenses ADD COLUMN target_member_id TEXT',
    'ALTER TABLE expenses ADD COLUMN quantity INTEGER',
    'ALTER TABLE expenses ADD COLUMN unit_price INTEGER',
    'ALTER TABLE expenses ADD COLUMN split_config TEXT',
    'ALTER TABLE member_shares ADD COLUMN paid_amount INTEGER DEFAULT 0',
  ];
  for (const sql of alters) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      const msg = String(e?.message || e);
      if (!/duplicate column/i.test(msg)) {
        console.error('Migration error:', sql, msg);
      }
    }
  }
  isMigrated = true;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  const method = request.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-hash',
      },
    });
  }

  // If D1 is not bound, notify client
  const hasD1 = !!env.DB;
  if (hasD1) {
    await ensureMigration(env.DB);
  }

  try {
    // 1. GET /api/data - Load all public data
    if (path === 'data' && method === 'GET') {
      if (!hasD1) {
        return jsonResponse({
          hasD1: false,
          message: 'D1 chưa được cấu hình. Sử dụng chế độ LocalStorage.',
        });
      }

      // Fetch all tables
      const [settingsRes, membersRes, periodsRes, expensesRes, sharesRes] = await Promise.all([
        env.DB.prepare('SELECT key, value FROM settings').all(),
        env.DB.prepare('SELECT * FROM members ORDER BY created_at ASC').all(),
        env.DB.prepare('SELECT * FROM periods ORDER BY id DESC').all(),
        env.DB.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC').all(),
        env.DB.prepare('SELECT * FROM member_shares').all(),
      ]);

      const settings = {};
      (settingsRes.results || []).forEach((row) => {
        if (row.key !== 'admin_pin_hash') {
          settings[row.key] = row.value;
        }
      });

      return jsonResponse({
        hasD1: true,
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
      const isValid = await verifyAdmin(env, body.pin_hash);
      return jsonResponse({ valid: isValid });
    }

    // For all other admin routes, verify admin hash
    const adminHash = request.headers.get('x-admin-hash') || request.headers.get('authorization')?.replace('Bearer ', '');
    const isAuthed = await verifyAdmin(env, adminHash);
    if (!isAuthed) {
      return jsonResponse({ error: 'Mã xác thực Admin không hợp lệ hoặc hết hạn!' }, 401);
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
              'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
            ).bind(k, String(v))
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
      await env.DB.prepare(`
        INSERT INTO members (id, name, nickname, phone, is_active)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          nickname = excluded.nickname,
          phone = excluded.phone,
          is_active = excluded.is_active
      `).bind(id, m.name, m.nickname || '', m.phone || '', m.is_active ?? 1).run();

      return jsonResponse({ success: true, id });
    }

    // 5. DELETE /api/admin/members - Delete member
    if (path.startsWith('admin/members/') && method === 'DELETE') {
      const id = path.split('/')[2];
      await env.DB.batch([
        env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id),
        env.DB.prepare('DELETE FROM member_shares WHERE member_id = ?').bind(id),
        env.DB.prepare('UPDATE expenses SET target_member_id = NULL WHERE target_member_id = ?').bind(id),
      ]);
      return jsonResponse({ success: true });
    }

    // 6. POST /api/admin/periods - Add or update period
    if (path === 'admin/periods' && method === 'POST') {
      const p = await request.json();
      const id = p.id || 'period_' + Date.now();
      await env.DB.prepare(`
        INSERT INTO periods (id, title, due_date, status)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          due_date = excluded.due_date,
          status = excluded.status
      `).bind(id, p.title, p.due_date || '', p.status || 'open').run();

      return jsonResponse({ success: true, id });
    }

    // 7. DELETE /api/admin/periods - Delete period
    if (path.startsWith('admin/periods/') && method === 'DELETE') {
      const id = path.split('/')[2];
      await env.DB.batch([
        env.DB.prepare('DELETE FROM periods WHERE id = ?').bind(id),
        env.DB.prepare('DELETE FROM expenses WHERE period_id = ?').bind(id),
        env.DB.prepare('DELETE FROM member_shares WHERE period_id = ?').bind(id),
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
          "INSERT OR IGNORE INTO periods (id, title, due_date, status) VALUES (?, ?, '', 'open')"
        ).bind(periodId, periodTitle).run();
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
        await env.DB.prepare(`
          INSERT INTO expenses (id, period_id, category, title, amount, note, expense_date, target_member_id, quantity, unit_price, split_config)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
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
        `).bind(
          id,
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
      await env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id).run();
      return jsonResponse({ success: true });
    }

    // 10. POST /api/admin/toggle-share-paid - Quick toggle payment status
    // Body: { period_id, member_id, is_paid, paid_amount? }
    // - paid_amount: số tiền thực tế đã trả (hỗ trợ trả góp từng phần).
    //   Nếu không gửi, giữ nguyên giá trị cũ (tương thích bản trước).
    if (path === 'admin/toggle-share-paid' && method === 'POST') {
      const { period_id, member_id, is_paid, paid_amount } = await request.json();
      const id = `${period_id}_${member_id}`;
      const paidAt = is_paid ? new Date().toISOString() : null;
      if (paid_amount === undefined || paid_amount === null) {
        await env.DB.prepare(`
          INSERT INTO member_shares (id, period_id, member_id, amount, is_paid, paid_at, note)
          VALUES (?, ?, ?, 0, ?, ?, '')
          ON CONFLICT(id) DO UPDATE SET
            is_paid = excluded.is_paid,
            paid_at = excluded.paid_at
        `).bind(id, period_id, member_id, is_paid ? 1 : 0, paidAt).run();
      } else {
        const paidInt = Math.max(0, parseInt(paid_amount) || 0);
        await env.DB.prepare(`
          INSERT INTO member_shares (id, period_id, member_id, amount, is_paid, paid_at, note, paid_amount)
          VALUES (?, ?, ?, 0, ?, ?, '', ?)
          ON CONFLICT(id) DO UPDATE SET
            is_paid = excluded.is_paid,
            paid_at = excluded.paid_at,
            paid_amount = excluded.paid_amount
        `).bind(id, period_id, member_id, is_paid ? 1 : 0, paidAt, paidInt).run();
      }

      return jsonResponse({ success: true, is_paid, paid_at: paidAt });
    }

    return jsonResponse({ error: 'Endpoint không tồn tại' }, 404);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Lỗi máy chủ' }, 500);
  }
}
