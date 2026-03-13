import './style.css';
import { getAllYaml } from './generators.js';
import { initSAManager } from './sa-manager.js';

// ===== Tauri API (lazy loaded) =====
let invoke = null;

async function initTauri() {
  try {
    const tauriCore = await import('@tauri-apps/api/core');
    invoke = tauriCore.invoke;
    console.log('Tauri API loaded');
    return true;
  } catch (e) {
    console.log('Running in browser mode (no Tauri)');
    return false;
  }
}

// ===== State =====
let currentPreviewTab = 'all';
let generatedFiles = {};
let isTauri = false;

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', async () => {
  isTauri = await initTauri();
  
  initTabs();
  initFormListeners();
  initDynamicLists();
  initResourceItemLists();
  initActions();
  initTlsToggle();
  initModal();
  updatePreview();
  initSAManager(invoke);
  initNamespaceDropdown();
  
  if (isTauri) {
    loadContexts();
    loadYamlNamespaces();
  } else {
    const ctxSelect = document.getElementById('kubectl-context');
    ctxSelect.innerHTML = '<option>Browser Mode</option>';
    document.getElementById('context-status').classList.add('error');
  }
});

// ===== Kubectl Context =====
async function loadContexts() {
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

document.getElementById('kubectl-context')?.addEventListener('change', async (e) => {
  if (!invoke || !isTauri) return;
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
    } else {
      showToast(`Failed: ${result.stderr}`, 'error');
      statusEl.classList.add('error');
    }
  } catch (e) {
    showToast('Failed to switch context', 'error');
  }
});

// ===== Tab Navigation =====
function initTabs() {
  const tabs = document.querySelectorAll('#resource-tabs .tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function switchToTab(tabName) {
  document.querySelectorAll('#resource-tabs .tab').forEach(t => t.classList.remove('active'));
  const targetTab = document.querySelector(`#resource-tabs .tab[data-tab="${tabName}"]`);
  if (targetTab) targetTab.classList.add('active');
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.add('active');
}

// ===== Get names of created PVC/ConfigMap/Secret items =====
function getPvcNames() {
  const names = [];
  document.querySelectorAll('#pvc-items-list .resource-item').forEach(item => {
    const name = item.querySelector('.item-name')?.value?.trim();
    if (name) names.push(name);
  });
  return names;
}

function getConfigMapNames() {
  const names = [];
  document.querySelectorAll('#configmap-items-list .resource-item').forEach(item => {
    const name = item.querySelector('.item-name')?.value?.trim();
    if (name) names.push(name);
  });
  return names;
}

function getSecretNames() {
  const names = [];
  document.querySelectorAll('#secret-items-list .resource-item').forEach(item => {
    const name = item.querySelector('.item-name')?.value?.trim();
    if (name) names.push(name);
  });
  return names;
}

// ===== Collect Form Config =====
function collectConfig() {
  const labels = {};
  document.querySelectorAll('#labels-list .kv-row').forEach(row => {
    const key = row.querySelector('.kv-key')?.value?.trim();
    const value = row.querySelector('.kv-value')?.value?.trim();
    if (key) labels[key] = value || '';
  });

  const appName = document.getElementById('app-name').value.trim() || 'my-app';
  const selectorLabels = { app: appName, ...labels };

  const containerPorts = [];
  document.querySelectorAll('#container-ports .port-row').forEach(row => {
    const name = row.querySelector('.port-name')?.value?.trim() || 'http';
    const port = parseInt(row.querySelector('.port-number')?.value) || 80;
    const protocol = row.querySelector('.port-protocol')?.value || 'TCP';
    containerPorts.push({ name, port, protocol });
  });

  // imagePullSecrets
  const imagePullSecrets = [];
  document.querySelectorAll('#image-pull-secrets-list .pull-secret-row').forEach(row => {
    const name = row.querySelector('.pullsecret-ref-select')?.value || '';
    if (name) imagePullSecrets.push(name);
  });

  const envVars = [];
  document.querySelectorAll('#env-vars-list .env-var-row').forEach(row => {
    const key = row.querySelector('.env-name')?.value?.trim();
    const source = row.querySelector('.env-source')?.value || 'value';
    if (!key) return;
    if (source === 'value') {
      envVars.push({ key, source: 'value', value: row.querySelector('.env-value')?.value?.trim() || '' });
    } else {
      const refName = row.querySelector('.env-ref-select')?.value || '';
      const refKey = row.querySelector('.env-ref-key')?.value?.trim() || key;
      envVars.push({ key, source, refName, refKey });
    }
  });

  // envFrom — import all keys from ConfigMap/Secret
  const envFrom = [];
  document.querySelectorAll('#env-from-list .env-from-row').forEach(row => {
    const type = row.querySelector('.envfrom-type')?.value || 'configmap';
    const refName = row.querySelector('.envfrom-ref-select')?.value || '';
    const prefix = row.querySelector('.envfrom-prefix')?.value?.trim() || '';
    if (refName) envFrom.push({ type, refName, prefix });
  });

  // Collect multiple service items
  const serviceItems = [];
  document.querySelectorAll('#service-items-list .resource-item').forEach(item => {
    const ports = [];
    item.querySelectorAll('.svc-port-row').forEach(row => {
      ports.push({
        name: row.querySelector('.svc-port-name')?.value?.trim() || 'http',
        port: parseInt(row.querySelector('.svc-port-port')?.value) || 80,
        targetPort: parseInt(row.querySelector('.svc-port-target')?.value) || 80,
        nodePort: parseInt(row.querySelector('.svc-port-nodeport')?.value) || null,
        protocol: row.querySelector('.svc-port-protocol')?.value || 'TCP'
      });
    });
    serviceItems.push({
      name: item.querySelector('.item-name')?.value?.trim() || '',
      type: item.querySelector('.svc-type-select')?.value || 'ClusterIP',
      ports
    });
  });

  const ingressRules = [];
  document.querySelectorAll('#ingress-rules .ingress-rule').forEach(rule => {
    const host = rule.querySelector('.ingress-host')?.value?.trim() || '';
    const paths = [];
    rule.querySelectorAll('.ingress-path-row').forEach(pathRow => {
      paths.push({
        path: pathRow.querySelector('.ingress-path')?.value?.trim() || '/',
        pathType: pathRow.querySelector('.ingress-path-type')?.value || 'Prefix',
        serviceName: pathRow.querySelector('.ingress-svc-name')?.value || '',
        servicePort: parseInt(pathRow.querySelector('.ingress-svc-port')?.value) || 80
      });
    });
    ingressRules.push({ host, paths });
  });

  const ingressAnnotations = {};
  document.querySelectorAll('#ingress-annotations-list .kv-row').forEach(row => {
    const key = row.querySelector('.kv-key')?.value?.trim();
    const value = row.querySelector('.kv-value')?.value?.trim();
    if (key) ingressAnnotations[key] = value || '';
  });

  const tlsHosts = [];
  document.querySelectorAll('#tls-hosts-list .kv-row .kv-key').forEach(input => {
    const val = input.value?.trim();
    if (val) tlsHosts.push(val);
  });

  // Collect multiple PVC items
  const pvcItems = [];
  document.querySelectorAll('#pvc-items-list .resource-item').forEach(item => {
    pvcItems.push({
      name: item.querySelector('.item-name')?.value?.trim() || '',
      storageClass: item.querySelector('.pvc-storage-class')?.value?.trim() || '',
      accessMode: item.querySelector('.pvc-access-mode')?.value || 'ReadWriteOnce',
      storageSize: item.querySelector('.pvc-storage-size')?.value?.trim() || '1Gi'
    });
  });

  // Collect multiple ConfigMap items
  const configMapItems = [];
  document.querySelectorAll('#configmap-items-list .resource-item').forEach(item => {
    const data = [];
    item.querySelectorAll('.kv-row').forEach(row => {
      const key = row.querySelector('.kv-key')?.value?.trim();
      const value = row.querySelector('.kv-value')?.value?.trim();
      if (key) data.push({ key, value: value || '' });
    });
    configMapItems.push({
      name: item.querySelector('.item-name')?.value?.trim() || '',
      data
    });
  });

  // Collect multiple Secret items
  const secretItems = [];
  document.querySelectorAll('#secret-items-list .resource-item').forEach(item => {
    const type = item.querySelector('.secret-type-select')?.value || 'Opaque';
    const name = item.querySelector('.item-name')?.value?.trim() || '';
    
    if (type === 'kubernetes.io/dockerconfigjson') {
      secretItems.push({
        name, type,
        dockerServer: item.querySelector('.docker-server')?.value?.trim() || '',
        dockerUsername: item.querySelector('.docker-username')?.value?.trim() || '',
        dockerPassword: item.querySelector('.docker-password')?.value?.trim() || '',
        dockerEmail: item.querySelector('.docker-email')?.value?.trim() || '',
        data: []
      });
    } else {
      const data = [];
      item.querySelectorAll('.secret-generic-fields .kv-row').forEach(row => {
        const key = row.querySelector('.kv-key')?.value?.trim();
        const value = row.querySelector('.kv-value')?.value?.trim();
        if (key) data.push({ key, value: value || '' });
      });
      secretItems.push({ name, type, data });
    }
  });

  // Volume mounts
  const volumeMounts = [];
  document.querySelectorAll('#volume-mounts .mount-row').forEach(row => {
    const name = row.querySelector('.mount-name')?.value?.trim();
    const mountPath = row.querySelector('.mount-path')?.value?.trim();
    const type = row.querySelector('.mount-type')?.value || 'pvc';
    const subPath = row.querySelector('.mount-subpath')?.value?.trim() || '';
    const refName = row.querySelector('.mount-ref-select')?.value || '';
    if (name && mountPath) {
      volumeMounts.push({ name, mountPath, type, subPath, refName });
    }
  });

  return {
    appName,
    namespace: getNamespace(),
    createNamespace: document.getElementById('namespace').value === '__create__',
    labels: selectorLabels,
    selectorLabels: { app: appName },
    enableDeployment: document.getElementById('enable-deployment').checked,
    image: document.getElementById('image').value.trim() || 'nginx:latest',
    imagePullPolicy: document.getElementById('image-pull-policy').value,
    replicas: parseInt(document.getElementById('replicas').value) || 1,
    containerPorts, envVars,
    cpuRequest: document.getElementById('cpu-request').value.trim(),
    cpuLimit: document.getElementById('cpu-limit').value.trim(),
    memRequest: document.getElementById('mem-request').value.trim(),
    memLimit: document.getElementById('mem-limit').value.trim(),
    volumeMounts, envFrom, imagePullSecrets,
    enableInitPermissions: document.getElementById('enable-init-permissions').checked,
    scRunAsUser: document.getElementById('sc-run-as-user').value.trim(),
    scRunAsGroup: document.getElementById('sc-run-as-group').value.trim(),
    scFsGroup: document.getElementById('sc-fs-group').value.trim(),
    scRunAsNonRoot: document.getElementById('sc-run-as-nonroot').checked,
    scReadOnlyRoot: document.getElementById('sc-readonly-root').checked,
    nodeSelector: (() => {
      const ns = {};
      document.querySelectorAll('#node-selector-list .kv-row').forEach(row => {
        const k = row.querySelector('.kv-key')?.value?.trim();
        const v = row.querySelector('.kv-value')?.value?.trim();
        if (k) ns[k] = v || '';
      });
      return ns;
    })(),
    enableLiveness: document.getElementById('enable-liveness').checked,
    livenessType: document.getElementById('liveness-type').value,
    livenessPath: document.getElementById('liveness-path').value.trim(),
    livenessPort: document.getElementById('liveness-port').value.trim(),
    livenessTcpPort: document.getElementById('liveness-tcp-port').value.trim(),
    livenessExecCmd: document.getElementById('liveness-exec-cmd').value.trim(),
    livenessDelay: document.getElementById('liveness-delay').value.trim(),
    livenessPeriod: document.getElementById('liveness-period').value.trim(),
    enableReadiness: document.getElementById('enable-readiness').checked,
    readinessType: document.getElementById('readiness-type').value,
    readinessPath: document.getElementById('readiness-path').value.trim(),
    readinessPort: document.getElementById('readiness-port').value.trim(),
    readinessTcpPort: document.getElementById('readiness-tcp-port').value.trim(),
    readinessExecCmd: document.getElementById('readiness-exec-cmd').value.trim(),
    readinessDelay: document.getElementById('readiness-delay').value.trim(),
    readinessPeriod: document.getElementById('readiness-period').value.trim(),
    enableService: document.getElementById('enable-service').checked,
    serviceItems,
    enableIngress: document.getElementById('enable-ingress').checked,
    ingressClass: document.getElementById('ingress-class').value.trim(),
    ingressRules, ingressAnnotations,
    ingressTls: document.getElementById('ingress-tls').checked,
    tlsSecret: document.getElementById('tls-secret').value.trim(),
    tlsHosts,
    enablePvc: document.getElementById('enable-pvc').checked,
    pvcItems,
    enableConfigMap: document.getElementById('enable-configmap').checked,
    configMapItems,
    enableSecret: document.getElementById('enable-secret').checked,
    secretItems,
    enableHpa: document.getElementById('enable-hpa').checked,
    hpaMin: parseInt(document.getElementById('hpa-min').value) || 1,
    hpaMax: parseInt(document.getElementById('hpa-max').value) || 5,
    hpaCpu: document.getElementById('hpa-cpu').value.trim(),
    hpaMemory: document.getElementById('hpa-memory').value.trim()
  };
}

// ===== Form Listeners =====
function initFormListeners() {
  document.querySelector('.tab-content').addEventListener('input', debounce(updatePreview, 150));
  document.querySelector('.tab-content').addEventListener('change', debounce(updatePreview, 150));
}

// ===== Dynamic Lists =====
function initDynamicLists() {
  document.querySelectorAll('.btn-add-kv').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const row = createKvRow();
      target.appendChild(row);
      row.querySelector('.kv-key').focus();
      updatePreview();
    });
  });

  document.querySelectorAll('.btn-add-single').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const row = createSingleRow();
      target.appendChild(row);
      row.querySelector('.kv-key').focus();
      updatePreview();
    });
  });

  document.getElementById('btn-add-node-selector').addEventListener('click', () => {
    document.getElementById('node-selector-list').appendChild(createKvRow());
    updatePreview();
  });

  document.querySelectorAll('.btn-add-port').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      target.appendChild(createPortRow());
      updatePreview();
    });
  });

  document.getElementById('btn-add-service').addEventListener('click', () => {
    const count = document.querySelectorAll('#service-items-list .resource-item').length;
    const appName = document.getElementById('app-name').value.trim() || 'my-app';
    const name = count === 0 ? appName : `${appName}-svc-${count + 1}`;
    document.getElementById('service-items-list').appendChild(createServiceItem(name));
    refreshIngressServiceDropdowns();
    updatePreview();
  });

  document.getElementById('btn-add-ingress-rule').addEventListener('click', () => {
    document.getElementById('ingress-rules').appendChild(createIngressRule());
    updatePreview();
  });

  document.getElementById('btn-add-mount').addEventListener('click', () => {
    document.getElementById('volume-mounts').appendChild(createMountRow());
    updatePreview();
  });

  document.getElementById('btn-add-env').addEventListener('click', () => {
    document.getElementById('env-vars-list').appendChild(createEnvRow());
    updatePreview();
  });

  document.getElementById('btn-add-envfrom').addEventListener('click', () => {
    document.getElementById('env-from-list').appendChild(createEnvFromRow());
    updatePreview();
  });

  document.getElementById('btn-add-pull-secret').addEventListener('click', () => {
    document.getElementById('image-pull-secrets-list').appendChild(createPullSecretRow());
    updatePreview();
  });

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
    if (e.target.classList.contains('btn-add-ingress-path')) {
      const container = e.target.previousElementSibling;
      container.appendChild(createIngressPathRow());
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

// ===== Resource Item Lists (PVC, ConfigMap, Secret) =====
function initResourceItemLists() {
  document.getElementById('btn-add-pvc').addEventListener('click', () => {
    const appName = document.getElementById('app-name').value.trim() || 'my-app';
    const idx = document.querySelectorAll('#pvc-items-list .resource-item').length;
    const name = idx === 0 ? `${appName}-data` : `${appName}-data-${idx + 1}`;
    document.getElementById('pvc-items-list').appendChild(createPvcItem(name));
    document.getElementById('enable-pvc').checked = true;
    updatePreview();
    refreshAllMountDropdowns();
  });

  document.getElementById('btn-add-configmap').addEventListener('click', () => {
    const appName = document.getElementById('app-name').value.trim() || 'my-app';
    const idx = document.querySelectorAll('#configmap-items-list .resource-item').length;
    const name = idx === 0 ? `${appName}-config` : `${appName}-config-${idx + 1}`;
    document.getElementById('configmap-items-list').appendChild(createConfigMapItem(name));
    document.getElementById('enable-configmap').checked = true;
    updatePreview();
    refreshAllMountDropdowns();
    refreshAllEnvDropdowns();
  });

  document.getElementById('btn-add-secret').addEventListener('click', () => {
    const appName = document.getElementById('app-name').value.trim() || 'my-app';
    const idx = document.querySelectorAll('#secret-items-list .resource-item').length;
    const name = idx === 0 ? `${appName}-secret` : `${appName}-secret-${idx + 1}`;
    document.getElementById('secret-items-list').appendChild(createSecretItem(name));
    document.getElementById('enable-secret').checked = true;
    updatePreview();
    refreshAllMountDropdowns();
    refreshAllEnvDropdowns();
  });
}

// ===== PVC Item Creator =====
function createPvcItem(name) {
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
  // Update mount dropdowns when name changes
  div.querySelector('.item-name').addEventListener('input', debounce(() => { refreshAllMountDropdowns(); updatePreview(); }, 200));
  return div;
}

// ===== ConfigMap Item Creator =====
function createConfigMapItem(name) {
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

// ===== Service Item Creator =====
function createServiceItem(name) {
  const div = document.createElement('div');
  div.className = 'resource-item';
  div.innerHTML = `
    <div class="item-header">
      <span class="item-badge" style="background:rgba(96,165,250,0.15);color:#60a5fa;">SVC</span>
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
      <label style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;display:block;">Ports</label>
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

function createSvcPortRow() {
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

// ===== Secret Item Creator =====
function createSecretItem(name) {
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

// ===== Row Creators =====
function createKvRow() {
  const div = document.createElement('div');
  div.className = 'kv-row';
  div.innerHTML = `<input type="text" placeholder="key" class="kv-key" /><input type="text" placeholder="value" class="kv-value" /><button class="btn-icon btn-remove-kv" title="Remove">×</button>`;
  return div;
}

function createSingleRow() {
  const div = document.createElement('div');
  div.className = 'kv-row single';
  div.innerHTML = `<input type="text" placeholder="value" class="kv-key" /><button class="btn-icon btn-remove-kv" title="Remove">×</button>`;
  return div;
}

function createPortRow() {
  const div = document.createElement('div');
  div.className = 'port-row';
  div.innerHTML = `<input type="text" placeholder="Name" class="port-name" /><input type="number" placeholder="Port" class="port-number" /><select class="port-protocol"><option value="TCP">TCP</option><option value="UDP">UDP</option></select><button class="btn-icon btn-remove-port" title="Remove">×</button>`;
  return div;
}

function createIngressRule() {
  const div = document.createElement('div');
  div.className = 'ingress-rule';
  div.innerHTML = `<div class="mount-header"><span>Rule</span><button class="btn-icon btn-remove-ingress-rule" title="Remove">×</button></div><div class="form-group" style="margin-top:8px;"><label>Host</label><input type="text" placeholder="example.com" class="ingress-host" /></div><div class="ingress-paths"><div class="ingress-path-row"><input type="text" placeholder="Path" value="/" class="ingress-path" /><select class="ingress-path-type"><option value="Prefix">Prefix</option><option value="Exact">Exact</option><option value="ImplementationSpecific">ImplementationSpecific</option></select><select class="ingress-svc-name"><option value="">-- Service --</option></select><input type="number" placeholder="Port" value="80" class="ingress-svc-port" /><button class="btn-icon btn-remove-ingress-path" title="Remove">×</button></div></div><button class="btn btn-ghost btn-add-ingress-path">+ Add Path</button>`;
  setTimeout(() => refreshIngressServiceDropdowns(), 0);
  return div;
}

function createIngressPathRow() {
  const div = document.createElement('div');
  div.className = 'ingress-path-row';
  div.innerHTML = `<input type="text" placeholder="Path" value="/" class="ingress-path" /><select class="ingress-path-type"><option value="Prefix">Prefix</option><option value="Exact">Exact</option><option value="ImplementationSpecific">ImplementationSpecific</option></select><select class="ingress-svc-name"><option value="">-- Service --</option></select><input type="number" placeholder="Port" value="80" class="ingress-svc-port" /><button class="btn-icon btn-remove-ingress-path" title="Remove">×</button>`;
  setTimeout(() => refreshIngressServiceDropdowns(), 0);
  return div;
}

// ===== Env Var Row with Source Type =====
function createEnvRow() {
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

function populateEnvRefDropdown(selectEl, source) {
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

function refreshAllEnvDropdowns() {
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
  // Also refresh imagePullSecrets dropdowns
  document.querySelectorAll('#image-pull-secrets-list .pull-secret-row').forEach(row => {
    const refSelect = row.querySelector('.pullsecret-ref-select');
    if (refSelect) populateEnvRefDropdown(refSelect, 'secret');
  });
}

// ===== imagePullSecrets Row =====
function createPullSecretRow() {
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

// ===== Mount Row with Dropdown =====
function createEnvFromRow() {
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
  
  // Initial populate
  updateEnvFromType();
  return div;
}

// ===== Mount Row with Dropdown =====
function createMountRow() {
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
  
  // Initial populate
  updateMountUI();

  return div;
}

function populateMountDropdown(selectEl, type) {
  const currentVal = selectEl.value;
  let names = [];
  if (type === 'pvc') names = getPvcNames();
  else if (type === 'configmap') names = getConfigMapNames();
  else if (type === 'secret') names = getSecretNames();

  selectEl.innerHTML = '<option value="">-- Select --</option>' + 
    names.map(n => `<option value="${n}" ${n === currentVal ? 'selected' : ''}>${n}</option>`).join('');
  
  // If previous value still exists, keep it
  if (currentVal && names.includes(currentVal)) {
    selectEl.value = currentVal;
  } else if (names.length > 0 && !currentVal) {
    selectEl.value = names[0]; // auto-select first
  }
}

function refreshAllMountDropdowns() {
  document.querySelectorAll('#volume-mounts .mount-row').forEach(row => {
    const type = row.querySelector('.mount-type')?.value;
    const refSelect = row.querySelector('.mount-ref-select');
    if (type && type !== 'emptyDir' && refSelect) {
      populateMountDropdown(refSelect, type);
    }
  });
}

// ===== Service Type Toggle =====
function refreshIngressServiceDropdowns() {
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

// ===== TLS Toggle =====
function initTlsToggle() {
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

// ===== Preview Update =====
function updatePreview() {
  const config = collectConfig();
  generatedFiles = getAllYaml(config);
  updatePreviewTabs();
  updateResourceTabIndicators(config);
  renderCurrentPreview();
}

function updatePreviewTabs() {
  const container = document.getElementById('preview-tabs');
  const fileNames = Object.keys(generatedFiles);
  
  let html = `<button class="preview-tab ${currentPreviewTab === 'all' ? 'active' : ''}" data-file="all">📄 All Files</button>`;
  for (const name of fileNames) {
    html += `<button class="preview-tab ${currentPreviewTab === name ? 'active' : ''}" data-file="${name}">${getFileIcon(name)} ${name}</button>`;
  }
  container.innerHTML = html;
  
  container.querySelectorAll('.preview-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentPreviewTab = tab.dataset.file;
      container.querySelectorAll('.preview-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderCurrentPreview();
    });
  });
  
  if (currentPreviewTab !== 'all' && !generatedFiles[currentPreviewTab]) {
    currentPreviewTab = 'all';
  }
}

function getFileIcon(name) {
  const icons = {
    'namespace.yaml': '🏷️', 'deployment.yaml': '🚀', 'service.yaml': '🔗',
    'ingress.yaml': '🌐', 'pvc.yaml': '💾', 'configmap.yaml': '⚙️',
    'secret.yaml': '🔐', 'hpa.yaml': '📊'
  };
  return icons[name] || '📄';
}

function updateResourceTabIndicators(config) {
  const tabMap = {
    'deployment': config.enableDeployment, 'service': config.enableService,
    'ingress': config.enableIngress, 'pvc': config.enablePvc,
    'configmap': config.enableConfigMap, 'secret': config.enableSecret, 'hpa': config.enableHpa
  };
  document.querySelectorAll('#resource-tabs .tab').forEach(tab => {
    const key = tab.dataset.tab;
    if (tabMap[key] !== undefined) tab.classList.toggle('has-content', tabMap[key]);
  });
}

function renderCurrentPreview() {
  const previewEl = document.getElementById('yaml-preview');
  if (currentPreviewTab === 'all') {
    const allYaml = Object.entries(generatedFiles)
      .map(([name, content]) => `# --- ${name} ---\n${content}`)
      .join('\n\n---\n\n');
    previewEl.innerHTML = highlightYaml(allYaml || '# No resources enabled\n# Toggle resource sections and fill in the details');
  } else {
    previewEl.innerHTML = highlightYaml(generatedFiles[currentPreviewTab] || '# No content');
  }
}

// ===== YAML Syntax Highlighting =====
function highlightYaml(yaml) {
  return yaml.split('\n').map(line => {
    if (line.trim().startsWith('#')) return `<span class="yaml-comment">${escapeHtml(line)}</span>`;
    const kvMatch = line.match(/^(\s*)([\w\-./]+):\s*(.*)$/);
    if (kvMatch) {
      const [, indent, key, value] = kvMatch;
      let fv = '';
      if (value) {
        if (value.startsWith('"') || value.startsWith("'")) fv = `<span class="yaml-string">${escapeHtml(value)}</span>`;
        else if (value === 'true' || value === 'false') fv = `<span class="yaml-bool">${value}</span>`;
        else if (value === 'null' || value === '~') fv = `<span class="yaml-null">${value}</span>`;
        else if (/^\d+$/.test(value)) fv = `<span class="yaml-number">${value}</span>`;
        else fv = `<span class="yaml-value">${escapeHtml(value)}</span>`;
      }
      return `${escapeHtml(indent)}<span class="yaml-key">${escapeHtml(key)}</span>: ${fv}`;
    }
    const listMatch = line.match(/^(\s*-\s*)(.*)$/);
    if (listMatch) return `${escapeHtml(listMatch[1])}<span class="yaml-value">${escapeHtml(listMatch[2])}</span>`;
    if (line.trim() === '---') return `<span class="yaml-comment">${line}</span>`;
    return escapeHtml(line);
  }).join('\n');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Modal =====
function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('terminal-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modal-copy-output').addEventListener('click', () => {
    const text = document.getElementById('terminal-output').innerText;
    navigator.clipboard.writeText(text).then(() => showToast('Output copied!', 'success'));
  });
}

function showModal(title) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('terminal-output').innerHTML = '<div class="terminal-line loading"><span class="terminal-spinner">⠋</span> Running...</div>';
  document.getElementById('modal-status').textContent = '';
  document.getElementById('modal-status').className = 'modal-status loading';
  document.getElementById('terminal-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('terminal-modal').style.display = 'none';
}

function setModalResult(result, commandText) {
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

// ===== Namespace Dropdown =====
function getNamespace() {
  const sel = document.getElementById('namespace');
  if (sel.value === '__create__') {
    return document.getElementById('namespace-new').value.trim() || 'default';
  }
  return sel.value || 'default';
}

function initNamespaceDropdown() {
  const sel = document.getElementById('namespace');
  const newInput = document.getElementById('namespace-new');
  sel?.addEventListener('change', () => {
    newInput.style.display = sel.value === '__create__' ? 'block' : 'none';
    updatePreview();
  });
  newInput?.addEventListener('input', () => updatePreview());
}

async function loadYamlNamespaces() {
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

// ===== Kubectl Apply =====
async function applyAllFiles() {
  if (!invoke) { showToast('kubectl apply chỉ khả dụng trong Tauri desktop app', 'error'); return; }
  const files = Object.entries(generatedFiles);
  if (files.length === 0) { showToast('Không có resource nào được bật', 'error'); return; }
  const namespace = getNamespace();

  const fileDetails = files.map(([name, content]) => {
    const lines = content.split('\n').length;
    return `📄 ${name} (${lines} dòng)`;
  }).join('\n');

  const confirmed = await showConfirmModal(
    `kubectl apply -n ${namespace}`,
    `Sẽ apply ${files.length} file(s) vào namespace "${namespace}":\n\n${fileDetails}`,
    'Apply'
  );
  if (!confirmed) return;

  showModal(`kubectl apply (${files.length} files)`);
  try {
    const result = await invoke('save_and_apply_files', { files: generatedFiles, namespace });
    setModalResult(result, `kubectl apply -f ./manifests/ -n ${namespace}`);
    if (result.success) showToast(`Applied ${files.length} resources successfully!`, 'success');
  } catch (e) {
    setModalResult({ success: false, stdout: '', stderr: `Error: ${e}` }, 'kubectl apply');
  }
}

async function applyCurrentFile() {
  if (!invoke) { showToast('kubectl apply chỉ khả dụng trong Tauri desktop app', 'error'); return; }
  const yaml = getCurrentYaml();
  if (!yaml) { showToast('Không có YAML nào để apply', 'error'); return; }
  const namespace = getNamespace();
  const fileName = currentPreviewTab === 'all' ? 'all resources' : currentPreviewTab;
  const lines = yaml.split('\n').length;

  const confirmed = await showConfirmModal(
    `kubectl apply -n ${namespace}`,
    `Sẽ apply:\n\n📄 ${fileName} (${lines} dòng)`,
    'Apply'
  );
  if (!confirmed) return;

  showModal(`kubectl apply — ${fileName}`);
  try {
    const result = await invoke('apply_yaml', { yaml, namespace });
    setModalResult(result, `kubectl apply -f ${fileName} -n ${namespace}`);
    if (result.success) showToast('Applied successfully!', 'success');
  } catch (e) {
    setModalResult({ success: false, stdout: '', stderr: `Error: ${e}` }, 'kubectl apply');
  }
}

// ===== Confirm Modal =====
function showConfirmModal(title, detail, actionLabel = 'OK') {
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

// ===== Actions =====
function initActions() {
  document.getElementById('btn-copy').addEventListener('click', () => {
    const yaml = getCurrentYaml();
    if (!yaml) return;
    navigator.clipboard.writeText(yaml);
  });

  document.getElementById('btn-download').addEventListener('click', () => {
    if (currentPreviewTab === 'all') {
      downloadFile('k8s-manifests.yaml', getCurrentYaml());
    } else {
      const yaml = generatedFiles[currentPreviewTab];
      if (yaml) downloadFile(currentPreviewTab, yaml);
    }
    showToast('File downloaded!', 'success');
  });

  document.getElementById('btn-download-all').addEventListener('click', async () => {
    const files = Object.entries(generatedFiles);
    if (files.length === 0) { showToast('No resources enabled', 'error'); return; }

    const fileDetails = files.map(([name, content]) => {
      const lines = content.split('\n').length;
      return `📄 ${name} (${lines} dòng)`;
    }).join('\n');

    const appName = document.getElementById('app-name').value.trim() || 'my-app';
    const confirmed = await showConfirmModal(
      `Download All`,
      `Sẽ tải ${files.length} file(s) thành 1 file "${appName}-k8s.yaml":\n\n${fileDetails}`,
      'Download'
    );
    if (!confirmed) return;

    const combined = files.map(([name, content]) => `# --- ${name} ---\n${content}`).join('\n\n---\n\n');
    downloadFile(`${appName}-k8s.yaml`, combined);
    showToast(`Downloaded ${files.length} resources!`, 'success');
  });

  document.getElementById('btn-apply-all').addEventListener('click', applyAllFiles);
  document.getElementById('btn-apply-current').addEventListener('click', applyCurrentFile);
}

function getCurrentYaml() {
  if (currentPreviewTab === 'all') {
    return Object.entries(generatedFiles)
      .map(([name, content]) => `# --- ${name} ---\n${content}`)
      .join('\n\n---\n\n');
  }
  return generatedFiles[currentPreviewTab] || '';
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== Toast =====
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== Utility =====
function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}
