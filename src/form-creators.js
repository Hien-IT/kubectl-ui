// ===== Dynamic Row and Item Creators =====
// Functions that create DOM elements for dynamic form lists

import { debounce } from './utils.js';
import { switchToTab } from './tabs.js';
import { getPvcNames, getConfigMapNames, getSecretNames } from './form-collectors.js';

// ===== Shared Dropdown Populators =====

/** Populate a mount dropdown with PVC/ConfigMap/Secret names */
export function populateMountDropdown(selectEl, type) {
  const currentVal = selectEl.value;
  let names = [];
  if (type === 'pvc') names = getPvcNames();
  else if (type === 'configmap') names = getConfigMapNames();
  else if (type === 'secret') names = getSecretNames();

  selectEl.innerHTML = '<option value="">-- Select --</option>' + 
    names.map(n => `<option value="${n}" ${n === currentVal ? 'selected' : ''}>${n}</option>`).join('');
  
  if (currentVal && names.includes(currentVal)) {
    selectEl.value = currentVal;
  } else if (names.length > 0 && !currentVal) {
    selectEl.value = names[0];
  }
}

/** Populate an env ref dropdown with ConfigMap/Secret names */
export function populateEnvRefDropdown(selectEl, source) {
  const currentVal = selectEl.value;
  let names = [];
  if (source === 'configmap') names = getConfigMapNames();
  else if (source === 'secret') names = getSecretNames();

  selectEl.innerHTML = '<option value="">-- Select resource --</option>' + 
    names.map(n => `<option value="${n}" ${n === currentVal ? 'selected' : ''}>${n}</option>`).join('');
  
  if (currentVal && names.includes(currentVal)) {
    selectEl.value = currentVal;
  } else if (names.length > 0 && !currentVal) {
    selectEl.value = names[0];
  }
}

// ===== Simple Row Creators =====

/** Create a key-value row */
export function createKvRow() {
  const div = document.createElement('div');
  div.className = 'kv-row';
  div.innerHTML = `<input type="text" placeholder="key" class="kv-key" /><input type="text" placeholder="value" class="kv-value" /><button class="btn-icon btn-remove-kv" title="Remove">×</button>`;
  return div;
}

/** Create a single-value row */
export function createSingleRow() {
  const div = document.createElement('div');
  div.className = 'kv-row single';
  div.innerHTML = `<input type="text" placeholder="value" class="kv-key" /><button class="btn-icon btn-remove-kv" title="Remove">×</button>`;
  return div;
}

/** Create a container port row */
export function createPortRow() {
  const div = document.createElement('div');
  div.className = 'port-row';
  div.innerHTML = `<input type="text" placeholder="Name" class="port-name" /><input type="number" placeholder="Port" class="port-number" /><select class="port-protocol"><option value="TCP">TCP</option><option value="UDP">UDP</option></select><button class="btn-icon btn-remove-port" title="Remove">×</button>`;
  return div;
}

// ===== Service Port Row =====

export function createSvcPortRow() {
  const div = document.createElement('div');
  div.className = 'svc-port-row';
  div.innerHTML = `
    <input type="text" placeholder="Name" class="svc-port-name" />
    <input type="number" placeholder="Port" class="svc-port-port" />
    <input type="number" placeholder="Target" class="svc-port-target" />
    <input type="number" placeholder="Node Port" class="svc-port-nodeport" style="display:none;" />
    <select class="svc-port-protocol"><option value="TCP">TCP</option><option value="UDP">UDP</option></select>
    <button class="btn-icon btn-remove-svc-port" title="Remove">×</button>
  `;
  return div;
}

// ===== Ingress Creators =====

export function createIngressRule(updatePreview, refreshIngressServiceDropdowns) {
  const div = document.createElement('div');
  div.className = 'ingress-rule';
  div.innerHTML = `<div class="mount-header"><span>Rule</span><button class="btn-icon btn-remove-ingress-rule" title="Remove">×</button></div><div class="form-group" style="margin-top:8px;"><label>Host</label><input type="text" placeholder="example.com" class="ingress-host" /></div><div class="ingress-paths"><div class="ingress-path-row"><input type="text" placeholder="Path" value="/" class="ingress-path" /><select class="ingress-path-type"><option value="Prefix">Prefix</option><option value="Exact">Exact</option><option value="ImplementationSpecific">ImplementationSpecific</option></select><select class="ingress-svc-name"><option value="">-- Service --</option></select><input type="number" placeholder="Port" value="80" class="ingress-svc-port" /><button class="btn-icon btn-remove-ingress-path" title="Remove">×</button></div></div><button class="btn btn-ghost btn-add-ingress-path">+ Add Path</button>`;
  setTimeout(() => refreshIngressServiceDropdowns(), 0);
  return div;
}

export function createIngressPathRow(refreshIngressServiceDropdowns) {
  const div = document.createElement('div');
  div.className = 'ingress-path-row';
  div.innerHTML = `<input type="text" placeholder="Path" value="/" class="ingress-path" /><select class="ingress-path-type"><option value="Prefix">Prefix</option><option value="Exact">Exact</option><option value="ImplementationSpecific">ImplementationSpecific</option></select><select class="ingress-svc-name"><option value="">-- Service --</option></select><input type="number" placeholder="Port" value="80" class="ingress-svc-port" /><button class="btn-icon btn-remove-ingress-path" title="Remove">×</button>`;
  setTimeout(() => refreshIngressServiceDropdowns(), 0);
  return div;
}

// ===== Env Row =====

export function createEnvRow(updatePreview) {
  const div = document.createElement('div');
  div.className = 'env-var-row';
  div.innerHTML = `
    <div class="env-row-top">
      <input type="text" placeholder="ENV_NAME" class="env-name" />
      <select class="env-source">
        <option value="value">Value</option>
        <option value="configmap">ConfigMap</option>
        <option value="secret">Secret</option>
      </select>
      <button class="btn-icon btn-remove-env" title="Remove">×</button>
    </div>
    <div class="env-row-bottom env-value-field">
      <input type="text" placeholder="value" class="env-value" />
    </div>
    <div class="env-row-bottom env-ref-fields" style="display:none;">
      <select class="env-ref-select">
        <option value="">-- Select resource --</option>
      </select>
      <input type="text" placeholder="key in resource" class="env-ref-key" />
    </div>
  `;

  const sourceSelect = div.querySelector('.env-source');
  const valueField = div.querySelector('.env-value-field');
  const refFields = div.querySelector('.env-ref-fields');
  const refSelect = div.querySelector('.env-ref-select');

  function updateEnvSource() {
    const source = sourceSelect.value;
    if (source === 'value') {
      valueField.style.display = '';
      refFields.style.display = 'none';
    } else {
      valueField.style.display = 'none';
      refFields.style.display = '';
      populateEnvRefDropdown(refSelect, source);
    }
  }

  sourceSelect.addEventListener('change', () => { updateEnvSource(); updatePreview(); });
  return div;
}

// ===== envFrom Row =====

export function createEnvFromRow(updatePreview) {
  const div = document.createElement('div');
  div.className = 'env-from-row';
  div.innerHTML = `
    <div class="env-row-top">
      <select class="envfrom-type">
        <option value="configmap">ConfigMap</option>
        <option value="secret">Secret</option>
      </select>
      <select class="envfrom-ref-select">
        <option value="">-- Select resource --</option>
      </select>
      <input type="text" placeholder="prefix (optional)" class="envfrom-prefix" style="max-width:140px;" />
      <button class="btn-icon btn-remove-envfrom" title="Remove">×</button>
    </div>
  `;

  const typeSelect = div.querySelector('.envfrom-type');
  const refSelect = div.querySelector('.envfrom-ref-select');

  function updateEnvFromType() {
    populateEnvRefDropdown(refSelect, typeSelect.value);
  }

  typeSelect.addEventListener('change', () => { updateEnvFromType(); updatePreview(); });
  updateEnvFromType();
  return div;
}

// ===== imagePullSecrets Row =====

export function createPullSecretRow() {
  const div = document.createElement('div');
  div.className = 'pull-secret-row env-from-row';
  div.innerHTML = `
    <div class="env-row-top">
      <span style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap;">🔐 Secret:</span>
      <select class="pullsecret-ref-select" style="flex:1;">
        <option value="">-- Select Secret --</option>
      </select>
      <button class="btn-icon btn-remove-pullsecret" title="Remove">×</button>
    </div>
  `;

  const refSelect = div.querySelector('.pullsecret-ref-select');
  populateEnvRefDropdown(refSelect, 'secret');
  return div;
}

// ===== Mount Row =====

export function createMountRow(updatePreview) {
  const div = document.createElement('div');
  div.className = 'mount-row';
  div.innerHTML = `
    <div class="mount-header">
      <span>Volume Mount</span>
      <div style="display:flex;gap:6px;align-items:center;">
        <a class="mount-link" href="#" style="font-size:0.78rem;color:var(--text-accent);text-decoration:none;">→ Go to PVC</a>
        <button class="btn-icon btn-remove-mount" title="Remove">×</button>
      </div>
    </div>
    <div class="mount-fields">
      <div class="form-group" style="margin-bottom:0;">
        <label>Name</label>
        <input type="text" placeholder="data-volume" class="mount-name" value="data-volume" />
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label>Mount Path</label>
        <input type="text" placeholder="/data" class="mount-path" />
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label>Type</label>
        <select class="mount-type">
          <option value="pvc">PVC</option>
          <option value="configmap">ConfigMap</option>
          <option value="secret">Secret</option>
          <option value="emptyDir">EmptyDir</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label>Sub Path</label>
        <input type="text" placeholder="" class="mount-subpath" />
      </div>
      <div class="form-group mount-ref-group" style="margin-bottom:0;">
        <label class="mount-ref-label">Select PVC</label>
        <select class="mount-ref-select">
          <option value="">-- Select --</option>
        </select>
      </div>
    </div>
  `;

  const typeSelect = div.querySelector('.mount-type');
  const linkEl = div.querySelector('.mount-link');
  const refSelect = div.querySelector('.mount-ref-select');
  const refLabel = div.querySelector('.mount-ref-label');
  const refGroup = div.querySelector('.mount-ref-group');

  function updateMountUI() {
    const type = typeSelect.value;
    const labelMap = { pvc: 'Select PVC', configmap: 'Select ConfigMap', secret: 'Select Secret' };
    const tabMap = { pvc: 'pvc', configmap: 'configmap', secret: 'secret' };

    if (type === 'emptyDir') {
      refGroup.style.display = 'none';
      linkEl.style.display = 'none';
    } else {
      refGroup.style.display = '';
      refLabel.textContent = labelMap[type] || 'Select';
      linkEl.style.display = 'inline';
      linkEl.textContent = `→ Go to ${type === 'pvc' ? 'PVC' : type === 'configmap' ? 'ConfigMap' : 'Secret'}`;
      linkEl.onclick = (e) => { e.preventDefault(); switchToTab(tabMap[type]); };
      populateMountDropdown(refSelect, type);
    }
  }

  typeSelect.addEventListener('change', () => { updateMountUI(); updatePreview(); });
  updateMountUI();

  return div;
}

// ===== Resource Item Creators =====

/** Create a PVC item */
export function createPvcItem(name, updatePreview, refreshAllMountDropdowns) {
  const div = document.createElement('div');
  div.className = 'resource-item';
  div.innerHTML = `
    <div class="item-header">
      <span class="item-badge pvc-badge">PVC</span>
      <input type="text" class="item-name" placeholder="pvc-name" value="${name}" />
      <button class="btn-icon btn-remove-item" title="Remove">×</button>
    </div>
    <div class="item-fields">
      <div class="form-row">
        <div class="form-group" style="margin-bottom:0;">
          <label>Storage Class</label>
          <input type="text" class="pvc-storage-class" placeholder="standard" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Access Mode</label>
          <select class="pvc-access-mode">
            <option value="ReadWriteOnce">ReadWriteOnce</option>
            <option value="ReadOnlyMany">ReadOnlyMany</option>
            <option value="ReadWriteMany">ReadWriteMany</option>
          </select>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px;">
        <label>Storage Size</label>
        <input type="text" class="pvc-storage-size" placeholder="1Gi" value="1Gi" />
      </div>
    </div>
  `;
  div.querySelector('.item-name').addEventListener('input', debounce(() => { refreshAllMountDropdowns(); updatePreview(); }, 200));
  return div;
}

/** Create a ConfigMap item */
export function createConfigMapItem(name, updatePreview, refreshAllMountDropdowns) {
  const div = document.createElement('div');
  div.className = 'resource-item';
  div.innerHTML = `
    <div class="item-header">
      <span class="item-badge cm-badge">CM</span>
      <input type="text" class="item-name" placeholder="configmap-name" value="${name}" />
      <button class="btn-icon btn-remove-item" title="Remove">×</button>
    </div>
    <div class="item-fields">
      <label style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;display:block;">Data Entries</label>
      <div class="kv-list item-data-list"></div>
      <button class="btn btn-ghost btn-sm btn-add-item-kv">+ Add Entry</button>
    </div>
  `;
  div.querySelector('.item-name').addEventListener('input', debounce(() => { refreshAllMountDropdowns(); updatePreview(); }, 200));
  return div;
}

/** Create a Service item */
export function createServiceItem(name, updatePreview, refreshIngressServiceDropdowns) {
  const div = document.createElement('div');
  div.className = 'resource-item';
  div.innerHTML = `
    <div class="item-header">
      <span class="item-badge svc-badge">SVC</span>
      <input type="text" class="item-name" placeholder="service-name" value="${name}" />
      <button class="btn-icon btn-remove-item" title="Remove">×</button>
    </div>
    <div class="item-fields">
      <div class="form-group" style="margin-bottom:8px;">
        <label>Type</label>
        <select class="svc-type-select">
          <option value="ClusterIP">ClusterIP</option>
          <option value="NodePort">NodePort</option>
          <option value="LoadBalancer">LoadBalancer</option>
        </select>
      </div>
      <div class="svc-port-labels">
        <span style="flex:2;">Name</span>
        <span style="flex:1;">Port</span>
        <span style="flex:1;">Target</span>
        <span style="flex:1;">Protocol</span>
        <span style="width:28px;"></span>
      </div>
      <div class="svc-port-list">
        <div class="svc-port-row">
          <input type="text" placeholder="Name" value="http" class="svc-port-name" />
          <input type="number" placeholder="Port" value="80" class="svc-port-port" />
          <input type="number" placeholder="Target" value="80" class="svc-port-target" />
          <input type="number" placeholder="Node Port" class="svc-port-nodeport" style="display:none;" />
          <select class="svc-port-protocol">
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
          </select>
          <button class="btn-icon btn-remove-svc-port" title="Remove">×</button>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm btn-add-svc-port-item">+ Add Port</button>
    </div>
  `;
  // Type change -> toggle nodeport visibility
  const typeSelect = div.querySelector('.svc-type-select');
  typeSelect.addEventListener('change', () => {
    const isNodePort = typeSelect.value === 'NodePort';
    div.querySelectorAll('.svc-port-nodeport').forEach(el => el.style.display = isNodePort ? '' : 'none');
    updatePreview();
  });
  // Add port button
  div.querySelector('.btn-add-svc-port-item').addEventListener('click', () => {
    const portList = div.querySelector('.svc-port-list');
    const row = createSvcPortRow();
    if (typeSelect.value === 'NodePort') {
      row.querySelector('.svc-port-nodeport').style.display = '';
    }
    portList.appendChild(row);
    updatePreview();
  });
  // Name change -> refresh ingress dropdowns
  div.querySelector('.item-name').addEventListener('input', debounce(() => { refreshIngressServiceDropdowns(); updatePreview(); }, 200));
  return div;
}

/** Create a Secret item */
export function createSecretItem(name, updatePreview, refreshAllMountDropdowns, refreshAllEnvDropdowns) {
  const div = document.createElement('div');
  div.className = 'resource-item';
  div.innerHTML = `
    <div class="item-header">
      <span class="item-badge secret-badge">S</span>
      <input type="text" class="item-name" placeholder="secret-name" value="${name}" />
      <button class="btn-icon btn-remove-item" title="Remove">×</button>
    </div>
    <div class="item-fields">
      <div class="form-group" style="margin-bottom:8px;">
        <label>Type</label>
        <select class="secret-type-select">
          <option value="Opaque">Opaque</option>
          <option value="kubernetes.io/tls">kubernetes.io/tls</option>
          <option value="kubernetes.io/dockerconfigjson">kubernetes.io/dockerconfigjson (Image Pull)</option>
        </select>
      </div>
      <div class="secret-generic-fields">
        <label style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;display:block;">Data <span class="hint">(base64 encoded auto)</span></label>
        <div class="kv-list item-data-list"></div>
        <button class="btn btn-ghost btn-sm btn-add-item-kv">+ Add Entry</button>
      </div>
      <div class="secret-docker-fields" style="display:none;">
        <label style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;display:block;">🐳 Docker Registry Credentials</label>
        <div class="form-group" style="margin-bottom:8px;">
          <label>Registry Server</label>
          <input type="text" class="docker-server" placeholder="https://index.docker.io/v1/" value="https://index.docker.io/v1/" />
        </div>
        <div class="form-row">
          <div class="form-group" style="margin-bottom:8px;">
            <label>Username</label>
            <input type="text" class="docker-username" placeholder="username" />
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label>Password</label>
            <input type="password" class="docker-password" placeholder="password" />
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Email <span class="hint">(optional)</span></label>
          <input type="text" class="docker-email" placeholder="user@example.com" />
        </div>
      </div>
    </div>
  `;

  const typeSelect = div.querySelector('.secret-type-select');
  const genericFields = div.querySelector('.secret-generic-fields');
  const dockerFields = div.querySelector('.secret-docker-fields');

  function toggleSecretType() {
    const isDocker = typeSelect.value === 'kubernetes.io/dockerconfigjson';
    genericFields.style.display = isDocker ? 'none' : '';
    dockerFields.style.display = isDocker ? '' : 'none';
  }

  typeSelect.addEventListener('change', () => { toggleSecretType(); updatePreview(); });
  div.querySelector('.item-name').addEventListener('input', debounce(() => { refreshAllMountDropdowns(); refreshAllEnvDropdowns(); updatePreview(); }, 200));
  return div;
}
