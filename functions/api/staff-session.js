import {
  authenticateStaff,
  clearStaffSessionCookie,
  createStaffSession,
  readStaffSession,
  staffSessionCookie,
  allowedSectionsFor
} from '../lib/staff-auth.js';
import { requireFirestoreEnv } from '../lib/firestore.js';

function response(data, status = 200, cookie = '') {
  const headers = { 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(data, { status, headers });
}

export async function onRequestGet(context) {
  try {
    const user = await readStaffSession(context.env, context.request);
    return response({
      ok: true,
      authenticated: Boolean(user),
      user: user ? { ...user, allowedSections: allowedSectionsFor(user) } : null
    });
  } catch (err) {
    return response({ ok: false, authenticated: false, message: err.message || String(err) }, err.status || 500);
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || body.Action || 'login').trim().toLowerCase();
    if (action === 'logout') {
      return response({ ok: true, authenticated: false, message: 'Signed out.' }, 200, clearStaffSessionCookie());
    }
    requireFirestoreEnv(env);
    const user = await authenticateStaff(env, body.username, body.password);
    if (!user) return response({ ok: false, message: 'Invalid username/password or inactive account.' }, 401);
    const token = await createStaffSession(env, user);
    return response({
      ok: true,
      authenticated: true,
      message: 'Signed in.',
      user: { ...user, allowedSections: allowedSectionsFor(user) }
    }, 200, staffSessionCookie(token));
  } catch (err) {
    return response({ ok: false, message: err.message || String(err) }, err.status || 500);
  }
}
