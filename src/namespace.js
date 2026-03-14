// ===== Namespace Dropdown =====

import { getInvoke } from './tauri.js';

/** Get the currently selected namespace */
export function getNamespace() {
  const sel = document.getElementById('namespace');
  if (sel.value === '__create__') {
    return document.getElementById('namespace-new').value.trim() || 'default';
  }
  return sel.value || 'default';
}

/** Initialize namespace dropdown with create-new toggle */
export function initNamespaceDropdown(updatePreview) {
  const sel = document.getElementById('namespace');
  const newInput = document.getElementById('namespace-new');
  sel?.addEventListener('change', () => {
    newInput.style.display = sel.value === '__create__' ? 'block' : 'none';
    updatePreview();
  });
  newInput?.addEventListener('input', () => updatePreview());
}

/** Load namespaces from the cluster into the dropdown */
export async function loadYamlNamespaces() {
  const invoke = getInvoke();
  if (!invoke) return;
  try {
    const result = await invoke('run_kubectl', { args: ['get', 'ns', '-o', 'jsonpath={.items[*].metadata.name}'], stdinInput: null });
    if (!result?.success) return;
    const nsList = result.stdout.trim().split(/\s+/).filter(Boolean);
    const sel = document.getElementById('namespace');
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Chọn Namespace --</option><option value="__create__">+ Tạo Namespace mới</option>';
    nsList.forEach(ns => {
      const opt = document.createElement('option');
      opt.value = ns; opt.textContent = ns;
      if (ns === current) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch {}
}
