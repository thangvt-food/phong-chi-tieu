#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { firestoreDocumentId, firestoreEncodeFieldsForMigration } from '../functions/_lib/firestore.js';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ant05-efa02';
const DATABASE = process.env.D1_DATABASE || 'phong_chi_tieu_db';
const API_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TABLES = [
  ['rooms', ['room_id']],
  ['settings', ['room_id', 'key']],
  ['members', ['id']],
  ['periods', ['room_id', 'id']],
  ['expenses', ['id']],
  ['member_shares', ['room_id', 'period_id', 'member_id']],
  ['invites', ['token_hash']],
  ['sessions', ['token_hash']],
  ['users', ['id']],
  ['user_sessions', ['token_hash']],
  ['memberships', ['room_id', 'member_id']],
  ['auth_throttle', ['key']],
  ['join_requests', ['id']],
  ['schema_meta', ['version']],
];

const apply = process.argv.includes('--apply');
const resume = process.argv.includes('--resume');
const unknownArgs = process.argv.slice(2).filter((arg) => !['--apply', '--resume'].includes(arg));
if (unknownArgs.length) {
  throw new Error(`Đối số không hợp lệ: ${unknownArgs.join(' ')}`);
}
if (resume && !apply) {
  throw new Error('--resume chỉ dùng cùng --apply.');
}

function getAccessToken() {
  return execFileSync('gcloud', ['auth', 'print-access-token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

async function firestoreRequest(token, path, body) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      result?.error?.message || `Firestore trả HTTP ${response.status}.`
    );
  }
  return result;
}

function getD1Rows(table) {
  const output = execFileSync('npx', [
    'wrangler',
    'd1',
    'execute',
    DATABASE,
    '--remote',
    '--json',
    '--command',
    `SELECT * FROM "${table}"`,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 32 * 1024 * 1024,
  });
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`Không phân tích được kết quả D1 của bảng ${table}.`);
  }
  const response = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!response?.success || !Array.isArray(response.results)) {
    throw new Error(`Không đọc được bảng D1 ${table}.`);
  }
  return response.results;
}

function keyForRow(keys, row) {
  const parts = keys.map((field) => row[field]);
  return parts.length === 1 ? parts[0] : parts;
}

function documentWrite(table, keys, row) {
  const key = keyForRow(keys, row);
  const documentId = firestoreDocumentId(table, key);
  const record = { ...row, _table: table };
  return {
    update: {
      name: `projects/${PROJECT_ID}/databases/(default)/documents/phongthuchi/${documentId}`,
      fields: firestoreEncodeFieldsForMigration(record),
    },
  };
}

async function listRootCollections(token) {
  const result = await firestoreRequest(token, ':listCollectionIds', { pageSize: 1000 });
  return result.collectionIds || [];
}

async function verifyTableCount(token, table, expected) {
  const result = await firestoreRequest(token, ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'phongthuchi' }],
      where: {
        fieldFilter: {
          field: { fieldPath: '_table' },
          op: 'EQUAL',
          value: { stringValue: table },
        },
      },
    },
  });
  if (!Array.isArray(result)) throw new Error(`Không xác minh được bảng ${table} trong Firestore.`);
  const actual = result.filter((entry) => entry.document).length;
  if (actual !== expected) {
    throw new Error(`Sai số bản ghi ${table}: D1=${expected}, Firestore=${actual}.`);
  }
}

async function main() {
  const token = getAccessToken();
  const collections = await listRootCollections(token);
  if (collections.includes('phongthuchi') && !resume) {
    throw new Error(
      'Collection phongthuchi đã tồn tại. Không ghi đè; dùng --resume chỉ khi đang tiếp tục migration chưa hoàn tất.'
    );
  }

  const data = [];
  for (const [table, keys] of TABLES) {
    const rows = getD1Rows(table);
    data.push({ table, keys, rows });
    console.log(`${table}: ${rows.length} bản ghi`);
  }

  if (!apply) {
    console.log('\nDry run: chưa ghi dữ liệu. Kiểm tra xong, chạy lại với --apply.');
    return;
  }

  let writes = [];
  for (const { table, keys, rows } of data) {
    for (const row of rows) {
      writes.push(documentWrite(table, keys, row));
      if (writes.length === 450) {
        await firestoreRequest(token, ':commit', { writes });
        writes = [];
      }
    }
  }
  if (writes.length) await firestoreRequest(token, ':commit', { writes });

  for (const { table, rows } of data) {
    await verifyTableCount(token, table, rows.length);
  }
  console.log('\nĐã sao chép và xác minh số lượng bản ghi. D1 production không bị thay đổi.');
}

main().catch((error) => {
  console.error(`Migration thất bại: ${error.message}`);
  process.exitCode = 1;
});
