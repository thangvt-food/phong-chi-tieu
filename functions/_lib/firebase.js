const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const MAX_TOKEN_AGE_SECONDS = 60 * 60;

let cachedJwks = null;
let cachedJwksExpiresAt = 0;

export class FirebaseKeyFetchError extends Error {}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
}

async function loadJwks() {
  if (cachedJwks && cachedJwksExpiresAt > Date.now()) return cachedJwks;

  let response;
  try {
    response = await fetch(JWKS_URL);
  } catch {
    throw new FirebaseKeyFetchError('Không kết nối được dịch vụ xác minh Google.');
  }
  if (!response.ok) throw new FirebaseKeyFetchError('Không tải được khóa xác minh Google.');
  let jwks;
  try {
    jwks = await response.json();
  } catch {
    throw new FirebaseKeyFetchError('Google trả về phản hồi khóa xác minh không hợp lệ.');
  }
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new FirebaseKeyFetchError('Google trả về bộ khóa xác minh không hợp lệ.');
  }

  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(/max-age=(\d+)/i.exec(cacheControl)?.[1]) || 3600;
  cachedJwks = jwks;
  cachedJwksExpiresAt = Date.now() + maxAge * 1000;
  return jwks;
}

export async function verifyFirebaseIdToken(idToken, projectId) {
  if (!projectId) throw new Error('Thiếu cấu hình FIREBASE_PROJECT_ID.');
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Google ID token không hợp lệ.');

  let header;
  let claims;
  try {
    header = decodeJsonSegment(parts[0]);
    claims = decodeJsonSegment(parts[1]);
  } catch {
    throw new Error('Google ID token không hợp lệ.');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Thuật toán Google ID token không hợp lệ.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    claims.aud !== projectId
    || claims.iss !== `https://securetoken.google.com/${projectId}`
    || typeof claims.sub !== 'string'
    || claims.sub.length < 1
    || claims.sub.length > 128
    || !Number.isFinite(claims.exp)
    || claims.exp <= now
    || !Number.isFinite(claims.iat)
    || claims.iat > now + 60
    || claims.iat < now - MAX_TOKEN_AGE_SECONDS
    || claims.email_verified !== true
    || typeof claims.email !== 'string'
    || !claims.email
    || claims.firebase?.sign_in_provider !== 'google.com'
  ) {
    throw new Error('Google ID token hết hạn hoặc không thuộc tài khoản Google hợp lệ.');
  }

  const jwks = await loadJwks();
  const jwk = jwks.keys.find((key) => key.kid === header.kid && key.alg === 'RS256');
  if (!jwk) throw new Error('Không tìm thấy khóa ký Google ID token.');

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error('Chữ ký Google ID token không hợp lệ.');

  return {
    uid: claims.sub,
    email: claims.email.trim().toLowerCase(),
    displayName: String(claims.name || claims.email).trim().slice(0, 60),
  };
}
