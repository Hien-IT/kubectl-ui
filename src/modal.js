// ===== Modal Management =====

import { escapeHtml, showToast } from './utils.js';

/** Initialize modal event listeners */
export function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('terminal-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modal-copy-output').addEventListener('click', () => {
    const text = document.getElementById('terminal-output').innerText;
    navigator.clipboard.writeText(text).then(() => showToast('Output copied!', 'success'));
  });
}

/** Show the terminal modal */
export function showModal(title) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('terminal-output').innerHTML = '<div class="terminal-line loading"><span class="terminal-spinner">⠋</span> Running...</div>';
  document.getElementById('modal-status').textContent = '';
  document.getElementById('modal-status').className = 'modal-status loading';
  document.getElementById('terminal-modal').style.display = 'flex';
}

/** Close the terminal modal */
export function closeModal() {
  document.getElementById('terminal-modal').style.display = 'none';
}

/** Set the result content in the modal */
export function setModalResult(result, commandText) {
  const terminalEl = document.getElementById('terminal-output');
  const statusEl = document.getElementById('modal-status');
  let html = `<div class="terminal-cmd">${escapeHtml(commandText)}</div>`;
  if (result.stdout) {
    html += result.stdout.split('\n').map(line => 
      `<div class="terminal-line stdout">${escapeHtml(line)}</div>`
    ).join('');
  }
  if (result.stderr) {
    html += result.stderr.split('\n').map(line => 
      `<div class="terminal-line stderr">${escapeHtml(line)}</div>`
    ).join('');
  }
  terminalEl.innerHTML = html;
  if (result.success) {
    statusEl.textContent = '✓ Success';
    statusEl.className = 'modal-status success';
  } else {
    statusEl.textContent = '✗ Failed';
    statusEl.className = 'modal-status error';
  }
}

/** Show a confirmation dialog and return a promise */
export function showConfirmModal(title, detail, actionLabel = 'OK') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <h3>⚠️ ${title}</h3>
        </div>
        <div class="modal-body" style="padding:16px;">
          <pre style="margin:0;color:var(--text-primary);font-size:0.85rem;white-space:pre-wrap;font-family:inherit;">${detail}</pre>
        </div>
        <div class="modal-footer" style="justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost btn-sm confirm-no">Hủy</button>
          <button class="btn btn-success btn-sm confirm-yes">${actionLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.confirm-yes').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    overlay.querySelector('.confirm-no').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
  });
}
