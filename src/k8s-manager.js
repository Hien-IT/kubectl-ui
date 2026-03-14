// ===== K8s Resource Manager =====
// Lens-like resource browser, detail viewer, logs, and actions
import { createEditor, setEditorValue, getEditorValue, disposeEditor, focusEditor } from './yaml-editor.js';

let k8sInvoke = null;
let currentResource = 'pods';
let currentNs = '--all--';
let selectedItem = null;
let autoRefreshTimer = null;
let cachedItems = [];
let columnState = {}; // { resourceType: { order: [...], widths: {...} } }
const DETAIL_HEIGHT_KEY = 'k8s-detail-height';

// ===== Resource type metadata =====
const RESOURCE_META = {
  pods:                    { title:'Pods',            cols:['Name','Namespace','Status','Ready','Restarts','CPU','RAM','Age','Node'],   hasPodFeatures: true },
  deployments:             { title:'Deployments',     cols:['Name','Namespace','Ready','Up-to-date','Available','Age'],     scalable: true, restartable: true },
  statefulsets:            { title:'StatefulSets',    cols:['Name','Namespace','Ready','Age'],                              scalable: true, restartable: true },
  daemonsets:              { title:'DaemonSets',      cols:['Name','Namespace','Desired','Current','Ready','Age'],           restartable: true },
  replicasets:             { title:'ReplicaSets',     cols:['Name','Namespace','Desired','Current','Ready','Age'],           scalable: true },
  jobs:                    { title:'Jobs',            cols:['Name','Namespace','Completions','Duration','Age'] },
  cronjobs:                { title:'CronJobs',        cols:['Name','Namespace','Schedule','Suspend','Active','Last Schedule'] },
  services:                { title:'Services',        cols:['Name','Namespace','Type','Cluster-IP','Ports','Age'] },
  ingresses:               { title:'Ingresses',       cols:['Name','Namespace','Class','Hosts','Ports','Age'] },
  configmaps:              { title:'ConfigMaps',      cols:['Name','Namespace','Data','Age'] },
  secrets:                 { title:'Secrets',         cols:['Name','Namespace','Type','Data','Age'] },
  hpa:                     { title:'HPA',             cols:['Name','Namespace','Reference','Targets','MinPods','MaxPods','Replicas','Age'] },
  persistentvolumeclaims:  { title:'PVCs',            cols:['Name','Namespace','Status','Volume','Capacity','Access Modes','StorageClass','Age'] },
  nodes:                   { title:'Nodes',           cols:['Name','Status','Roles','Age','Version'],                       clusterScoped: true },
  namespaces:              { title:'Namespaces',      cols:['Name','Status','Age'],                                         clusterScoped: true },
};

// ===== Init =====
export function initK8sManager(invoke) {
  k8sInvoke = invoke;
  loadColumnState();
  initResourceNav();
  initToolbar();
  initDetailPanel();
}

// Called when entering K8s page from sidebar
export function activateK8sPage() {
  // Show loading state immediately in current frame
  const meta = RESOURCE_META[currentResource];
  if (meta) {
    document.getElementById('k8s-resource-title').textContent = meta.title;
    document.getElementById('k8s-table-body').innerHTML = `<tr><td colspan="${meta.cols.length}" class="k8s-empty"><span class="k8s-loading-spinner"></span> Loading ${meta.title.toLowerCase()}...</td></tr>`;
  }
  // Defer kubectl calls so browser paints loading state first
  setTimeout(() => {
    loadK8sNamespaces();
    fetchResources();
    // Start auto-refresh if checkbox is checked (default: on)
    if (!autoRefreshTimer && document.getElementById('k8s-auto-refresh-toggle')?.checked) {
      autoRefreshTimer = setInterval(fetchResources, 5000);
    }
  }, 16);
}

// ===== Resource type sidebar navigation =====
function initResourceNav() {
  document.querySelectorAll('.k8s-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.k8s-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentResource = btn.dataset.resource;
      closeDetail();
      showLoading();
      setTimeout(() => fetchResources(), 16);
    });
  });
}

// ===== Toolbar =====
function initToolbar() {
  document.getElementById('k8s-btn-refresh')?.addEventListener('click', () => {
    showLoading();
    setTimeout(() => fetchResources(), 16);
  });

  document.getElementById('k8s-ns-filter')?.addEventListener('change', (e) => {
    currentNs = e.target.value;
    showLoading();
    setTimeout(() => fetchResources(), 16);
  });

  document.getElementById('k8s-auto-refresh-toggle')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      autoRefreshTimer = setInterval(fetchResources, 5000);
    } else {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  });
}

// ===== Load namespace filter =====
let nsLoaded = false;
export async function loadK8sNamespaces() {
  if (!k8sInvoke || nsLoaded) return;
  const result = await k8sInvoke('run_kubectl', { args: ['get', 'ns', '-o', 'jsonpath={.items[*].metadata.name}'], stdinInput: null });
  if (!result?.success) return;
  nsLoaded = true;
  const nsList = result.stdout.trim().split(/\s+/).filter(Boolean);
  const sel = document.getElementById('k8s-ns-filter');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="--all--">All Namespaces</option>';
  nsList.forEach(ns => {
    const opt = document.createElement('option');
    opt.value = ns; opt.textContent = ns;
    if (ns === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ===== Show loading state =====
function showLoading() {
  const meta = RESOURCE_META[currentResource];
  if (!meta) return;
  document.getElementById('k8s-resource-title').textContent = meta.title;
  document.getElementById('k8s-table-body').innerHTML = `<tr><td colspan="${meta.cols.length}" class="k8s-empty"><span class="k8s-loading-spinner"></span> Loading ${meta.title.toLowerCase()}...</td></tr>`;
}

// ===== Fetch & render resources =====
let podMetrics = {}; // { "ns/name": { cpu, ram } }

async function fetchResources() {
  if (!k8sInvoke) return;
  const meta = RESOURCE_META[currentResource];
  if (!meta) return;

  const args = ['get', currentResource, '-o', 'wide', '--no-headers'];
  if (meta.clusterScoped || currentNs === '--all--') {
    if (!meta.clusterScoped) args.push('-A');
  } else {
    args.push('-n', currentNs);
  }

  const result = await k8sInvoke('run_kubectl', { args, stdinInput: null });

  if (!result?.success) {
    renderTable(meta, []);
    return;
  }

  const lines = result.stdout.trim().split('\n').filter(Boolean);
  cachedItems = lines.map(line => line.split(/\s+/));
  podMetrics = {}; // Reset metrics
  renderTable(meta, cachedItems);

  // Lazy-load metrics for pods (non-blocking, updates cells in-place)
  if (currentResource === 'pods') {
    lazyLoadMetrics();
  }
}

async function lazyLoadMetrics() {
  if (!k8sInvoke) return;
  const topArgs = ['top', 'pods', '--no-headers'];
  if (currentNs === '--all--') topArgs.push('-A');
  else topArgs.push('-n', currentNs);

  const result = await k8sInvoke('run_kubectl', { args: topArgs, stdinInput: null });
  if (!result?.success) return;

  podMetrics = {};
  result.stdout.trim().split('\n').filter(Boolean).forEach(line => {
    const parts = line.split(/\s+/);
    if (currentNs === '--all--' && parts.length >= 4) {
      podMetrics[`${parts[0]}/${parts[1]}`] = { cpu: parts[2], ram: parts[3] };
    } else if (parts.length >= 3) {
      podMetrics[parts[0]] = { cpu: parts[1], ram: parts[2] };
    }
  });

  // Update CPU/RAM cells in-place without re-rendering entire table
  const tbody = document.getElementById('k8s-table-body');
  const meta = RESOURCE_META['pods'];
  const order = getColOrder('pods', meta.cols);
  const orderedCols = order.map(i => meta.cols[i]);
  const cpuVi = orderedCols.indexOf('CPU');
  const ramVi = orderedCols.indexOf('RAM');

  tbody.querySelectorAll('.k8s-row').forEach(row => {
    const idx = parseInt(row.dataset.idx);
    const cols = cachedItems[idx];
    if (!cols) return;
    const podNs = currentNs === '--all--' ? cols[0] : currentNs;
    const podName = currentNs === '--all--' ? cols[1] : cols[0];
    const key = currentNs === '--all--' ? `${podNs}/${podName}` : podName;
    const m = podMetrics[key] || { cpu: '-', ram: '-' };

    const cells = row.querySelectorAll('td');
    if (cpuVi >= 0 && cells[cpuVi]) cells[cpuVi].innerHTML = metricBadge(m.cpu);
    if (ramVi >= 0 && cells[ramVi]) cells[ramVi].innerHTML = metricBadge(m.ram);
  });
}

// ===== Column state (localStorage) =====
const COL_STORAGE_KEY = 'k8s-col-state';

function loadColumnState() {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY);
    if (raw) columnState = JSON.parse(raw);
  } catch { columnState = {}; }
}

function saveColumnState() {
  try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(columnState)); } catch {}
}

function getColOrder(resource, defaultCols) {
  const state = columnState[resource];
  if (!state?.order) return defaultCols.map((c, i) => i);
  // Validate saved order matches current columns
  if (state.order.length !== defaultCols.length) return defaultCols.map((c, i) => i);
  return state.order;
}

function getColWidths(resource) {
  return columnState[resource]?.widths || {};
}

function setColOrder(resource, order) {
  if (!columnState[resource]) columnState[resource] = {};
  columnState[resource].order = order;
  saveColumnState();
}

function setColWidth(resource, colName, width) {
  if (!columnState[resource]) columnState[resource] = {};
  if (!columnState[resource].widths) columnState[resource].widths = {};
  columnState[resource].widths[colName] = width;
  saveColumnState();
}

// ===== Render table =====
function renderTable(meta, items) {
  const thead = document.getElementById('k8s-table-head');
  const tbody = document.getElementById('k8s-table-body');
  const table = thead.closest('table');
  document.getElementById('k8s-resource-count').textContent = items.length;

  const order = getColOrder(currentResource, meta.cols);
  const widths = getColWidths(currentResource);
  const orderedCols = order.map(i => meta.cols[i]);

  // Set table to fixed layout for column widths
  table.style.tableLayout = 'fixed';

  // Header with resize handles + drag attributes
  thead.innerHTML = '<tr>' + orderedCols.map((c, vi) => {
    const w = widths[c] ? `width:${widths[c]}px;` : '';
    return `<th draggable="true" data-col-idx="${order[vi]}" data-col-name="${c}" style="${w}position:relative;">${c}<span class="k8s-col-resize" data-vi="${vi}"></span></th>`;
  }).join('') + '</tr>';

  // Setup drag-to-reorder on headers
  setupColumnDragReorder(thead, order, meta);
  // Setup resize handles
  setupColumnResize(thead, orderedCols);

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${meta.cols.length}" class="k8s-empty">No ${meta.title.toLowerCase()} found</td></tr>`;
    return;
  }

  // Body — map kubectl wide output columns to our display
  tbody.innerHTML = items.map((cols, idx) => {
    // For pods, inject CPU/RAM from metrics between col index 4 (Restarts) and 5 (Age)
    // kubectl get pods -o wide cols: NAME READY STATUS RESTARTS AGE IP NODE ...
    // With -A: NAMESPACE NAME READY STATUS RESTARTS AGE IP NODE ...
    let displayCols;
    if (currentResource === 'pods') {
      const podName = cols[0];
      const podNs = currentNs === '--all--' ? cols[0] : currentNs;
      const resolvedName = currentNs === '--all--' ? cols[1] : cols[0];
      const key = currentNs === '--all--' ? `${podNs}/${resolvedName}` : resolvedName;
      const m = podMetrics[key] || { cpu: '-', ram: '-' };
      // kubectl -o wide columns can shift when RESTARTS contains spaces like "4 (4d9h ago)"
      // Use end-relative indexing: ..., AGE, IP, NODE, NOMINATED, READINESS
      // NODE = cols[len-3], AGE = cols[len-5]
      const node = cols[cols.length - 3] || '';
      const age = cols[cols.length - 5] || '';
      // Our cols: Name, Namespace, Status, Ready, Restarts, CPU, RAM, Age, Node
      if (currentNs === '--all--') {
        // -A: NAMESPACE NAME READY STATUS RESTARTS... AGE IP NODE NOMINATED READINESS
        displayCols = [cols[1], cols[0], cols[3], cols[2], cols[4], m.cpu, m.ram, age, node];
      } else {
        // single: NAME READY STATUS RESTARTS... AGE IP NODE NOMINATED READINESS
        displayCols = [cols[0], currentNs, cols[2], cols[1], cols[3], m.cpu, m.ram, age, node];
      }
    } else {
      displayCols = cols;
    }

    const cells = orderedCols.map((colName, vi) => {
      const origIdx = order[vi];
      const val = displayCols[origIdx] || '';
      // Status badge for pods
      if (currentResource === 'pods' && colName === 'Status') return `<td>${statusBadge(val)}</td>`;
      // CPU/RAM metric badges
      if (currentResource === 'pods' && (colName === 'CPU' || colName === 'RAM')) return `<td>${metricBadge(val)}</td>`;
      // Status badge for PVCs
      if (currentResource === 'persistentvolumeclaims' && colName === 'Status') return `<td>${statusBadge(val)}</td>`;
      // Status badge for nodes
      if (currentResource === 'nodes' && colName === 'Status') return `<td>${statusBadge(val)}</td>`;
      // Status for namespaces
      if (currentResource === 'namespaces' && colName === 'Status') return `<td>${statusBadge(val)}</td>`;
      return `<td>${escHtml(val)}</td>`;
    }).join('');
    return `<tr class="k8s-row" data-idx="${idx}">${cells}</tr>`;
  }).join('');

  // Row click → open detail
  tbody.querySelectorAll('.k8s-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx);
      const item = cachedItems[idx];
      if (!item) return;
      openDetail(item);
    });
  });
}

// ===== Column drag-to-reorder =====
function setupColumnDragReorder(thead, order, meta) {
  const ths = thead.querySelectorAll('th');
  let dragSrcIdx = null;

  ths.forEach((th, vi) => {
    th.addEventListener('dragstart', (e) => {
      // Don't start drag from resize handle
      if (e.target.classList.contains('k8s-col-resize')) { e.preventDefault(); return; }
      dragSrcIdx = vi;
      th.classList.add('k8s-col-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', vi.toString());
    });
    th.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      th.classList.add('k8s-col-dragover');
    });
    th.addEventListener('dragleave', () => {
      th.classList.remove('k8s-col-dragover');
    });
    th.addEventListener('drop', (e) => {
      e.preventDefault();
      th.classList.remove('k8s-col-dragover');
      const fromVi = parseInt(e.dataTransfer.getData('text/plain'));
      const toVi = vi;
      if (fromVi === toVi || isNaN(fromVi)) return;
      // Swap in order array
      const newOrder = [...order];
      const [moved] = newOrder.splice(fromVi, 1);
      newOrder.splice(toVi, 0, moved);
      setColOrder(currentResource, newOrder);
      renderTable(meta, cachedItems);
    });
    th.addEventListener('dragend', () => {
      th.classList.remove('k8s-col-dragging');
      ths.forEach(t => t.classList.remove('k8s-col-dragover'));
    });
  });
}

// ===== Column resize =====
function setupColumnResize(thead, orderedCols) {
  thead.querySelectorAll('.k8s-col-resize').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const th = handle.parentElement;
      const startX = e.clientX;
      const startW = th.offsetWidth;
      const vi = parseInt(handle.dataset.vi);
      const colName = orderedCols[vi];

      const onMouseMove = (ev) => {
        const newW = Math.max(40, startW + ev.clientX - startX);
        th.style.width = newW + 'px';
      };
      const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        const finalW = Math.max(40, startW + ev.clientX - startX);
        setColWidth(currentResource, colName, finalW);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}

// ===== Status badge =====
function statusBadge(status) {
  const s = status.toLowerCase();
  let cls = 'k8s-status-default';
  if (s === 'running' || s === 'active' || s === 'ready' || s === 'bound' || s === 'available') cls = 'k8s-status-running';
  else if (s === 'pending' || s === 'containercreating' || s === 'terminating') cls = 'k8s-status-pending';
  else if (s.includes('error') || s.includes('crash') || s.includes('fail') || s === 'evicted' || s === 'oomkilled') cls = 'k8s-status-error';
  else if (s === 'completed' || s === 'succeeded') cls = 'k8s-status-completed';
  else if (s === 'notready' || s.includes('notready')) cls = 'k8s-status-warning';
  return `<span class="k8s-status ${cls}">${escHtml(status)}</span>`;
}

// ===== Detail Panel =====
const TAB_LABELS = { yaml: '📄 YAML', describe: '📋 Describe', events: '⚡ Events', logs: '📜 Logs' };
let openTabs = []; // Array of open tab types
let activeBottomTab = null;

function initDetailPanel() {
  document.getElementById('k8s-btn-close-detail')?.addEventListener('click', closeDetail);

  // Open-tab toolbar buttons
  document.querySelectorAll('.k8s-open-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabType = btn.dataset.openTab;
      if (openTabs.includes(tabType)) {
        switchBottomTab(tabType);
      } else {
        addBottomTab(tabType);
      }
    });
  });

  // Action buttons
  document.getElementById('k8s-btn-delete')?.addEventListener('click', handleDelete);
  document.getElementById('k8s-btn-restart')?.addEventListener('click', handleRestart);
  document.getElementById('k8s-btn-scale')?.addEventListener('click', handleScale);
  document.getElementById('k8s-btn-fetch-logs')?.addEventListener('click', fetchLogs);
  document.getElementById('k8s-btn-goto-deploy')?.addEventListener('click', handleGotoDeploy);
  document.getElementById('k8s-btn-edit-yaml')?.addEventListener('click', handleEditYaml);
  document.getElementById('k8s-btn-apply-yaml')?.addEventListener('click', handleApplyYaml);
  document.getElementById('k8s-btn-cancel-edit')?.addEventListener('click', handleCancelEdit);
}

function addBottomTab(tabType) {
  if (openTabs.includes(tabType)) { switchBottomTab(tabType); return; }
  openTabs.push(tabType);
  renderBottomTabs();
  switchBottomTab(tabType);
  document.getElementById('k8s-bottom-panel').style.display = '';
  // Highlight toolbar button
  updateOpenTabBtnStates();
}

function removeBottomTab(tabType) {
  openTabs = openTabs.filter(t => t !== tabType);
  if (tabType === 'yaml') resetYamlEditor();
  if (openTabs.length === 0) {
    document.getElementById('k8s-bottom-panel').style.display = 'none';
    activeBottomTab = null;
  } else {
    if (activeBottomTab === tabType) {
      switchBottomTab(openTabs[openTabs.length - 1]);
    }
    renderBottomTabs();
  }
  updateOpenTabBtnStates();
}

function switchBottomTab(tabType) {
  activeBottomTab = tabType;
  renderBottomTabs();
  document.getElementById('k8s-logs-controls').style.display = tabType === 'logs' ? 'flex' : 'none';
  document.getElementById('k8s-yaml-actions').style.display = tabType === 'yaml' ? 'flex' : 'none';
  if (tabType !== 'yaml') resetYamlEditor();
  loadBottomTab(tabType);
}

function renderBottomTabs() {
  const container = document.getElementById('k8s-bottom-tabs');
  // Remove existing tab buttons (keep the tabs-right div)
  const rightDiv = container.querySelector('.k8s-bottom-tabs-right');
  container.querySelectorAll('.k8s-bottom-tab').forEach(el => el.remove());

  openTabs.forEach(tabType => {
    const btn = document.createElement('button');
    btn.className = `k8s-bottom-tab${tabType === activeBottomTab ? ' active' : ''}`;
    btn.dataset.btab = tabType;
    btn.innerHTML = `${TAB_LABELS[tabType] || tabType} <span class="tab-close">×</span>`;

    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        removeBottomTab(tabType);
      } else {
        switchBottomTab(tabType);
      }
    });

    container.insertBefore(btn, rightDiv);
  });
}

function updateOpenTabBtnStates() {
  document.querySelectorAll('.k8s-open-tab-btn').forEach(btn => {
    btn.classList.toggle('opened', openTabs.includes(btn.dataset.openTab));
  });
}

function setupDetailResize() {
  const detail = document.getElementById('k8s-detail');
  if (!detail) return;

  // Insert resize handle at top of detail panel
  const handle = document.createElement('div');
  handle.className = 'k8s-detail-resize-handle';
  detail.prepend(handle);

  // Restore saved height
  try {
    const savedH = localStorage.getItem(DETAIL_HEIGHT_KEY);
    if (savedH) detail.style.height = savedH + 'px';
  } catch {}

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = detail.offsetHeight;

    const onMouseMove = (ev) => {
      // Dragging up → increase height
      const newH = Math.max(150, Math.min(window.innerHeight * 0.8, startH - (ev.clientY - startY)));
      detail.style.height = newH + 'px';
      detail.style.maxHeight = 'none';
    };
    const onMouseUp = (ev) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const finalH = Math.max(150, Math.min(window.innerHeight * 0.8, startH - (ev.clientY - startY)));
      try { localStorage.setItem(DETAIL_HEIGHT_KEY, finalH); } catch {}
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function openDetail(item) {
  const meta = RESOURCE_META[currentResource];
  const name = (!meta.clusterScoped && currentNs === '--all--') ? item[1] : item[0];
  const ns = meta.clusterScoped ? '' : (currentNs === '--all--' ? item[0] : currentNs);

  selectedItem = { name, namespace: ns, resource: currentResource };

  // Show right panel with info
  document.getElementById('k8s-detail').style.display = '';
  document.getElementById('k8s-detail-badge').textContent = currentResource.toUpperCase().replace(/S$/, '');
  document.getElementById('k8s-detail-name').textContent = name;
  document.getElementById('k8s-detail-ns').textContent = ns ? `ns: ${ns}` : 'cluster-scoped';

  // Show/hide action buttons
  document.getElementById('k8s-btn-restart').style.display = meta.restartable ? '' : 'none';
  document.getElementById('k8s-btn-scale').style.display = meta.scalable ? '' : 'none';
  document.getElementById('k8s-btn-goto-deploy').style.display = (currentResource === 'pods') ? '' : 'none';
  document.getElementById('k8s-logs-tab').style.display = meta.hasPodFeatures ? '' : 'none';

  // Load info in right panel only — bottom panel stays as-is
  loadInfoTab();

  // If bottom panel is open, reload current tab for new item
  if (activeBottomTab && openTabs.length > 0) {
    loadBottomTab(activeBottomTab);
  }

  if (meta.hasPodFeatures) loadPodContainers();
}

function closeDetail() {
  document.getElementById('k8s-detail').style.display = 'none';
  document.getElementById('k8s-bottom-panel').style.display = 'none';
  openTabs = [];
  activeBottomTab = null;
  updateOpenTabBtnStates();
  resetYamlEditor();
  selectedItem = null;
}

// ===== Bottom panel tab content loading =====
async function loadBottomTab(tab) {
  if (!selectedItem || !k8sInvoke) return;
  const el = document.getElementById('k8s-detail-content');
  el.textContent = 'Loading...';

  const { name, namespace, resource } = selectedItem;
  const nsArgs = namespace ? ['-n', namespace] : [];
  let args;

  switch (tab) {
    case 'yaml':
      args = ['get', resource, name, ...nsArgs, '-o', 'yaml'];
      break;
    case 'describe':
      args = ['describe', resource, name, ...nsArgs];
      break;
    case 'events':
      args = ['get', 'events', ...nsArgs, '--field-selector', `involvedObject.name=${name}`, '--sort-by=.lastTimestamp'];
      break;
    case 'logs':
      fetchLogs();
      return;
    default:
      return;
  }

  const result = await k8sInvoke('run_kubectl', { args, stdinInput: null });
  if (result?.success) {
    el.textContent = result.stdout || '(empty)';
  } else {
    el.textContent = result?.stderr || 'Failed to fetch data';
  }
}

// ===== Lens-like Info tab =====
async function loadInfoTab() {
  if (!selectedItem || !k8sInvoke) return;
  const el = document.getElementById('k8s-detail-info-body');
  el.innerHTML = '<span class="k8s-loading-spinner"></span> Loading info...';

  const { name, namespace, resource } = selectedItem;
  const nsArgs = namespace ? ['-n', namespace] : [];

  const result = await k8sInvoke('run_kubectl', {
    args: ['get', resource, name, ...nsArgs, '-o', 'json'],
    stdinInput: null
  });

  if (!result?.success) {
    el.textContent = result?.stderr || 'Failed to fetch info';
    return;
  }

  let obj;
  try { obj = JSON.parse(result.stdout); } catch { el.textContent = 'Invalid JSON'; return; }

  const meta = obj.metadata || {};
  const spec = obj.spec || {};
  const status = obj.status || {};

  let html = '<div class="k8s-info-panel">';

  // ===== Properties Section =====
  html += '<div class="k8s-info-section"><div class="k8s-info-section-title">Properties</div>';
  html += infoRow('Created', meta.creationTimestamp ? timeAgo(meta.creationTimestamp) + ` (${meta.creationTimestamp})` : '-');
  html += infoRow('Name', meta.name || '-');
  if (meta.namespace) html += infoRow('Namespace', meta.namespace);

  // Labels
  if (meta.labels && Object.keys(meta.labels).length) {
    html += infoRow('Labels', Object.entries(meta.labels).map(([k,v]) => `<span class="k8s-info-badge">${k}: ${v}</span>`).join(' '));
  }

  // Annotations count
  if (meta.annotations) {
    html += infoRow('Annotations', `${Object.keys(meta.annotations).length} Annotations`);
  }

  // Owner references
  if (meta.ownerReferences?.length) {
    const owner = meta.ownerReferences[0];
    html += infoRow('Controlled By', `${owner.kind} <span class="k8s-info-link">${owner.name}</span>`);
  }

  // Resource-specific properties
  if (resource === 'pods') {
    html += infoRow('Status', `<span class="k8s-status k8s-status-${(status.phase||'').toLowerCase()}">${status.phase || '-'}</span>`);
    html += infoRow('Node', status.hostIP ? `<span class="k8s-info-link">${spec.nodeName || '-'}</span>` : '-');
    html += infoRow('Pod IP', status.podIP || '-');
    if (status.podIPs?.length > 1) html += infoRow('Pod IPs', status.podIPs.map(p => p.ip).join(', '));
    html += infoRow('Service Account', spec.serviceAccountName || '-');
    html += infoRow('QoS Class', status.qosClass || '-');
    html += infoRow('Restart Policy', spec.restartPolicy || '-');
    if (spec.nodeSelector) {
      html += infoRow('Node Selector', Object.entries(spec.nodeSelector).map(([k,v]) => `${k}: ${v}`).join(', '));
    }
    html += infoRow('DNS Policy', spec.dnsPolicy || '-');
  }

  if (resource === 'deployments' || resource === 'statefulsets') {
    html += infoRow('Replicas', `${status.readyReplicas || 0}/${spec.replicas || 0} ready`);
    html += infoRow('Strategy', spec.strategy?.type || spec.updateStrategy?.type || '-');
    if (spec.selector?.matchLabels) {
      html += infoRow('Selector', Object.entries(spec.selector.matchLabels).map(([k,v]) => `<span class="k8s-info-badge">${k}: ${v}</span>`).join(' '));
    }
  }

  if (resource === 'services') {
    html += infoRow('Type', spec.type || '-');
    html += infoRow('Cluster IP', spec.clusterIP || '-');
    if (spec.externalIPs?.length) html += infoRow('External IPs', spec.externalIPs.join(', '));
    if (spec.ports?.length) {
      html += infoRow('Ports', spec.ports.map(p => `${p.port}${p.targetPort ? '→' + p.targetPort : ''}/${p.protocol || 'TCP'}`).join(', '));
    }
    if (spec.selector) {
      html += infoRow('Selector', Object.entries(spec.selector).map(([k,v]) => `<span class="k8s-info-badge">${k}: ${v}</span>`).join(' '));
    }
  }

  html += '</div>';

  // ===== Conditions Section =====
  if (status.conditions?.length) {
    html += '<div class="k8s-info-section"><div class="k8s-info-section-title">Conditions</div>';
    html += '<div class="k8s-info-conditions">';
    status.conditions.forEach(c => {
      const ok = c.status === 'True';
      html += `<span class="k8s-info-condition ${ok ? 'ok' : 'fail'}">${c.type}</span>`;
    });
    html += '</div></div>';
  }

  // ===== Containers Section =====
  const containers = spec.containers || (spec.template?.spec?.containers) || [];
  if (containers.length) {
    html += '<div class="k8s-info-section"><div class="k8s-info-section-title">Containers</div>';
    containers.forEach(c => {
      html += `<div class="k8s-info-container">`;
      html += `<div class="k8s-info-container-name">🟢 ${c.name}</div>`;
      html += infoRow('Image', c.image || '-');
      if (c.ports?.length) {
        html += infoRow('Ports', c.ports.map(p => `${p.containerPort}/${p.protocol || 'TCP'}`).join(', '));
      }
      if (c.resources) {
        const req = c.resources.requests || {};
        const lim = c.resources.limits || {};
        if (Object.keys(req).length) html += infoRow('Requests', Object.entries(req).map(([k,v]) => `${k}: ${v}`).join(', '));
        if (Object.keys(lim).length) html += infoRow('Limits', Object.entries(lim).map(([k,v]) => `${k}: ${v}`).join(', '));
      }
      if (c.env?.length) {
        html += infoRow('Env', `${c.env.length} variables`);
      }
      if (c.volumeMounts?.length) {
        html += infoRow('Mounts', c.volumeMounts.map(m => `${m.name} → ${m.mountPath}`).join('<br>'));
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Container statuses (for pods)
  if (status.containerStatuses?.length) {
    html += '<div class="k8s-info-section"><div class="k8s-info-section-title">Container Status</div>';
    status.containerStatuses.forEach(cs => {
      const state = Object.keys(cs.state || {})[0] || 'unknown';
      html += `<div class="k8s-info-container">`;
      html += `<div class="k8s-info-container-name">${state === 'running' ? '🟢' : state === 'waiting' ? '🟡' : '🔴'} ${cs.name}</div>`;
      html += infoRow('State', state);
      html += infoRow('Ready', cs.ready ? '✅ Yes' : '❌ No');
      html += infoRow('Restarts', `${cs.restartCount || 0}`);
      html += infoRow('Image', cs.image || '-');
      html += '</div>';
    });
    html += '</div>';
  }

  // ===== Volumes Section =====
  const volumes = spec.volumes || (spec.template?.spec?.volumes) || [];
  if (volumes.length) {
    html += '<div class="k8s-info-section"><div class="k8s-info-section-title">Volumes</div>';
    volumes.forEach(v => {
      const type = Object.keys(v).filter(k => k !== 'name')[0] || 'unknown';
      html += infoRow(v.name, `<span class="k8s-info-badge">${type}</span>`);
    });
    html += '</div>';
  }

  // ===== Tolerations =====
  const tolerations = spec.tolerations || (spec.template?.spec?.tolerations) || [];
  if (tolerations.length) {
    html += '<div class="k8s-info-section"><div class="k8s-info-section-title">Tolerations</div>';
    tolerations.forEach(t => {
      html += infoRow(t.key || '*', `${t.operator || 'Equal'} ${t.value || ''} (${t.effect || 'all'})`);
    });
    html += '</div>';
  }

  html += '</div>';
  el.innerHTML = html;
}

function infoRow(label, value) {
  return `<div class="k8s-info-row"><span class="k8s-info-label">${label}</span><span class="k8s-info-value">${value}</span></div>`;
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h ago`;
  if (hours > 0) return `${hours}h ${mins}m ago`;
  return `${mins}m ago`;
}

// ===== Pod-specific features =====
async function loadPodContainers() {
  if (!selectedItem || !k8sInvoke) return;
  const { name, namespace } = selectedItem;
  const nsArgs = namespace ? ['-n', namespace] : [];

  const result = await k8sInvoke('run_kubectl', {
    args: ['get', 'pod', name, ...nsArgs, '-o', 'jsonpath={.spec.containers[*].name}'],
    stdinInput: null
  });

  const sel = document.getElementById('k8s-logs-container');
  sel.innerHTML = '';
  if (result?.success) {
    const containers = result.stdout.trim().split(/\s+/).filter(Boolean);
    containers.forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    });
  }
}

async function fetchLogs() {
  if (!selectedItem || !k8sInvoke) return;
  const el = document.getElementById('k8s-detail-content');
  el.textContent = 'Fetching logs...';

  const { name, namespace } = selectedItem;
  const container = document.getElementById('k8s-logs-container')?.value || '';
  const tail = document.getElementById('k8s-logs-tail')?.value || '200';
  const nsArgs = namespace ? ['-n', namespace] : [];
  const containerArgs = container ? ['-c', container] : [];
  const previous = document.getElementById('k8s-logs-previous')?.checked;
  const timestamps = document.getElementById('k8s-logs-timestamps')?.checked;
  const allContainers = document.getElementById('k8s-logs-all-containers')?.checked;

  // If all-containers, ignore single container selection
  const args = ['logs', name, ...nsArgs];
  if (allContainers) {
    args.push('--all-containers', '--prefix');
  } else if (container) {
    args.push('-c', container);
  }
  args.push(`--tail=${tail}`);
  if (previous) args.push('--previous');
  if (timestamps) args.push('--timestamps');
  const result = await k8sInvoke('run_kubectl', { args, stdinInput: null });

  if (result?.success) {
    el.textContent = result.stdout || '(no logs)';
    // Auto-scroll to bottom
    el.scrollTop = el.scrollHeight;
  } else {
    el.textContent = result?.stderr || 'Failed to fetch logs';
  }
}

// ===== YAML Edit & Apply =====
let monacoReady = false;

function resetYamlEditor() {
  document.getElementById('k8s-yaml-editor').style.display = 'none';
  document.getElementById('k8s-detail-content').style.display = '';
  document.getElementById('k8s-btn-edit-yaml').style.display = '';
  document.getElementById('k8s-btn-apply-yaml').style.display = 'none';
  document.getElementById('k8s-btn-cancel-edit').style.display = 'none';
}

function handleEditYaml() {
  const content = document.getElementById('k8s-detail-content');
  const editorContainer = document.getElementById('k8s-yaml-editor');
  content.style.display = 'none';
  editorContainer.style.display = '';
  document.getElementById('k8s-btn-edit-yaml').style.display = 'none';
  document.getElementById('k8s-btn-apply-yaml').style.display = '';
  document.getElementById('k8s-btn-cancel-edit').style.display = '';

  if (!monacoReady) {
    createEditor(editorContainer);
    monacoReady = true;
  }
  setEditorValue(content.textContent);
  focusEditor();
}

function handleCancelEdit() {
  resetYamlEditor();
}

async function handleApplyYaml() {
  if (!k8sInvoke) return;
  const yaml = getEditorValue();

  const toast = document.getElementById('toast');
  toast.textContent = 'Applying YAML...';
  toast.className = 'toast show';

  const result = await k8sInvoke('run_kubectl', { args: ['apply', '-f', '-'], stdinInput: yaml });

  if (result?.success) {
    toast.textContent = result.stdout?.trim() || 'Applied successfully';
    toast.className = 'toast success show';
    resetYamlEditor();
    loadBottomTab('yaml');
    fetchResources();
  } else {
    toast.textContent = result?.stderr || 'Apply failed';
    toast.className = 'toast error show';
  }
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== Go to Owner =====
const KIND_TO_RESOURCE = {
  Deployment: 'deployments',
  StatefulSet: 'statefulsets',
  DaemonSet: 'daemonsets',
  ReplicaSet: 'replicasets',
  Job: 'jobs',
  CronJob: 'cronjobs',
};

async function handleGotoDeploy() {
  if (!selectedItem || !k8sInvoke) return;
  const { name, namespace } = selectedItem;

  const toast = document.getElementById('toast');
  toast.textContent = 'Finding owner...';
  toast.className = 'toast show';

  // Get pod's owner references
  const nsArgs = namespace ? ['-n', namespace] : [];
  const result = await k8sInvoke('run_kubectl', {
    args: ['get', 'pod', name, ...nsArgs, '-o', 'jsonpath={.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}'],
    stdinInput: null
  });

  if (!result?.success || !result.stdout.includes('/')) {
    toast.textContent = 'No owner found';
    toast.className = 'toast error show';
    setTimeout(() => toast.classList.remove('show'), 2500);
    return;
  }

  let [ownerKind, ownerName] = result.stdout.split('/');

  // If owned by ReplicaSet, try to find Deployment parent
  if (ownerKind === 'ReplicaSet') {
    const rsResult = await k8sInvoke('run_kubectl', {
      args: ['get', 'rs', ownerName, ...nsArgs, '-o', 'jsonpath={.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}'],
      stdinInput: null
    });
    if (rsResult?.success && rsResult.stdout.includes('/')) {
      const [rsOwnerKind, rsOwnerName] = rsResult.stdout.split('/');
      if (KIND_TO_RESOURCE[rsOwnerKind]) {
        ownerKind = rsOwnerKind;
        ownerName = rsOwnerName;
      }
    }
  }

  toast.classList.remove('show');

  const resourceType = KIND_TO_RESOURCE[ownerKind];
  if (!resourceType || !RESOURCE_META[resourceType]) {
    toast.textContent = `Owner: ${ownerKind}/${ownerName} (unsupported view)`;
    toast.className = 'toast show';
    setTimeout(() => toast.classList.remove('show'), 3000);
    return;
  }

  // Switch to owner resource view
  currentResource = resourceType;
  document.querySelectorAll('.k8s-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.resource === resourceType);
  });
  showLoading();
  await fetchResources();

  // Open detail for this owner
  const meta = RESOURCE_META[resourceType];
  selectedItem = { name: ownerName, namespace, resource: resourceType };
  document.getElementById('k8s-detail').style.display = '';
  document.getElementById('k8s-detail-badge').textContent = ownerKind.toUpperCase();
  document.getElementById('k8s-detail-name').textContent = ownerName;
  document.getElementById('k8s-detail-ns').textContent = namespace ? `ns: ${namespace}` : 'cluster-scoped';
  document.getElementById('k8s-btn-restart').style.display = meta.restartable ? '' : 'none';
  document.getElementById('k8s-btn-scale').style.display = meta.scalable ? '' : 'none';
  document.getElementById('k8s-btn-goto-deploy').style.display = 'none';
  document.getElementById('k8s-logs-tab').style.display = meta.hasPodFeatures ? '' : 'none';

  loadInfoTab();
  addBottomTab('yaml');
}

// ===== Actions =====
// ===== Custom confirm modal =====
function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.getElementById('k8s-confirm-overlay');
    document.getElementById('k8s-confirm-msg').textContent = message;
    overlay.style.display = '';

    const ok = document.getElementById('k8s-confirm-ok');
    const cancel = document.getElementById('k8s-confirm-cancel');

    function cleanup(result) {
      overlay.style.display = 'none';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === overlay) cleanup(false); }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
  });
}

async function handleDelete() {
  if (!selectedItem || !k8sInvoke) return;
  const { name, namespace, resource } = selectedItem;

  const confirmed = await showConfirm(`Delete ${resource}/${name} in ${namespace || 'cluster'}?`);
  if (!confirmed) return;

  const toast = document.getElementById('toast');
  toast.textContent = `Deleting ${name}...`;
  toast.className = 'toast show';

  const nsArgs = namespace ? ['-n', namespace] : [];
  const result = await k8sInvoke('run_kubectl', { args: ['delete', resource, name, ...nsArgs, '--wait=false'], stdinInput: null });

  if (result?.success) {
    toast.textContent = `Deleted ${name}`;
    toast.className = 'toast success show';
    closeDetail();
    fetchResources();
  } else {
    toast.textContent = result?.stderr || 'Delete failed';
    toast.className = 'toast error show';
  }
  setTimeout(() => toast.classList.remove('show'), 2500);
}

async function handleRestart() {
  if (!selectedItem || !k8sInvoke) return;
  const { name, namespace, resource } = selectedItem;
  const nsArgs = namespace ? ['-n', namespace] : [];

  const result = await k8sInvoke('run_kubectl', {
    args: ['rollout', 'restart', resource, name, ...nsArgs],
    stdinInput: null
  });

  const toast = document.getElementById('toast');
  if (result?.success) {
    toast.textContent = `Restarted ${name}`;
    toast.className = 'toast success show';
    setTimeout(fetchResources, 1000);
  } else {
    toast.textContent = result?.stderr || 'Restart failed';
    toast.className = 'toast error show';
  }
  setTimeout(() => toast.classList.remove('show'), 2500);
}

async function handleScale() {
  if (!selectedItem || !k8sInvoke) return;
  const { name, namespace, resource } = selectedItem;
  const replicas = prompt(`Scale ${name} to how many replicas?`, '1');
  if (replicas === null) return;
  const num = parseInt(replicas);
  if (isNaN(num) || num < 0) return;

  const nsArgs = namespace ? ['-n', namespace] : [];
  const result = await k8sInvoke('run_kubectl', {
    args: ['scale', resource, name, `--replicas=${num}`, ...nsArgs],
    stdinInput: null
  });

  const toast = document.getElementById('toast');
  if (result?.success) {
    toast.textContent = `Scaled ${name} to ${num}`;
    toast.className = 'toast success show';
    setTimeout(fetchResources, 1000);
  } else {
    toast.textContent = result?.stderr || 'Scale failed';
    toast.className = 'toast error show';
  }
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== Helpers =====
function metricBadge(val) {
  if (!val || val === '-') return `<span class="k8s-metric k8s-metric-na">-</span>`;
  return `<span class="k8s-metric">${escHtml(val)}</span>`;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
