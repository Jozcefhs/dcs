// Cloudflare Pages Function: /api/upload-document
// Lets parents upload missing admission documents using their verification email/code.

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();
    const documentType = String(body.documentType || '').trim();
    const fileName = String(body.fileName || '').trim();
    const mimeType = String(body.mimeType || 'application/octet-stream').trim();
    const fileBase64 = String(body.fileBase64 || '').trim();
    const replaceExisting = Boolean(body.replaceExisting);

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Email and verification code are required.' }, { status: 400 });
    }
    if (!documentType) {
      return Response.json({ ok: false, message: 'Select the document you are uploading.' }, { status: 400 });
    }
    if (!fileName || !fileBase64) {
      return Response.json({ ok: false, message: 'Choose a file to upload.' }, { status: 400 });
    }
    if (!env.GOOGLE_APPS_SCRIPT_URL) {
      return Response.json({ ok: false, message: 'Server upload is not configured yet.' }, { status: 500 });
    }

    const payload = {
      Action: 'uploadParentDocument',
      Email: email,
      VerificationCode: code,
      DocumentType: documentType,
      FileName: fileName,
      MimeType: mimeType,
      FileBase64: fileBase64,
      ReplaceExisting: replaceExisting ? 'YES' : 'NO'
    };

    const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    return Response.json(data, { status: data.ok ? 200 : 400 });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
