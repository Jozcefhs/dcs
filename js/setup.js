const setupLoginForm = document.getElementById('setupLoginForm');
const setupForm = document.getElementById('setupForm');
const setupLoginStatus = document.getElementById('setupLoginStatus');
const setupStatus = document.getElementById('setupStatus');
let unlockedPassword = '';

function setStatus(message, type) {
  setupStatus.textContent = message || '';
  setupStatus.className = 'status ' + (type || '');
}

function setLoginStatus(message, type) {
  setupLoginStatus.textContent = message || '';
  setupLoginStatus.className = 'status ' + (type || '');
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
    ShowResultsOnline: data.get('ShowResultsOnline'),
    ProductKeyMode: data.get('ProductKeyMode')
  };
}

async function loadProfile(password = '') {
  try {
    const response = password
      ? await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'load', password })
        })
      : await fetch('/api/settings');
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
    setField('showResultsOnline', profile.ShowResultsOnline || 'NO');
    setField('productKeyMode', profile.ProductKeyMode || 'off');
  } catch (error) {
    setStatus(error.message, 'bad');
  }
}

setupLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setLoginStatus('Checking password...', '');
    unlockedPassword = document.getElementById('setupPassword').value;
    await loadProfile(unlockedPassword);
    setupLoginForm.hidden = true;
    setupForm.hidden = false;
    setStatus('Setup unlocked.', 'ok');
  } catch (error) {
    unlockedPassword = '';
    setLoginStatus(error.message, 'bad');
  }
});

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setStatus('Saving setup...', '');
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: unlockedPassword,
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

// Public pages can read the school profile, but setup editing stays locked until password entry.
