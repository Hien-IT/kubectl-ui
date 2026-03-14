// ===== K8s Resource Manager =====
// Lens-like resource browser, detail viewer, logs, and actions

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
function initDetailPanel() {
  document.getElementById('k8s-btn-close-detail')?.addEventListener('click', closeDetail);

  // Detail tab navigation
  document.querySelectorAll('.k8s-detail-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.k8s-detail-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const dtab = tab.dataset.dtab;
      document.getElementById('k8s-logs-controls').style.display = dtab === 'logs' ? 'flex' : 'none';
      loadDetailTab(dtab);
    });
  });

  // Delete button
  document.getElementById('k8s-btn-delete')?.addEventListener('click', handleDelete);
  document.getElementById('k8s-btn-restart')?.addEventListener('click', handleRestart);
  document.getElementById('k8s-btn-scale')?.addEventListener('click', handleScale);
  document.getElementById('k8s-btn-fetch-logs')?.addEventListener('click', fetchLogs);

  // Detail panel resize handle
  setupDetailResize();
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
  // For -A output: col[0]=NAMESPACE, col[1]=NAME. For single ns: col[0]=NAME
  const name = (!meta.clusterScoped && currentNs === '--all--') ? item[1] : item[0];
  const ns = meta.clusterScoped ? '' : (currentNs === '--all--' ? item[0] : currentNs);

  selectedItem = { name, namespace: ns, resource: currentResource };

  document.getElementById('k8s-detail').style.display = '';
  document.getElementById('k8s-detail-badge').textContent = currentResource.toUpperCase().replace(/S$/, '');
  document.getElementById('k8s-detail-name').textContent = name;
  document.getElementById('k8s-detail-ns').textContent = ns ? `ns: ${ns}` : 'cluster-scoped';

  // Show/hide action buttons based on resource type
  document.getElementById('k8s-btn-restart').style.display = meta.restartable ? '' : 'none';
  document.getElementById('k8s-btn-scale').style.display = meta.scalable ? '' : 'none';

  // Show logs tab only for pods
  document.getElementById('k8s-logs-tab').style.display = meta.hasPodFeatures ? '' : 'none';

  // Reset to YAML tab
  document.querySelectorAll('.k8s-detail-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.k8s-detail-tab[data-dtab="yaml"]').classList.add('active');
  document.getElementById('k8s-logs-controls').style.display = 'none';

  loadDetailTab('yaml');

  // If pods, populate container dropdown
  if (meta.hasPodFeatures) loadPodContainers();
}

function closeDetail() {
  document.getElementById('k8s-detail').style.display = 'none';
  selectedItem = null;
}

// ===== Detail tab content loading =====
async function loadDetailTab(tab) {
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

// ===== Actions =====
async function handleDelete() {
  if (!selectedItem || !k8sInvoke) return;
  const { name, namespace, resource } = selectedItem;

  if (!confirm(`Delete ${resource}/${name} in ${namespace || 'cluster'}?`)) return;

  const nsArgs = namespace ? ['-n', namespace] : [];
  const result = await k8sInvoke('run_kubectl', { args: ['delete', resource, name, ...nsArgs], stdinInput: null });

  const toast = document.getElementById('toast');
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
