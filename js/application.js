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

try {
  verified = JSON.parse(verifiedRaw || 'null');
} catch (_) {
  verified = null;
}

if (!verified || !verified.email || !verified.code) {
  window.location.href = 'verify.html';
} else {
  verifiedBox.textContent = `Verified purchase: ${verified.email}${verified.receiptNo ? ' | Receipt: ' + verified.receiptNo : ''}`;
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

    sessionStorage.removeItem('dcaAdmissionVerified');
    form.reset();
    verifiedBox.textContent = 'Application submitted successfully.';
    setStatus('Your application has been submitted successfully. Thank you.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    submitBtn.disabled = false;
  }
});
