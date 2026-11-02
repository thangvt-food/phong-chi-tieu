import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createFirestoreStore, firestoreDocumentId } from '../functions/_lib/firestore.js';

const PROJECT_ID = 'ant05-efa02';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const serviceAccount = JSON.stringify({
  project_id: PROJECT_ID,
  client_email: 'firestore-test@ant05-efa02.iam.gserviceaccount.com',
  private_key: privateKeyPem,
  token_uri: 'https://oauth2.googleapis.com/token',
});

test('Firestore store obtains a service token and reads/writes typed documents', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
    }
    if (url.endsWith('/documents:runQuery')) {
      return Response.json([{
        document: {
          name: `projects/${PROJECT_ID}/databases/(default)/documents/phongthuchi/${firestoreDocumentId('rooms', 'room-a')}`,
          fields: {
            _table: { stringValue: 'rooms' },
            room_id: { stringValue: 'room-a' },
            owner_member_id: { stringValue: 'member-a' },
            is_active: { integerValue: '1' },
          },
        },
      }]);
    }
    if (url.endsWith('/documents:commit')) return Response.json({ writeResults: [{}] });
    throw new Error(`Unexpected Firestore test request: ${url}`);
  };

  try {
    const store = createFirestoreStore({
      FIREBASE_PROJECT_ID: PROJECT_ID,
      FIRESTORE_SERVICE_ACCOUNT: serviceAccount,
    });
    const rooms = await store.list('rooms');
    assert.deepEqual(rooms, [{
      room_id: 'room-a',
      owner_member_id: 'member-a',
      is_active: 1,
    }]);

    await store.set('rooms', 'room-a', {
      room_id: 'room-a',
      name: 'Phòng A',
      is_active: 1,
    });
    const tokenRequest = requests.find((entry) => entry.url.endsWith('/token'));
    assert.ok(tokenRequest);
    assert.match(String(tokenRequest.init.body), /jwt-bearer/);
    const commit = requests.find((entry) => entry.url.endsWith('/documents:commit'));
    assert.ok(commit);
    assert.equal(commit.init.headers.Authorization, 'Bearer test-access-token');
    const payload = JSON.parse(commit.init.body);
    assert.equal(payload.writes[0].update.fields._table.stringValue, 'rooms');
    assert.equal(payload.writes[0].update.fields.name.stringValue, 'Phòng A');
    assert.equal(payload.writes[0].update.name.endsWith(firestoreDocumentId('rooms', 'room-a')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Firestore document IDs are stable and distinguish composite keys', () => {
  const first = firestoreDocumentId('settings', ['room-a', 'room_name']);
  assert.equal(first, firestoreDocumentId('settings', ['room-a', 'room_name']));
  assert.notEqual(first, firestoreDocumentId('settings', ['room', 'a__room_name']));
});
