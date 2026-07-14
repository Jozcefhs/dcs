import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeSchoolCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DCA';
}

function requireAdmin(env, password) {
  const expected = clean(env.ADMIN_WEB_PASSWORD);
  if (!expected) {
    const err = new Error('Setup login is not configured. Add ADMIN_WEB_PASSWORD in Cloudflare.');
    err.status = 500;
    throw err;
  }
  if (clean(password) !== expected) {
    const err = new Error('Invalid setup password.');
    err.status = 401;
    throw err;
  }
}

function defaultProfile(env) {
  return {
    SchoolName: clean(env.SCHOOL_NAME) || 'Integrated School Management Suite',
    SchoolCode: normalizeSchoolCode(env.SCHOOL_CODE),
    SchoolAddress: clean(env.SCHOOL_ADDRESS) || '',
    SchoolPhone: clean(env.SCHOOL_PHONE) || '',
    SchoolEmail: clean(env.SCHOOL_EMAIL) || '',
    SchoolSignatoryName: clean(env.SCHOOL_SIGNATORY_NAME) || '',
    SchoolSignatoryTitle: clean(env.SCHOOL_SIGNATORY_TITLE) || '',
    ResultSignatoryName: clean(env.RESULT_SIGNATORY_NAME) || '',
    ResultSignatoryTitle: clean(env.RESULT_SIGNATORY_TITLE) || '',
    OfferSignatoryName: clean(env.OFFER_SIGNATORY_NAME) || '',
    OfferSignatoryTitle: clean(env.OFFER_SIGNATORY_TITLE) || '',
    AdmissionSignatoryName: clean(env.ADMISSION_SIGNATORY_NAME) || '',
    AdmissionSignatoryTitle: clean(env.ADMISSION_SIGNATORY_TITLE) || '',
    EmailGreetingTemplate: clean(env.EMAIL_GREETING_TEMPLATE) || 'Dear Parent/Guardian,',
    PortalHeadline: clean(env.PORTAL_HEADLINE) || 'Admissions and parent services in one place',
    PortalSubheading: clean(env.PORTAL_SUBHEADING) || 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.',
    PortalNotice: clean(env.PORTAL_NOTICE) || '',
    ResultDisplayMode: clean(env.RESULT_DISPLAY_MODE) || 'subjects',
    ShowResultsOnline: clean(env.SHOW_RESULTS_ONLINE) || 'NO',
    ProductKeyMode: clean(env.PRODUCT_KEY_MODE) || 'off',
    UpdatedAt: ''
  };
}

async function getProfile(env) {
  let profile = defaultProfile(env);
  try {
    requireFirestoreEnv(env);
    const rows = await listCollection(env, 'settings');
    const saved = rows.find((row) => row.__id === 'schoolProfile') || rows.find((row) => clean(row.SchoolName));
    if (saved) {
      profile = { ...profile, ...saved };
    }
  } catch (_err) {
    // Public pages should still load with environment/default values if Firestore is unavailable.
  }
  delete profile.__name;
  delete profile.__id;
  return profile;
}

export async function onRequestGet(context) {
  const profile = await getProfile(context.env);
  return Response.json({ ok: true, profile });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    requireAdmin(env, body.password);
    if (clean(body.action || body.Action) === 'load') {
      const profile = await getProfile(env);
      return Response.json({ ok: true, profile });
    }
    requireFirestoreEnv(env);

    const incoming = body.profile || {};
    const profile = {
      ...defaultProfile(env),
      SchoolName: clean(incoming.SchoolName) || 'Integrated School Management Suite',
      SchoolCode: normalizeSchoolCode(incoming.SchoolCode),
      SchoolAddress: clean(incoming.SchoolAddress),
      SchoolPhone: clean(incoming.SchoolPhone),
      SchoolEmail: clean(incoming.SchoolEmail),
      SchoolSignatoryName: clean(incoming.SchoolSignatoryName),
      SchoolSignatoryTitle: clean(incoming.SchoolSignatoryTitle),
      ResultSignatoryName: clean(incoming.ResultSignatoryName),
      ResultSignatoryTitle: clean(incoming.ResultSignatoryTitle),
      OfferSignatoryName: clean(incoming.OfferSignatoryName),
      OfferSignatoryTitle: clean(incoming.OfferSignatoryTitle),
      AdmissionSignatoryName: clean(incoming.AdmissionSignatoryName),
      AdmissionSignatoryTitle: clean(incoming.AdmissionSignatoryTitle),
      EmailGreetingTemplate: clean(incoming.EmailGreetingTemplate) || 'Dear Parent/Guardian,',
      PortalHeadline: clean(incoming.PortalHeadline),
      PortalSubheading: clean(incoming.PortalSubheading),
      PortalNotice: clean(incoming.PortalNotice),
      ResultDisplayMode: ['subjects', 'percentage'].includes(clean(incoming.ResultDisplayMode)) ? clean(incoming.ResultDisplayMode) : 'subjects',
      ShowResultsOnline: ['YES', 'NO'].includes(clean(incoming.ShowResultsOnline).toUpperCase()) ? clean(incoming.ShowResultsOnline).toUpperCase() : 'NO',
      ProductKeyMode: ['off', 'required'].includes(clean(incoming.ProductKeyMode)) ? clean(incoming.ProductKeyMode) : 'off',
      UpdatedAt: new Date().toISOString()
    };
    await upsertDocument(env, 'settings', 'schoolProfile', profile);
    return Response.json({ ok: true, message: 'School setup saved.', profile });
  } catch (err) {
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, { status: err.status || 500 });
  }
}
