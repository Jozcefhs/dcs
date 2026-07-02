const statusEl = document.getElementById('confirmationStatus');
const box = document.getElementById('confirmationBox');

function setStatus(message, type) {
  statusEl.textContent = message || '';
  statusEl.className = 'status ' + (type || '');
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN'
  }).format(Number(amount || 0));
}

async function verifyPayment() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');
  if (!reference) {
    setStatus('Payment reference is missing. Please contact the Admissions Office.', 'bad');
    return;
  }

  try {
    const response = await fetch('/api/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Payment could not be verified.');
    }
    setStatus('Payment verified successfully.', 'ok');
    const details = document.createElement('div');
    details.className = 'receipt-box';
    [
      ['Fee', data.feeName || 'Online Payment'],
      ['Amount', formatMoney(data.amount, data.currency)],
      ['Reference', data.reference || reference]
    ].forEach(([label, value]) => {
      const line = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      line.append(strong, document.createTextNode(value));
      details.appendChild(line);
    });
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Your payment has been recorded with the Admissions Office.';
    details.appendChild(note);
    box.appendChild(details);
  } catch (error) {
    setStatus(error.message, 'bad');
  }
}

verifyPayment();
