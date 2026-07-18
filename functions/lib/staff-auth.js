import { listCollection } from './firestore.js';

const encoder = new TextEncoder();
const SESSION_COOKIE = 'school_staff_session';
const SESSION_SECONDS = 4 * 60 * 60;

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function base64Url(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToHex(value) {
  return Array.from(new Uint8Array(value)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secureEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function sessionSecret(env) {
  const secret = clean(env.STAFF_SESSION_SECRET || env.BACKEND_SHARED_SECRET || env.GOOGLE_APPS_SCRIPT_SECRET);
  if (!secret) {
    const err = new Error('Staff sessions are not configured. Add STAFF_SESSION_SECRET in Cloudflare.');
    err.status = 500;
    throw err;
  }
  return secret;
}

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode(sessionSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signPayload(env, payloadText) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payloadText));
  return base64Url(signature);
}

async function verifyDesktopPassword(user, password) {
  const salt = clean(user.Salt || user.salt);
  const expected = lower(user.PasswordHash || user.passwordHash);
  if (!salt || !expected || !password) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: encoder.encode(salt),
    iterations: Number(user.PasswordIterations || user.passwordIterations || 120000),
    hash: 'SHA-256'
  }, material, 256);
  return secureEqual(bytesToHex(bits), expected);
}

function inferDepartment(user) {
  return clean(user.Department || user.department || ({
    'Tuck Shop User': 'Tuck Shop',
    'Clinic User': 'Clinic',
    'Kitchen User': 'Kitchen'
  }[clean(user.Role || user.role)] || ''));
}

function publicUser(user) {
  return {
    username: clean(user.Username || user.username || user.__id),
    displayName: clean(user.DisplayName || user.displayName || user.Username || user.username || user.__id),
    role: clean(user.Role || user.role) || 'Front Desk',
    department: inferDepartment(user)
  };
}

export function allowedSectionsFor(user = {}) {
  const role = clean(user.role || user.Role);
  const department = lower(user.department || user.Department);
  const roleSections = {
    'Super Admin': ['admissions', 'formPurchases', 'students', 'accounts', 'clinic', 'kitchen', 'tuckShop'],
    'Admissions Officer': ['admissions', 'formPurchases', 'students'],
    'Accounts Officer': ['students', 'accounts', 'clinic', 'kitchen', 'tuckShop'],
    Management: ['admissions', 'formPurchases', 'students', 'accounts', 'clinic', 'kitchen', 'tuckShop'],
    'Tuck Shop User': ['tuckShop'],
    'Clinic User': ['clinic'],
    'Kitchen User': ['kitchen'],
    'Front Desk': ['admissions', 'formPurchases', 'students']
  };
  if (role === 'Department User') {
    if (department.includes('clinic')) return ['clinic'];
    if (department.includes('kitchen')) return ['kitchen'];
    if (department.includes('tuck')) return ['tuckShop'];
    if (department.includes('account') || department.includes('finance')) return ['accounts'];
    return [];
  }
  return roleSections[role] || [];
}

export async function authenticateStaff(env, username, password) {
  const wanted = lower(username);
  if (!wanted || !password) return null;
  let users = [];
  try {
    users = await listCollection(env, 'staffUsers');
  } catch (_err) {
    users = [];
  }
  const user = users.find((row) => lower(row.Username || row.username || row.__id) === wanted);
  if (user) {
    const active = user.Active === undefined ? true : !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active));
    if (!active || !(await verifyDesktopPassword(user, password))) return null;
    return publicUser(user);
  }

  const envUsername = lower(env.ADMIN_WEB_USERNAME || 'admin');
  const envPassword = clean(env.ADMIN_WEB_PASSWORD);
  if (wanted === envUsername && envPassword && secureEqual(password, envPassword)) {
    return {
      username: clean(env.ADMIN_WEB_USERNAME || 'admin'),
      displayName: clean(env.ADMIN_WEB_DISPLAY_NAME || 'Super Admin'),
      role: 'Super Admin',
      department: ''
    };
  }
  return null;
}

export async function createStaffSession(env, user) {
  const payload = {
    ...publicUser(user),
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${await signPayload(env, encoded)}`;
}

function cookieValue(request, name) {
  const cookies = String(request.headers.get('Cookie') || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) return cookie.slice(separator + 1).trim();
  }
  return '';
}

export async function readStaffSession(env, request) {
  const token = cookieValue(request, SESSION_COOKIE);
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const verified = await crypto.subtle.verify('HMAC', await hmacKey(env), fromBase64Url(signature), encoder.encode(encoded));
  if (!verified) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (!payload.exp || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    return publicUser(payload);
  } catch (_err) {
    return null;
  }
}

export async function requireStaffSession(env, request) {
  const user = await readStaffSession(env, request);
  if (!user) {
    const err = new Error('Your staff session has expired. Please sign in again.');
    err.status = 401;
    throw err;
  }
  return { ...user, allowedSections: allowedSectionsFor(user) };
}

export function staffSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearStaffSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
