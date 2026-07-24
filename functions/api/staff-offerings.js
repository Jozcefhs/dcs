import { requireFirestoreEnv } from '../lib/firestore.js';
import { handleChurchOfferingAction } from '../lib/church-offerings.js';
import { requireStaffSession } from '../lib/staff-auth.js';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('offerings')) {
      const error = new Error('This staff account is not allowed to access church offerings.');
      error.status = 403;
      throw error;
    }
    const body = await request.json().catch(() => ({}));
    return Response.json(await handleChurchOfferingAction(env, user, body), {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
