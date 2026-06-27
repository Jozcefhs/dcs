const verifiedRaw = sessionStorage.getItem('dcaAdmissionVerified');
const verifiedBox = document.getElementById('verifiedBox');
const form = document.getElementById('applicationForm');
const statusEl = document.getElementById('submitStatus');
const submitBtn = document.getElementById('submitBtn');

let verified = null;

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + (type || '');
}

function disableForm() {
  const fields = form.querySelectorAll('input, select, textarea, button');
  fields.forEach((field) => {
    field.disabled = true;
  });
}

try {
  verified = JSON.parse(verifiedRaw || 'null');
} catch (_) {
  verified = null;
}

if (!verified || !verified.email || !verified.code) {
  window.location.href = 'verify.html';
} else {
  verifiedBox.textContent =
    `Verified purchase: ${verified.email}${verified.receiptNo ? ' | Receipt: ' + verified.receiptNo : ''}`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!verified) {
    window.location.href = 'verify.html';
    return;
  }

  submitBtn.disabled = true;
  setStatus('Submitting application, please wait...', '');

  const formData = new FormData(form);
  const application = {};

  for (const [key, value] of formData.entries()) {
    application[key] = value;
  }

  try {
    const response = await fetch('/api/submit-application', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verification: verified,
        application
      })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Application submission failed.');
    }

    const reference = data.applicationReference || data.reference || '';

    const applicantName = [
      application.Surname || '',
      application.FirstName || '',
      application.MiddleName || ''
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    sessionStorage.removeItem('dcaAdmissionVerified');

    sessionStorage.setItem('dcaApplicationSuccess', JSON.stringify({
      reference,
      applicantName,
      email: verified.email,
      submittedAt: new Date().toISOString()
    }));

    disableForm();
    setStatus('Application submitted successfully. Opening confirmation page...', 'ok');

    const params = new URLSearchParams();

    if (reference) params.set('ref', reference);
    if (applicantName) params.set('name', applicantName);

    window.location.href = `success.html?${params.toString()}`;

  } catch (error) {
    setStatus(error.message, 'bad');
    submitBtn.disabled = false;
  }
});