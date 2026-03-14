// ===== Kubectl UI — Main Entry Point =====
// Thin orchestrator that imports all modules and wires them together

import './style.css';

import { initTauri, isTauriApp, getInvoke } from './tauri.js';
import { initTabs } from './tabs.js';
import { initNamespaceDropdown, loadYamlNamespaces } from './namespace.js';
import { loadContexts, initContextSwitcher } from './context.js';
import { initDynamicLists, initResourceItemLists, initFormListeners, initTlsToggle } from './form-lists.js';
import { initActions } from './actions.js';
import { updatePreview } from './preview.js';
import { initModal } from './modal.js';
import { initSAManager } from './sa-manager.js';

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', async () => {
  const tauriReady = await initTauri();

  // Initialize all UI modules
  initTabs();
  initFormListeners(updatePreview);
  initDynamicLists(updatePreview);
  initResourceItemLists(updatePreview);
  initActions();
  initTlsToggle(updatePreview);
  initModal();
  initNamespaceDropdown(updatePreview);
  initContextSwitcher();
  initSAManager(getInvoke());

  // Initial preview render
  updatePreview();

  // Load cluster data if running in Tauri
  if (tauriReady) {
    loadContexts();
    loadYamlNamespaces();
  } else {
    const ctxSelect = document.getElementById('kubectl-context');
    ctxSelect.innerHTML = '<option>Browser Mode</option>';
    document.getElementById('context-status').classList.add('error');
  }
});
