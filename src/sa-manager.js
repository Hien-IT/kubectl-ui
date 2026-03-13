// ===== SA Manager Module =====
// Handles ServiceAccount management: Create, Delete, Update RBAC, Export Kubeconfig

let saInvoke = null;
let cachedNamespaces = [];

export function initSAManager(invoke) {
  saInvoke = invoke;
  initSidebar();
  initSAActions();
  initSAButtons();
}

export function reloadAllNamespaces() {
  loadNamespaces('sa-create-ns');
  loadNamespaces('sa-delete-ns');
  loadNamespaces('sa-update-ns');
  loadNamespaces('sa-export-ns');
}

// ===== Sidebar Navigation =====
function initSidebar() {
  document.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(`page-${page}`)?.classList.add('active');
      // Auto-load all namespace dropdowns when entering SA Manager
      if (page === 'sa-manager') {
        loadNamespaces('sa-create-ns');
        loadNamespaces('sa-delete-ns');
        loadNamespaces('sa-update-ns');
        loadNamespaces('sa-export-ns');
      }
    });
  });
}

// ===== SA Action Tabs =====
function initSAActions() {
  document.querySelectorAll('.sa-action-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.sa-action-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      document.querySelectorAll('.sa-form').forEach(f => f.classList.remove('active'));
      const formId = `sa-form-${card.dataset.action}`;
      document.getElementById(formId)?.classList.add('active');
    });
  });
}

// ===== Custom Confirm Dialog =====
function saConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <h3>⚠️ Xác nhận</h3>
        </div>
        <div class="modal-body" style="padding:16px;">
          <p style="margin:0;color:var(--text-primary);font-size:0.9rem;">${message}</p>
        </div>
        <div class="modal-footer" style="justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost btn-sm sa-confirm-no">Hủy</button>
          <button class="btn btn-danger btn-sm sa-confirm-yes">Xóa</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.sa-confirm-yes').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    overlay.querySelector('.sa-confirm-no').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
  });
}

// ===== Toast Helper (reuse from main app) =====
function showSAToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.className = 'toast', 3000);
}

// ===== Run kubectl via Tauri =====
async function kubectl(args, stdinInput = null) {
  if (!saInvoke) {
    showSAToast('kubectl chỉ khả dụng trong Tauri desktop app', 'error');
    return null;
  }
  try {
    const result = await saInvoke('run_kubectl', { args, stdinInput });
    if (!result.success) {
      showSAToast(result.stderr || 'Command failed', 'error');
    }
    return result;
  } catch (e) {
    showSAToast(`Error: ${e}`, 'error');
    return null;
  }
}

// ===== Duration normalize =====
function normalizeDuration(input) {
  const dMatch = input.match(/^(\d+)d$/);
  if (dMatch) return `${parseInt(dMatch[1]) * 24}h`;
  const wMatch = input.match(/^(\d+)w$/);
  if (wMatch) return `${parseInt(wMatch[1]) * 7 * 24}h`;
  return input;
}

// ===== Create NS Binding Row =====
function createNsBindingRow() {
  const div = document.createElement('div');
  div.className = 'sa-ns-row';
  const nsOptions = cachedNamespaces.map(ns => `<option value="${ns}">${ns}</option>`).join('');
  div.innerHTML = `
    <select class="sa-bind-ns">
      <option value="">-- Namespace --</option>
      ${nsOptions}
    </select>
    <select class="sa-bind-role">
      <option value="view">view</option>
      <option value="edit">edit</option>
      <option value="admin">admin</option>
    </select>
    <button class="btn-icon btn-remove-kv" title="Remove">×</button>
  `;
  return div;
}

// ===== Silent kubectl (no log spam) =====
async function kubectlSilent(args) {
  if (!saInvoke) return null;
  try {
    return await saInvoke('run_kubectl', { args, stdinInput: null });
  } catch { return null; }
}

// ===== Load Namespaces into dropdown =====
async function loadNamespaces(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const result = await kubectlSilent(['get', 'ns', '-o', 'jsonpath={.items[*].metadata.name}']);
  if (!result?.success) return;
  const nsList = result.stdout.trim().split(/\s+/).filter(Boolean);
  cachedNamespaces = nsList;
  const current = sel.value;
  sel.innerHTML = '<option value="">-- Chọn Namespace --</option>';
  nsList.forEach(ns => {
    const opt = document.createElement('option');
    opt.value = ns; opt.textContent = ns;
    if (ns === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ===== Load ServiceAccounts into dropdown =====
async function loadServiceAccounts(namespace, selectId) {
  const sel = document.getElementById(selectId);
  if (!sel || !namespace) {
    if (sel) sel.innerHTML = '<option value="">-- Chọn SA --</option>';
    return;
  }
  const result = await kubectlSilent(['get', 'sa', '-n', namespace, '-o', 'jsonpath={.items[*].metadata.name}']);
  if (!result?.success) return;
  const saList = result.stdout.trim().split(/\s+/).filter(Boolean);
  sel.innerHTML = '<option value="">-- Chọn SA --</option>';
  saList.forEach(sa => {
    const opt = document.createElement('option');
    opt.value = sa; opt.textContent = sa;
    sel.appendChild(opt);
  });
}

// ===== Button Handlers =====
function initSAButtons() {
  // Add NS binding buttons
  document.getElementById('sa-btn-add-ns-binding')?.addEventListener('click', () => {
    document.getElementById('sa-create-ns-list').appendChild(createNsBindingRow());
  });
  document.getElementById('sa-btn-add-ns-binding-update')?.addEventListener('click', () => {
    document.getElementById('sa-update-ns-list').appendChild(createNsBindingRow());
  });

  // Namespace dropdown → load SAs
  document.getElementById('sa-delete-ns')?.addEventListener('change', (e) => {
    loadServiceAccounts(e.target.value, 'sa-delete-name');
  });
  document.getElementById('sa-update-ns')?.addEventListener('change', (e) => {
    loadServiceAccounts(e.target.value, 'sa-update-name');
  });
  document.getElementById('sa-export-ns')?.addEventListener('change', (e) => {
    loadServiceAccounts(e.target.value, 'sa-export-name');
  });

  // === CREATE SA ===
  document.getElementById('sa-btn-create')?.addEventListener('click', async () => {
    const sa = document.getElementById('sa-create-name').value.trim();
    const ns = document.getElementById('sa-create-ns').value;
    if (!sa) { showSAToast('Vui lòng nhập SA name', 'error'); return; }
    if (!ns) { showSAToast('Vui lòng chọn Namespace', 'error'); return; }

    ;

    // Create namespace
    await kubectl(['create', 'ns', ns, '--dry-run=client', '-o', 'yaml'], null);
    const nsYaml = `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${ns}`;
    await kubectl(['apply', '-f', '-'], nsYaml);

    // Create SA
    const saYaml = `apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: ${sa}\n  namespace: ${ns}`;
    const r = await kubectl(['apply', '-f', '-'], saYaml);
    if (!r?.success) return;

    // Namespace role bindings
    await applyNsBindings(sa, ns, 'sa-create-ns-list');
    showSAToast('Hoàn thành!', 'success');
  });

  // === DELETE SA ===
  document.getElementById('sa-btn-delete')?.addEventListener('click', async () => {
    const sa = document.getElementById('sa-delete-name').value;
    const ns = document.getElementById('sa-delete-ns').value;
    if (!sa) { showSAToast('Vui lòng chọn SA', 'error'); return; }
    if (!ns) { showSAToast('Vui lòng chọn Namespace', 'error'); return; }

    const confirmed = await saConfirm(`Xác nhận xóa ServiceAccount "${sa}" trong namespace "${ns}"?`);
    if (!confirmed) return;

    ;

    // Delete legacy token
    await kubectl(['delete', 'secret', `${sa}-legacy-token`, '-n', ns, '--ignore-not-found']);
    // Delete SA
    await kubectl(['delete', 'sa', sa, '-n', ns, '--ignore-not-found']);

    showSAToast('Đã xóa ServiceAccount!', 'success');
    // Reload SA dropdown
    loadServiceAccounts(ns, 'sa-delete-name');
  });

  // === UPDATE RBAC ===
  document.getElementById('sa-btn-update')?.addEventListener('click', async () => {
    const sa = document.getElementById('sa-update-name').value;
    const ns = document.getElementById('sa-update-ns').value;
    if (!sa) { showSAToast('Vui lòng chọn SA', 'error'); return; }
    if (!ns) { showSAToast('Vui lòng chọn Namespace', 'error'); return; }

    ;

    // Apply new bindings
    await applyNsBindings(sa, ns, 'sa-update-ns-list');
    showSAToast('RBAC updated!', 'success');
  });

  // === EXPORT KUBECONFIG ===
  document.getElementById('sa-btn-export')?.addEventListener('click', async () => {
    const sa = document.getElementById('sa-export-name').value;
    const ns = document.getElementById('sa-export-ns').value;
    if (!sa) { showSAToast('Vui lòng chọn SA', 'error'); return; }
    if (!ns) { showSAToast('Vui lòng chọn Namespace', 'error'); return; }

    ;

    const tokenType = document.getElementById('sa-export-token-type').value;
    if (tokenType === 'expiring') {
      const dur = normalizeDuration(document.getElementById('sa-export-duration').value.trim() || '24h');
      const tokenResult = await kubectl(['create', 'token', sa, '-n', ns, `--duration=${dur}`]);
      if (tokenResult?.success) {
        await exportKubeconfig(sa, ns, tokenResult.stdout.trim(), `exp-${dur}`);
      }
    } else {
      const secretYaml = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: ${sa}-legacy-token\n  namespace: ${ns}\n  annotations:\n    kubernetes.io/service-account.name: ${sa}\ntype: kubernetes.io/service-account-token`;
      await kubectl(['apply', '-f', '-'], secretYaml);
      await new Promise(r => setTimeout(r, 2000));
      const tokenResult = await kubectl(['get', 'secret', `${sa}-legacy-token`, '-n', ns, '-o', 'jsonpath={.data.token}']);
      if (tokenResult?.success) {
        const token = atob(tokenResult.stdout.trim());
        await exportKubeconfig(sa, ns, token, 'legacy');
      }
    }
    showSAToast('Hoàn thành!', 'success');
  });
}

// ===== Apply Namespace Bindings =====
async function applyNsBindings(sa, saNamespace, listId) {
  const rows = document.querySelectorAll(`#${listId} .sa-ns-row`);
  for (const row of rows) {
    const bindNs = row.querySelector('.sa-bind-ns')?.value?.trim();
    const role = row.querySelector('.sa-bind-role')?.value || 'view';
    if (!bindNs) continue;

    // Create namespace if needed
    const nsYaml = `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${bindNs}`;
    await kubectl(['apply', '-f', '-'], nsYaml);

    // RoleBinding
    const rbYaml = `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${sa}-${role}
  namespace: ${bindNs}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${role}
subjects:
- kind: ServiceAccount
  name: ${sa}
  namespace: ${saNamespace}`;
    await kubectl(['apply', '-f', '-'], rbYaml);

    // Metrics reader role
    const metricsRoleYaml = `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: metrics-reader
  namespace: ${bindNs}
rules:
- apiGroups: ["metrics.k8s.io"]
  resources: ["pods"]
  verbs: ["get", "list"]`;
    await kubectl(['apply', '-f', '-'], metricsRoleYaml);

    // Metrics RoleBinding
    const metricsRbYaml = `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${sa}-metrics-reader
  namespace: ${bindNs}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: metrics-reader
subjects:
- kind: ServiceAccount
  name: ${sa}
  namespace: ${saNamespace}`;
    await kubectl(['apply', '-f', '-'], metricsRbYaml);

    showSAToast(`Gán ${role} + metrics-reader cho ${bindNs}`, 'success');
  }
}

// ===== Export Kubeconfig =====
async function exportKubeconfig(sa, ns, token, suffix) {
  // Get cluster info
  const clusterNameResult = await kubectl(['config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].name}']);
  const serverResult = await kubectl(['config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}']);
  const caResult = await kubectl(['config', 'view', '--raw', '--minify', '-o', 'jsonpath={.clusters[0].cluster.certificate-authority-data}']);

  if (!clusterNameResult?.success || !serverResult?.success) {
    showSAToast('Không thể lấy cluster info', 'error');
    return;
  }

  const clusterName = clusterNameResult.stdout.trim();
  const server = serverResult.stdout.trim();
  const ca = caResult?.stdout?.trim() || '';

  const kubeconfig = `apiVersion: v1
kind: Config
clusters:
- name: ${clusterName}
  cluster:
    server: ${server}
    certificate-authority-data: ${ca}
users:
- name: ${sa}
  user:
    token: ${token}
contexts:
- name: ${sa}@${clusterName}
  context:
    cluster: ${clusterName}
    user: ${sa}
    namespace: ${ns}
current-context: ${sa}@${clusterName}`;


  // Save file with dialog
  if (saInvoke) {
    const fileName = `${sa}-${ns}-${suffix}.kubeconfig`;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        defaultPath: fileName,
        filters: [{ name: 'Kubeconfig', extensions: ['kubeconfig', 'yaml', 'yml'] }]
      });
      if (filePath) {
        const result = await saInvoke('save_file', { path: filePath, content: kubeconfig });
        if (result.success) {
          showSAToast(`File saved: ${filePath}`, 'success');
        } else {
          showSAToast(result.stderr, 'error');
        }
      }
    } catch (e) {
      showSAToast(`Save error: ${e}`, 'error');
    }
  }

  // Also show in log
}
