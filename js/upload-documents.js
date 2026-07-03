const form = document.getElementById('uploadDocumentForm');
const statusEl = document.getElementById('uploadStatus');
const resultsEl = document.getElementById('uploadResults');
const button = document.getElementById('uploadBtn');
const progressEl = document.getElementById('documentUploadProgress');
const progressFillEl = document.getElementById('documentUploadProgressFill');
const progressTextEl = document.getElementById('documentUploadProgressText');

const MAX_FILE_SIZE = 8 * 1024 * 1024;

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + (type || '');
}

function setProgress(done, total, label) {
  if (!progressEl || !progressFillEl || !progressTextEl) return;
  const percent = total ? Math.round((done / total) * 100) : 0;
  progressEl.hidden = false;
  progressFillEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressTextEl.textContent = label || `${done} of ${total} document(s) processed`;
}

function resetProgress() {
  if (!progressEl || !progressFillEl || !progressTextEl) return;
  progressEl.hidden = true;
  progressFillEl.style.width = '0%';
  progressTextEl.textContent = 'Preparing upload...';
}

function addResult(message, type) {
  const item = document.createElement('div');
  item.className = 'upload-result ' + (type || '');
  item.textContent = message;
  resultsEl.appendChild(item);
  return item;
}

function updateResult(item, message, type) {
  if (!item) return;
  item.className = 'upload-result ' + (type || '');
  item.textContent = message;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function selectedUploads() {
  const uploads = [];
  document.querySelectorAll('input[type="file"][data-document-type]').forEach((input) => {
    const file = input.files && input.files[0];
    if (file) {
      uploads.push({
        documentType: input.dataset.documentType,
        label: input.closest('.document-upload-row').querySelector('label').textContent.trim(),
        file
      });
    }
  });
  return uploads;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('email').value.trim().toLowerCase();
  const code = document.getElementById('code').value.trim().toUpperCase();
  const replaceExisting = document.getElementById('replaceExisting').checked;
  const uploads = selectedUploads();

  resultsEl.innerHTML = '';
  resetProgress();

  if (!email || !code) {
    setStatus('Email and verification code are required.', 'bad');
    return;
  }
  if (!uploads.length) {
    setStatus('Choose at least one document to upload.', 'bad');
    return;
  }
  const tooLarge = uploads.find((upload) => upload.file.size > MAX_FILE_SIZE);
  if (tooLarge) {
    setStatus(`${tooLarge.label} is too large. Maximum allowed size is 8 MB.`, 'bad');
    return;
  }

  button.disabled = true;
  setStatus(`Uploading ${uploads.length} document(s), please wait...`, '');
  setProgress(0, uploads.length, `Uploading 0 of ${uploads.length} document(s)...`);

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let processedCount = 0;

  for (const upload of uploads) {
    const pendingRow = addResult(`${upload.label}: uploading...`, 'pending');
    try {
      setProgress(processedCount, uploads.length, `Uploading ${upload.label}...`);
      const response = await fetch('/api/upload-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          code,
          documentType: upload.documentType,
          fileName: upload.file.name,
          mimeType: upload.file.type || 'application/octet-stream',
          fileBase64: await fileToBase64(upload.file),
          replaceExisting
        })
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.code === 'DOCUMENT_ALREADY_UPLOADED') {
          skippedCount += 1;
          updateResult(pendingRow, `${upload.label}: already uploaded. Tick replace if Admissions Office requested a newer copy.`, 'bad');
          continue;
        }
        throw new Error(data.message || 'Document upload failed.');
      }

      successCount += 1;
      updateResult(pendingRow, `${upload.label}: ${data.message || 'Uploaded successfully.'}`, 'ok');
    } catch (error) {
      failedCount += 1;
      updateResult(pendingRow, `${upload.label}: ${error.message}`, 'bad');
    } finally {
      processedCount += 1;
      setProgress(processedCount, uploads.length, `${processedCount} of ${uploads.length} document(s) processed`);
    }
  }

  if (failedCount || skippedCount) {
    setStatus(`Completed with ${successCount} uploaded, ${skippedCount} skipped, ${failedCount} failed.`, failedCount ? 'bad' : '');
  } else {
    setStatus(`All ${successCount} selected document(s) uploaded successfully.`, 'ok');
    form.reset();
  }

  button.disabled = false;
  setTimeout(() => {
    if (!failedCount && !skippedCount) resetProgress();
  }, 1200);
});
