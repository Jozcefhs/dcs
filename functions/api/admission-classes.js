// Cloudflare Pages Function: /api/admission-classes
// Returns classes currently open for admission from Apps Script.

const FALLBACK_CLASSES = [
  'Creche',
  'Pre Nursery',
  'Nursery 1',
  'Nursery 2',
  'Nursery 3',
  'Primary 1',
  'Primary 2',
  'Primary 3',
  'Primary 4',
  'Primary 5',
  'Primary 6',
  'JSS 1 / Grade 7',
  'JSS 2 / Grade 8',
  'JSS 3 / Grade 9',
  'SS 1 / Grade 10',
  'SS 2 / Grade 11',
  'SS 3 / Grade 12'
];

export async function onRequestGet(context) {
  try {
    const { env } = context;
    if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return Response.json({ ok: true, classes: FALLBACK_CLASSES, fallback: true });
    }

    const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
    url.searchParams.set('action', 'getAdmissionClasses');
    url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);

    const response = await fetch(url.toString());
    const data = await response.json();
    if (!data.ok) {
      return Response.json(data, { status: 400 });
    }

    return Response.json({
      ok: true,
      classes: data.openClasses || [],
      allClasses: data.classes || [],
      formAmount: data.formAmount || ''
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
