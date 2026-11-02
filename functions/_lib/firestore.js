const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const COLLECTION = 'phongthuchi';

let tokenCache = null;

class FirestoreHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJsonBase64Url(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function privateKeyBytes(pem) {
  const contents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(contents);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function serviceAccessToken(env) {
  if (!env.FIRESTORE_SERVICE_ACCOUNT) {
    throw new Error('Thiếu secret FIRESTORE_SERVICE_ACCOUNT trên Cloudflare Pages.');
  }

  let serviceAccount;
  try {
    serviceAccount = typeof env.FIRESTORE_SERVICE_ACCOUNT === 'object' && env.FIRESTORE_SERVICE_ACCOUNT !== null
      ? env.FIRESTORE_SERVICE_ACCOUNT
      : JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT);
    if (typeof serviceAccount === 'string') {
      serviceAccount = JSON.parse(serviceAccount);
    }
  } catch {
    throw new Error('Secret FIRESTORE_SERVICE_ACCOUNT không phải JSON hợp lệ.');
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId || serviceAccount.project_id !== projectId) {
    throw new Error('Service account Firestore không khớp FIREBASE_PROJECT_ID.');
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Service account Firestore thiếu client_email hoặc private_key.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    tokenCache
    && tokenCache.clientEmail === serviceAccount.client_email
    && tokenCache.expiresAt > nowSeconds + 60
  ) {
    return tokenCache.accessToken;
  }

  const tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;
  const header = encodeJsonBase64Url({ alg: 'RS256', typ: 'JWT' });
  const claim = encodeJsonBase64Url({
    iss: serviceAccount.client_email,
    scope: FIRESTORE_SCOPE,
    aud: tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });
  const unsignedJwt = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedJwt)
  );
  const assertion = `${unsignedJwt}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const reason = body.error_description || body.error || `HTTP ${response.status}`;
    throw new Error(`Không lấy được access token Firestore: ${reason}.`);
  }
  tokenCache = {
    clientEmail: serviceAccount.client_email,
    accessToken: body.access_token,
    expiresAt: nowSeconds + Number(body.expires_in || 3600),
  };
  return body.access_token;
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFields(value) } };
  }
  return { stringValue: String(value) };
}

function encodeFields(record) {
  return Object.fromEntries(
    Object.entries(record).map(([field, value]) => [field, encodeValue(value)])
  );
}

function decodeValue(value) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [field, decodeValue(value)])
  );
}

export function firestoreDocumentId(table, key) {
  const serializedKey = Array.isArray(key) ? JSON.stringify(key) : String(key);
  return `${table}__${base64Url(new TextEncoder().encode(serializedKey))}`;
}

export function firestoreDocumentName(projectId, documentId) {
  return `projects/${projectId}/databases/(default)/documents/${COLLECTION}/${documentId}`;
}

async function firestoreRequest(env, path, { method = 'GET', body } = {}) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Thiếu cấu hình FIREBASE_PROJECT_ID.');
  const token = await serviceAccessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  let responseBody = {};
  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBody = {};
  }
  if (!response.ok) {
    const message = responseBody?.error?.message
      || responseText
      || `Firestore trả HTTP ${response.status}.`;
    throw new FirestoreHttpError(response.status, message);
  }
  return responseBody;
}

function recordFromDocument(document) {
  const row = decodeFields(document.fields || {});
  delete row._table;
  return row;
}

export function createFirestoreStore(env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const collectionPath = `/phongthuchi`;

  return {
    async get(table, key) {
      const documentId = firestoreDocumentId(table, key);
      try {
        const document = await firestoreRequest(
          env,
          `${collectionPath}/${encodeURIComponent(documentId)}`
        );
        return recordFromDocument(document);
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },

    async list(table) {
      const response = await firestoreRequest(env, ':runQuery', {
        method: 'POST',
        body: {
          structuredQuery: {
            from: [{ collectionId: COLLECTION }],
            where: {
              fieldFilter: {
                field: { fieldPath: '_table' },
                op: 'EQUAL',
                value: { stringValue: table },
              },
            },
          },
        },
      });
      if (!Array.isArray(response)) {
        throw new Error(`Firestore list trả dữ liệu không hợp lệ cho ${table}.`);
      }
      return response
        .filter((entry) => entry.document)
        .map((entry) => recordFromDocument(entry.document));
    },

    async commit(writes) {
      if (writes.length === 0) return;
      for (let offset = 0; offset < writes.length; offset += 450) {
        const batch = writes.slice(offset, offset + 450).map((write) => {
          if (write.delete) {
            return { delete: firestoreDocumentName(projectId, write.documentId) };
          }
          const record = { ...write.record, _table: write.table };
          return {
            update: {
              name: firestoreDocumentName(
                projectId,
                firestoreDocumentId(write.table, write.key)
              ),
              fields: encodeFields(record),
            },
          };
        });
        await firestoreRequest(env, ':commit', {
          method: 'POST',
          body: { writes: batch },
        });
      }
    },

    set(table, key, record) {
      return this.commit([{ table, key, record }]);
    },

    delete(table, key) {
      return this.commit([{
        delete: true,
        documentId: firestoreDocumentId(table, key),
      }]);
    },
  };
}

export function firestoreEncodeFieldsForMigration(record) {
  return encodeFields({ ...record, _table: record._table });
}
