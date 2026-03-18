// ===== Dynamic List Management =====
// Event handlers for adding/removing dynamic form elements and refreshing dropdowns

import { debounce } from './utils.js';
import {
  createKvRow, createSingleRow, createPortRow,
  createIngressRule, createIngressPathRow,
  createMountRow, createEnvRow, createEnvFromRow, createPullSecretRow,
  createPvcItem, createConfigMapItem, createSecretItem, createServiceItem,
  createSvcPortRow,
  populateMountDropdown, populateEnvRefDropdown, populatePullSecretDatalist,
} from './form-creators.js';

// ===== Refresh Dropdowns =====

/** Refresh all volume mount dropdowns with current PVC/CM/Secret names */
export function refreshAllMountDropdowns() {
  document.querySelectorAll('#volume-mounts .mount-row').forEach(row => {
    const type = row.querySelector('.mount-type')?.value;
    const refSelect = row.querySelector('.mount-ref-select');
    if (type && type !== 'emptyDir' && refSelect) {
      populateMountDropdown(refSelect, type);
    }
  });
}

/** Refresh all env var reference dropdowns */
export function refreshAllEnvDropdowns() {
  document.querySelectorAll('#env-vars-list .env-var-row').forEach(row => {
    const source = row.querySelector('.env-source')?.value;
    const refSelect = row.querySelector('.env-ref-select');
    if (source && source !== 'value' && refSelect) {
      populateEnvRefDropdown(refSelect, source);
    }
  });
  // Also refresh envFrom dropdowns
  document.querySelectorAll('#env-from-list .env-from-row').forEach(row => {
    const type = row.querySelector('.envfrom-type')?.value;
    const refSelect = row.querySelector('.envfrom-ref-select');
    if (type && refSelect) {
      populateEnvRefDropdown(refSelect, type);
    }
  });
  // Also refresh imagePullSecrets datalists
  document.querySelectorAll('#image-pull-secrets-list .pull-secret-row').forEach(row => {
    const datalist = row.querySelector('.pullsecret-datalist');
    if (datalist) populatePullSecretDatalist(datalist);
  });
}

/** Refresh ingress service name dropdowns */
export function refreshIngressServiceDropdowns() {
  const serviceNames = [];
  document.querySelectorAll('#service-items-list .resource-item').forEach(item => {
    const n = item.querySelector('.item-name')?.value?.trim();
    if (n) serviceNames.push(n);
  });
  document.querySelectorAll('.ingress-svc-name').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Service --</option>';
    serviceNames.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      if (n === current) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

// ===== Initialize Dynamic Lists =====

/** Set up all "Add" buttons and global remove handlers */
export function initDynamicLists(updatePreview) {
  // KV list add buttons
  document.querySelectorAll('.btn-add-kv').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const row = createKvRow();
      target.appendChild(row);
      row.querySelector('.kv-key').focus();
      updatePreview();
    });
  });

  // Single-value list add buttons
  document.querySelectorAll('.btn-add-single').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const row = createSingleRow();
      target.appendChild(row);
      row.querySelector('.kv-key').focus();
      updatePreview();
    });
  });

  // Node selector
  document.getElementById('btn-add-node-selector').addEventListener('click', () => {
    document.getElementById('node-selector-list').appendChild(createKvRow());
    updatePreview();
  });

  // Container ports
  document.querySelectorAll('.btn-add-port').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      target.appendChild(createPortRow());
      updatePreview();
    });
  });

  // Service items
  document.getElementById('btn-add-service').addEventListener('click', () => {
    const count = document.querySelectorAll('#service-items-list .resource-item').length;
    const appName = document.getElementById('app-name').value.trim() || 'my-app';
    const name = count === 0 ? appName : `${appName}-svc-${count + 1}`;
    document.getElementById('service-items-list').appendChild(
      createServiceItem(name, updatePreview, refreshIngressServiceDropdowns)
    );
    refreshIngressServiceDropdowns();
    updatePreview();
  });

  // Ingress rules
  document.getElementById('btn-add-ingress-rule').addEventListener('click', () => {
    document.getElementById('ingress-rules').appendChild(
      createIngressRule(updatePreview, refreshIngressServiceDropdowns)
    );
    updatePreview();
  });

  // Volume mounts
  document.getElementById('btn-add-mount').addEventListener('click', () => {
    document.getElementById('volume-mounts').appendChild(createMountRow(updatePreview));
    updatePreview();
  });

  // Env vars
  document.getElementById('btn-add-env').addEventListener('click', () => {
    document.getElementById('env-vars-list').appendChild(createEnvRow(updatePreview));
    updatePreview();
  });

  // envFrom
  document.getElementById('btn-add-envfrom').addEventListener('click', () => {
    document.getElementById('env-from-list').appendChild(createEnvFromRow(updatePreview));
    updatePreview();
  });

  // imagePullSecrets
  document.getElementById('btn-add-pull-secret').addEventListener('click', () => {
    document.getElementById('image-pull-secrets-list').appendChild(createPullSecretRow());
    updatePreview();
  });

  // Global delegated click handler for remove buttons and other dynamic elements
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-remove-kv') || 
        e.target.classList.contains('btn-remove-port') ||
        e.target.classList.contains('btn-remove-svc-port') ||
        e.target.classList.contains('btn-remove-mount') ||
        e.target.classList.contains('btn-remove-env') ||
        e.target.classList.contains('btn-remove-envfrom') ||
        e.target.classList.contains('btn-remove-pullsecret') ||
        e.target.classList.contains('btn-remove-ingress-path') ||
        e.target.classList.contains('btn-remove-ingress-rule') ||
        e.target.classList.contains('btn-remove-item')) {
      const row = e.target.closest('.kv-row, .port-row, .svc-port-row, .mount-row, .env-var-row, .env-from-row, .pull-secret-row, .ingress-path-row, .ingress-rule, .resource-item');
      if (row) {
        row.style.opacity = '0';
        row.style.transform = 'translateX(-10px)';
        setTimeout(() => { row.remove(); updatePreview(); refreshAllMountDropdowns(); refreshAllEnvDropdowns(); refreshIngressServiceDropdowns(); }, 150);
      }
    }
    // Inline ingress path add
    if (e.target.classList.contains('btn-add-ingress-path')) {
      const container = e.target.previousElementSibling;
      container.appendChild(createIngressPathRow(refreshIngressServiceDropdowns));
      updatePreview();
    }
    // Annotation preset chips
    if (e.target.classList.contains('btn-chip') && !e.target.disabled) {
      const key = e.target.dataset.key;
      const val = e.target.dataset.val || '';
      const row = createKvRow();
      row.querySelector('.kv-key').value = key;
      row.querySelector('.kv-value').value = val;
      document.getElementById('ingress-annotations-list').appendChild(row);
      e.target.disabled = true;
      e.target.style.opacity = '0.35';
      e.target.style.cursor = 'not-allowed';
      updatePreview();
    }
    // Add KV row inside resource items (ConfigMap/Secret data)
    if (e.target.classList.contains('btn-add-item-kv')) {
      const list = e.target.previousElementSibling;
      const row = createKvRow();
      list.appendChild(row);
      row.querySelector('.kv-key').focus();
      updatePreview();
    }
  });
}

/** Set up resource item list add buttons (PVC, ConfigMap, Secret) */
export function initResourceItemLists(updatePreview) {
  document.getElementById('btn-add-pvc').addEventListener('click', () => {
    const appName = document.getElementById('app-name').value.trim() || 'my-app';
    const idx = document.querySelectorAll('#pvc-items-list .resource-item').length;
    const name = idx === 0 ? `${appName}-data` : `${appName}-data-${idx + 1}`;
    document.getElementById('pvc-items-list').appendChild(
      createPvcItem(name, updatePreview, refreshAllMountDropdowns)
    );
    document.getElementById('enable-pvc').checked = true;
    updatePreview();
    refreshAllMountDropdowns();
  });

  document.getElementById('btn-add-configmap').addEventListener('click', () => {
    const appName = document.getElementById('app-name').value.trim() || 'my-app';
    const idx = document.querySelectorAll('#configmap-items-list .resource-item').length;
    const name = idx === 0 ? `${appName}-config` : `${appName}-config-${idx + 1}`;
    document.getElementById('configmap-items-list').appendChild(
      createConfigMapItem(name, updatePreview, refreshAllMountDropdowns)
    );
    document.getElementById('enable-configmap').checked = true;
    updatePreview();
    refreshAllMountDropdowns();
    refreshAllEnvDropdowns();
  });

  document.getElementById('btn-add-secret').addEventListener('click', () => {
    const appName = document.getElementById('app-name').value.trim() || 'my-app';
    const idx = document.querySelectorAll('#secret-items-list .resource-item').length;
    const name = idx === 0 ? `${appName}-secret` : `${appName}-secret-${idx + 1}`;
    document.getElementById('secret-items-list').appendChild(
      createSecretItem(name, updatePreview, refreshAllMountDropdowns, refreshAllEnvDropdowns)
    );
    document.getElementById('enable-secret').checked = true;
    updatePreview();
    refreshAllMountDropdowns();
    refreshAllEnvDropdowns();
  });
}

/** Initialize form input/change listeners for live preview updates */
export function initFormListeners(updatePreview) {
  document.querySelector('.tab-content').addEventListener('input', debounce(updatePreview, 150));
  document.querySelector('.tab-content').addEventListener('change', debounce(updatePreview, 150));
}

/** Initialize TLS and probe toggles */
export function initTlsToggle(updatePreview) {
  document.getElementById('ingress-tls').addEventListener('change', (e) => {
    document.getElementById('tls-fields').style.display = e.target.checked ? 'block' : 'none';
    updatePreview();
  });
  document.getElementById('enable-init-permissions').addEventListener('change', () => updatePreview());

  // Probe toggles
  function initProbeToggle(prefix) {
    document.getElementById(`enable-${prefix}`).addEventListener('change', (e) => {
      document.getElementById(`${prefix}-fields`).style.display = e.target.checked ? 'block' : 'none';
      updatePreview();
    });
    document.getElementById(`${prefix}-type`).addEventListener('change', (e) => {
      const t = e.target.value;
      document.querySelectorAll(`.${prefix}-http`).forEach(el => el.style.display = t === 'httpGet' ? '' : 'none');
      document.querySelectorAll(`.${prefix}-tcp`).forEach(el => el.style.display = t === 'tcpSocket' ? '' : 'none');
      document.querySelectorAll(`.${prefix}-exec`).forEach(el => el.style.display = t === 'exec' ? '' : 'none');
      updatePreview();
    });
  }
  initProbeToggle('liveness');
  initProbeToggle('readiness');
}
