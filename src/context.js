// ===== Kubectl Context Management =====

import { getInvoke, isTauriApp } from './tauri.js';
import { showToast } from './utils.js';
import { loadYamlNamespaces } from './namespace.js';

/** Load kubectl contexts into the dropdown */
export async function loadContexts() {
  const invoke = getInvoke();
  if (!invoke) return;
  try {
    const [contextsResult, currentResult] = await Promise.all([
      invoke('get_kubectl_contexts'),
      invoke('get_current_context')
    ]);
    const ctxSelect = document.getElementById('kubectl-context');
    const statusEl = document.getElementById('context-status');
    if (contextsResult.success) {
      const contexts = contextsResult.stdout.trim().split('\n').filter(Boolean);
      const current = currentResult.success ? currentResult.stdout.trim() : '';
      ctxSelect.innerHTML = contexts.map(ctx =>
        `<option value="${ctx}" ${ctx === current ? 'selected' : ''}>${ctx}</option>`
      ).join('');
      statusEl.classList.remove('error');
    } else {
      ctxSelect.innerHTML = '<option>kubectl not configured</option>';
      statusEl.classList.add('error');
    }
  } catch (e) {
    console.error('Failed to load contexts:', e);
  }
}

/** Initialize context switch handler */
export function initContextSwitcher() {
  document.getElementById('kubectl-context')?.addEventListener('change', async (e) => {
    const invoke = getInvoke();
    if (!invoke || !isTauriApp()) return;
    const context = e.target.value;
    const statusEl = document.getElementById('context-status');
    try {
      const result = await invoke('switch_context', { context });
      if (result.success) {
        showToast(`Switched to ${context}`, 'success');
        statusEl.classList.remove('error');
        // Reload SA Manager dropdowns if SA page is active
        if (document.getElementById('page-sa-manager')?.classList.contains('active')) {
          const { reloadAllNamespaces } = await import('./sa-manager.js');
          reloadAllNamespaces();
        }
        // Reload YAML namespace dropdown
        loadYamlNamespaces();
        // Reload K8s Manager namespaces + resources
        try {
          const k8s = await import('./k8s-manager.js');
          k8s.reloadK8sOnContextSwitch();
        } catch {}
      } else {
        showToast(`Failed: ${result.stderr}`, 'error');
        statusEl.classList.add('error');
      }
    } catch (e) {
      showToast('Failed to switch context', 'error');
    }
  });
}
