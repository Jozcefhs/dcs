const setupForm = document.getElementById('setupForm');
const setupStatus = document.getElementById('setupStatus');

function setStatus(message, type) {
  setupStatus.textContent = message || '';
  setupStatus.className = 'status ' + (type || '');
}

function setField(id, value) {
  const node = document.getElementById(id);
  if (node) node.value = value || '';
}

function profileFromForm() {
  const data = new FormData(setupForm);
  return {
    SchoolName: data.get('SchoolName'),
    SchoolAddress: data.get('SchoolAddress'),
    SchoolEmail: data.get('SchoolEmail'),
    SchoolPhone: data.get('SchoolPhone'),
    PortalHeadline: data.get('PortalHeadline'),
    PortalSubheading: data.get('PortalSubheading'),
    PortalNotice: data.get('PortalNotice'),
    ResultDisplayMode: data.get('ResultDisplayMode'),
    ProductKeyMode: data.get('ProductKeyMode')
  };
}

async function loadProfile() {
  try {
    const response = await fetch('/api/settings');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load setup.');
    const profile = data.profile || {};
    setField('schoolName', profile.SchoolName);
    setField('schoolAddress', profile.SchoolAddress);
    setField('schoolEmail', profile.SchoolEmail);
    setField('schoolPhone', profile.SchoolPhone);
    setField('portalHeadline', profile.PortalHeadline);
    setField('portalSubheading', profile.PortalSubheading);
    setField('portalNotice', profile.PortalNotice);
    setField('resultDisplayMode', profile.ResultDisplayMode || 'subjects');
    setField('productKeyMode', profile.ProductKeyMode || 'off');
  } catch (error) {
    setStatus(error.message, 'bad');
  }
}

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setStatus('Saving setup...', '');
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: document.getElementById('setupPassword').value,
        profile: profileFromForm()
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Setup could not be saved.');
    setStatus('School setup saved.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  }
});

loadProfile();
