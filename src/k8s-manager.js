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
const DETAIL_WIDTH_KEY = 'k8s-detail-width';
const COL_LOCK_KEY = 'k8s-col-lock';
let colLockEnabled = (() => { try { return localStorage.getItem(COL_LOCK_KEY) !== 'false'; } catch { return true; } })();

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
  persistentvolumeclaims:  { title:'PVCs',            cols:['Name','Namespace','Status','Pods','Capacity','Access Modes','StorageClass','Age'] },
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

// Called when context is switched — reload namespaces + resources
export function reloadK8sOnContextSwitch() {
  if (!k8sInvoke) return;
  closeAllPanels();
  nsLoaded = false;
  currentNs = '--all--';
  const sel = document.getElementById('k8s-ns-filter');
  if (sel) sel.value = '--all--';
  showLoading();
  setTimeout(() => {
    loadK8sNamespaces(true);
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
      closeAllPanels();
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

  // Column lock toggle
  const lockBtn = document.getElementById('k8s-col-lock-toggle');
  if (lockBtn) {
    // Restore saved state on init
    lockBtn.classList.toggle('active', colLockEnabled);
    updateLockIcon(lockBtn, colLockEnabled);

    lockBtn.addEventListener('click', () => {
      colLockEnabled = !colLockEnabled;
      try { localStorage.setItem(COL_LOCK_KEY, colLockEnabled); } catch {}
      lockBtn.classList.toggle('active', colLockEnabled);
      lockBtn.title = colLockEnabled ? 'Column widths locked (fixed table)' : 'Column widths unlocked (scrollable)';
      updateLockIcon(lockBtn, colLockEnabled);
      // Re-render table with new layout mode
      if (cachedItems && cachedItems.length) {
        const meta = RESOURCE_META[currentResource];
        if (meta) renderTable(meta, cachedItems);
      }
    });
  }
}

function updateLockIcon(btn, locked) {
  if (locked) {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  } else {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0110 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
}

// ===== Load namespace filter =====
let nsLoaded = false;
export async function loadK8sNamespaces(force = false) {
  if (!k8sInvoke) return;
  if (!force && nsLoaded) return;
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
  
  if (currentResource === 'persistentvolumeclaims') {
    lazyLoadPvcPods();
  }
}

let pvcToPodsMap = {};

async function lazyLoadPvcPods() {
  if (!k8sInvoke) return;
  
  // Use jsonpath to only fetch namespace, pod name, and pvc claims to massively reduce payload and parsing time
  const topArgs = [
    'get', 'pods', '-A', 
    '-o', 'jsonpath={range .items[*]}{.metadata.namespace}{"\\t"}{.metadata.name}{"\\t"}{range .spec.volumes[*]}{.persistentVolumeClaim.claimName}{","}{end}{"\\n"}{end}'
  ];

  const result = await k8sInvoke('run_kubectl', { args: topArgs, stdinInput: null });
  if (!result?.success) return;

  try {
    pvcToPodsMap = {};
    const lines = result.stdout.split('\n');
    lines.forEach(line => {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const podNs = parts[0];
        const podName = parts[1];
        const claimsStr = parts[2];
        
        if (claimsStr) {
          const claims = claimsStr.split(',').filter(Boolean);
          claims.forEach(claimName => {
            const key = `${podNs}/${claimName}`;
            if (!pvcToPodsMap[key]) pvcToPodsMap[key] = [];
            pvcToPodsMap[key].push(podName);
          });
        }
      }
    });
  } catch (e) {
    console.error("Failed to parse pods mapping", e);
    return;
  }

  // Update table in place
  const tbody = document.getElementById('k8s-table-body');
  const meta = RESOURCE_META['persistentvolumeclaims'];
  const order = getColOrder('persistentvolumeclaims', meta.cols);
  const orderedCols = order.map(i => meta.cols[i]);
  const podsColVi = orderedCols.indexOf('Pods');

  if (podsColVi >= 0) {
    tbody.querySelectorAll('.k8s-row').forEach(row => {
      const idx = parseInt(row.dataset.idx);
      const cols = cachedItems[idx];
      if (!cols) return;
      
      const pvcNs = currentNs === '--all--' ? cols[0] : currentNs;
      const pvcName = currentNs === '--all--' ? cols[1] : cols[0];
      const key = `${pvcNs}/${pvcName}`;
      
      const pods = pvcToPodsMap[key] || [];
      const podsHtml = pods.length > 0 ? pods.join(', ') : '-';
      
      const cells = row.querySelectorAll('td');
      if (cells[podsColVi]) {
        cells[podsColVi].innerHTML = escHtml(podsHtml);
      }
    });
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

  // Table layout
  table.style.tableLayout = 'fixed';
  table.style.width = '100%';
  table.style.minWidth = '';

  // Header with resize handles + drag attributes
  thead.innerHTML = '<tr>' + orderedCols.map((c, vi) => {
    const w = widths[c] ? `width:${widths[c]}px;` : '';
    return `<th draggable="true" data-col-idx="${order[vi]}" data-col-name="${c}" style="${w}position:relative;">${c}<span class="k8s-col-resize" data-vi="${vi}"></span></th>`;
  }).join('') + '</tr>';

  // When unlocked: after browser paints, freeze all column pixel widths
  // then switch table to auto width so it can grow beyond container
  if (!colLockEnabled) {
    requestAnimationFrame(() => {
      const ths = thead.querySelectorAll('th');
      ths.forEach(t => { t.style.width = t.offsetWidth + 'px'; });
      table.style.width = 'max-content';
    });
  }

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
    const cells = orderedCols.map((colName, vi) => {
      let val = '';
      const origIdx = order[vi];
      if (currentResource === 'pods') {
        const podName = cols[0];
        const podNs = currentNs === '--all--' ? cols[0] : currentNs;
        const resolvedName = currentNs === '--all--' ? cols[1] : cols[0];
        const key = currentNs === '--all--' ? `${podNs}/${resolvedName}` : resolvedName;
        const m = podMetrics[key] || { cpu: '-', ram: '-' };
        const node = cols[cols.length - 3] || '';
        const age = cols[cols.length - 5] || '';
        if (currentNs === '--all--') {
          // -A: NAMESPACE NAME READY STATUS RESTARTS... AGE IP NODE NOMINATED READINESS
          const podCols = [cols[1], cols[0], cols[3], cols[2], cols[4], m.cpu, m.ram, age, node];
          val = podCols[order[vi]] || '';
        } else {
          // single: NAME READY STATUS RESTARTS... AGE IP NODE NOMINATED READINESS
          const podCols = [cols[0], currentNs, cols[2], cols[1], cols[3], m.cpu, m.ram, age, node];
          val = podCols[order[vi]] || '';
        }
      } else {
        // Other resources mapping
        // kubectl get -A usually returns: NAMESPACE, NAME, ...
        // We want display: NAME, NAMESPACE, ...
        if (currentNs === '--all--' && meta.cols[1] === 'Namespace') {
          if (origIdx === 0) val = cols[1]; // Name
          else if (origIdx === 1) val = cols[0]; // Namespace
          else val = cols[origIdx] || '';
        } else {
          val = cols[origIdx] || '';
        }
      }
      // Or show from cache if already loaded. Also handle shifted indexes for Capacity, Access Modes, Storageclass, Age
      if (currentResource === 'persistentvolumeclaims') {
        const pvcNs = currentNs === '--all--' ? cols[0] : currentNs;
        const pvcName = currentNs === '--all--' ? cols[1] : cols[0];
        const pvcKey = `${pvcNs}/${pvcName}`;
        
        // Find index of 'Pods' in the defined cols array for PVC (which replaced 'Volume')
        const podsColIndex = meta.cols.indexOf('Pods');
        
        if (origIdx === podsColIndex) {
          // This is the Pods column, replace with our custom data
          if (pvcToPodsMap && pvcToPodsMap[pvcKey]) {
             val = pvcToPodsMap[pvcKey].join(', ');
          } else {
             val = '-';
          }
        } else if (origIdx > podsColIndex) {
           // Output format:
           // -n: NAME STATUS VOLUME CAPACITY ACCESS_MODES STORAGECLASS AGE VOLUMEMODE
           // -A: NAMESPACE NAME STATUS VOLUME CAPACITY ACCESS_MODES STORAGECLASS (7) AGE (8) VOLUMEMODE (9)
           // If origIdx > podsColIndex, it means it's Capacity, Access Modes, StorageClass, or Age.
           // Notice that "ACCESS_MODES" (e.g. RWO) is a single word without spaces.
           // However "VolumeMode" is added at the end of kubectl output in modern k8s!
           // This means our meta.cols length is shorter than kubectl output length.
           // So for Age (the last column in our meta), we should fetch the second to last from kubectl cols
           if (colName === 'Age') {
             val = cols[cols.length - 2] || '';
           } else {
             // For Capacity (4), Access Modes (5), StorageClass (6)
             // The offset matches since we skipped Pods (3) and want Volume (3) -> mapped 1:1 in index
             val = cols[origIdx] || '';
           }
        }
      }

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

    let isSelected = false;
    if (selectedItem && selectedItem.resource === currentResource) {
      const rowNs = currentNs === '--all--' ? cols[0] : (RESOURCE_META[currentResource].clusterScoped ? '' : currentNs);
      const rowName = (!RESOURCE_META[currentResource].clusterScoped && currentNs === '--all--') ? cols[1] : cols[0];
      if (selectedItem.name === rowName && selectedItem.namespace === rowNs) {
        isSelected = true;
      }
    }
    return `<tr class="k8s-row${isSelected ? ' selected' : ''}" data-idx="${idx}">${cells}</tr>`;
  }).join('');

  // Row click → open detail + highlight
  tbody.querySelectorAll('.k8s-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx);
      const item = cachedItems[idx];
      if (!item) return;
      // Highlight selected row
      tbody.querySelectorAll('.k8s-row.selected').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
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
const TAB_LABELS = {
  yaml: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2"/><path d="M14 2v6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> YAML',
  events: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Events',
  logs: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Logs'
};

let openTabs = []; // Array of tab objects: { id, type, resource, namespace, name, label }
let activeBottomTabId = null;
let logsPollTimer = null;
let ansiUp = null;

if (typeof AnsiUp !== 'undefined') {
  ansiUp = new AnsiUp();
}

function initDetailPanel() {
  document.getElementById('k8s-btn-close-detail')?.addEventListener('click', closeRightPanel);
  document.getElementById('k8s-btn-close-bottom')?.addEventListener('click', closeBottomPanel);

  document.getElementById('k8s-btn-open-yaml')?.addEventListener('click', () => {
    if (!selectedItem) return;
    const tabId = `yaml_${selectedItem.resource}_${selectedItem.namespace}_${selectedItem.name}`;
    if (openTabs.find(t => t.id === tabId)) switchBottomTab(tabId);
    else addBottomTab('yaml', selectedItem);
  });
  document.getElementById('k8s-logs-tab')?.addEventListener('click', () => {
    if (!selectedItem) return;
    const tabId = `logs_${selectedItem.resource}_${selectedItem.namespace}_${selectedItem.name}`;
    if (openTabs.find(t => t.id === tabId)) switchBottomTab(tabId);
    else addBottomTab('logs', selectedItem);
  });

  // Action buttons
  document.getElementById('k8s-btn-delete')?.addEventListener('click', handleDelete);
  document.getElementById('k8s-btn-restart')?.addEventListener('click', handleRestart);
  document.getElementById('k8s-btn-scale')?.addEventListener('click', handleScale);
  document.getElementById('k8s-btn-fetch-logs')?.addEventListener('click', fetchLogs);
  document.getElementById('k8s-btn-edit-yaml')?.addEventListener('click', handleEditYaml);
  document.getElementById('k8s-btn-apply-yaml')?.addEventListener('click', handleApplyYaml);
  document.getElementById('k8s-btn-cancel-edit')?.addEventListener('click', handleCancelEdit);

  // Log action buttons
  ['k8s-logs-timestamps-btn', 'k8s-logs-previous-btn', 'k8s-logs-follow-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('active');
      if (id === 'k8s-logs-follow-btn') {
        const isFollow = e.currentTarget.classList.contains('active');
        if (isFollow) {
          fetchLogs(); // immediate fetch
          if (!logsPollTimer) logsPollTimer = setInterval(() => fetchLogs(true), 3000);
        } else {
          clearInterval(logsPollTimer);
          logsPollTimer = null;
        }
      } else {
        fetchLogs();
      }
    });
  });

  document.getElementById('k8s-logs-wrap-btn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.classList.toggle('active');
    const content = document.getElementById('k8s-detail-content');
    if (btn.classList.contains('active')) {
      content.style.whiteSpace = 'pre-wrap';
    } else {
      content.style.whiteSpace = 'pre';
    }
  });

  document.getElementById('k8s-logs-download-btn')?.addEventListener('click', () => {
    const content = document.getElementById('k8s-detail-content').textContent;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${selectedItem?.name || 'unknown'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Log search
  document.getElementById('k8s-logs-search-input')?.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase();
    const contentEl = document.getElementById('k8s-detail-content');
    if (!window._rawLogsContent) window._rawLogsContent = contentEl.textContent;
    
    if (!val) {
      contentEl.textContent = window._rawLogsContent;
      document.getElementById('k8s-logs-search-count').textContent = '0/0';
      return;
    }
    
    const lines = window._rawLogsContent.split('\n');
    const matching = lines.filter(l => l.toLowerCase().includes(val));
    contentEl.textContent = matching.join('\n');
    document.getElementById('k8s-logs-search-count').textContent = `${matching.length} matches`;
  });

  // Setup resize handles for right panel
  setupDetailResize();
}

function addBottomTab(tabType, itemContext) {
  if (!itemContext) return;
  const { resource, namespace, name } = itemContext;
  const tabId = `${tabType}_${resource}_${namespace}_${name}`;
  
  if (openTabs.find(t => t.id === tabId)) { 
    switchBottomTab(tabId); 
    return; 
  }

  const kindName = resource.charAt(0).toUpperCase() + resource.slice(1).replace(/s$/, '');
  const label = tabType === 'yaml' ? `YAML: ${name}` : `Logs: ${name}`;

  openTabs.push({
    id: tabId,
    type: tabType,
    resource: resource,
    namespace: namespace,
    name: name,
    label: label
  });

  renderBottomTabs();
  switchBottomTab(tabId);
  document.getElementById('k8s-bottom-panel').style.display = '';
  updateOpenTabBtnStates();
}

function removeBottomTab(tabId) {
  const tabToRemove = openTabs.find(t => t.id === tabId);
  if (!tabToRemove) return;

  openTabs = openTabs.filter(t => t.id !== tabId);
  if (tabToRemove.type === 'yaml' && activeBottomTabId === tabId) resetYamlEditor();
  
  if (openTabs.length === 0) {
    document.getElementById('k8s-bottom-panel').style.display = 'none';
    activeBottomTabId = null;
  } else {
    if (activeBottomTabId === tabId) {
      switchBottomTab(openTabs[openTabs.length - 1].id);
    } else {
      renderBottomTabs();
    }
  }
  updateOpenTabBtnStates();
}

function switchBottomTab(tabId) {
  activeBottomTabId = tabId;
  const tab = openTabs.find(t => t.id === tabId);
  if (!tab) return;

  renderBottomTabs();
  
  const isLogs = tab.type === 'logs';
  const isYaml = tab.type === 'yaml';
  
  document.getElementById('k8s-logs-controls').style.display = isLogs ? 'flex' : 'none';
  document.getElementById('k8s-yaml-actions').style.display = isYaml ? 'flex' : 'none';
  
  const toolbar = document.getElementById('k8s-bottom-toolbar');
  if (toolbar) toolbar.style.display = (isLogs || isYaml) ? 'flex' : 'none';
  
  if (isLogs) {
    const titleEl = document.getElementById('k8s-logs-tab-title');
    if (titleEl) {
      titleEl.innerHTML = `Displaying logs from Namespace: <span style="color:#6ab0f3;">${tab.namespace || 'default'}</span> for Pod: <span style="color:#6ab0f3;">${tab.name}</span>`;
    }
  }

  if (!isYaml) resetYamlEditor();
  loadBottomTab(tabId);
}

function renderBottomTabs() {
  const container = document.getElementById('k8s-bottom-tabs');
  container.innerHTML = '';

  openTabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = `k8s-bottom-tab${tab.id === activeBottomTabId ? ' active' : ''}`;
    btn.dataset.btab = tab.id;
    btn.title = `${tab.resource}/${tab.namespace ? tab.namespace + '/' : ''}${tab.name}`;
    const isYaml = tab.type === 'yaml';
    const iconSvg = isYaml 
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      
    btn.innerHTML = `${iconSvg} <span class="tab-text">${tab.resource === 'pods' ? 'Pod ' : ''}${tab.name}</span> <span class="tab-close"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        removeBottomTab(tab.id);
      } else {
        switchBottomTab(tab.id);
      }
    });

    container.appendChild(btn);
  });
}

function updateOpenTabBtnStates() {
  if (!selectedItem) {
    document.getElementById('k8s-btn-open-yaml')?.classList.remove('opened');
    document.getElementById('k8s-logs-tab')?.classList.remove('opened');
    return;
  }
  
  const yamlTabId = `yaml_${selectedItem.resource}_${selectedItem.namespace}_${selectedItem.name}`;
  const logsTabId = `logs_${selectedItem.resource}_${selectedItem.namespace}_${selectedItem.name}`;
  
  const btnYaml = document.getElementById('k8s-btn-open-yaml');
  if (btnYaml) {
    if (openTabs.find(t => t.id === yamlTabId)) btnYaml.classList.add('opened');
    else btnYaml.classList.remove('opened');
  }
  
  const btnLogs = document.getElementById('k8s-logs-tab');
  if (btnLogs) {
    if (openTabs.find(t => t.id === logsTabId)) btnLogs.classList.add('opened');
    else btnLogs.classList.remove('opened');
  }
}

function setupDetailResize() {
  // ----- Vertical resize handle (for bottom panel height) -----
  const bottomPanel = document.getElementById('k8s-bottom-panel');
  if (bottomPanel) {
    const handle = document.createElement('div');
    handle.className = 'k8s-detail-resize-handle'; // Use the vertical handle class
    bottomPanel.prepend(handle);

    // Restore saved height
    try {
      const savedH = localStorage.getItem(DETAIL_HEIGHT_KEY);
      if (savedH) bottomPanel.style.height = savedH + 'px';
    } catch {}

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = bottomPanel.offsetHeight;

      const onMouseMove = (ev) => {
        const newH = Math.max(150, Math.min(window.innerHeight * 0.8, startH - (ev.clientY - startY)));
        bottomPanel.style.height = newH + 'px';
        bottomPanel.style.maxHeight = 'none';
      };
      const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        const finalH = Math.max(150, Math.min(window.innerHeight * 0.8, startH - (ev.clientY - startY)));
        try { localStorage.setItem(DETAIL_HEIGHT_KEY, finalH); } catch {};
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ----- Horizontal resize handle (for right panel width) -----
  const detail = document.getElementById('k8s-detail');
  if (detail) {
    const hHandle = document.createElement('div');
  hHandle.className = 'k8s-detail-resize-h';
  detail.prepend(hHandle);

  // Restore saved width
  try {
    const savedW = localStorage.getItem(DETAIL_WIDTH_KEY);
    if (savedW) {
      detail.style.width = savedW + 'px';
      detail.style.maxWidth = 'none';
    }
  } catch {}

  hHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = detail.offsetWidth;

    const onMouseMove = (ev) => {
      // Dragging left → increase width
      const newW = Math.max(280, Math.min(window.innerWidth * 0.6, startW - (ev.clientX - startX)));
      detail.style.width = newW + 'px';
      detail.style.maxWidth = 'none';
    };
    const onMouseUp = (ev) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const finalW = Math.max(280, Math.min(window.innerWidth * 0.6, startW - (ev.clientX - startX)));
      try { localStorage.setItem(DETAIL_WIDTH_KEY, finalW); } catch {}
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
  }
}

function openDetail(item) {
  const meta = RESOURCE_META[currentResource];
  const name = (!meta.clusterScoped && currentNs === '--all--') ? item[1] : item[0];
  const ns = meta.clusterScoped ? '' : (currentNs === '--all--' ? item[0] : currentNs);

  selectedItem = { name, namespace: ns, resource: currentResource };

  // Show right panel with info
  document.getElementById('k8s-detail').style.display = '';
  
  // Format title like Lens: "Pod: name"
  const kindName = currentResource.charAt(0).toUpperCase() + currentResource.slice(1).replace(/s$/, '');
  document.getElementById('k8s-detail-name-full').textContent = `${kindName}: ${name}`;

  // Show/hide action buttons
  document.getElementById('k8s-btn-restart').style.display = meta.restartable ? '' : 'none';
  document.getElementById('k8s-btn-scale').style.display = meta.scalable ? '' : 'none';
  document.getElementById('k8s-logs-tab').style.display = meta.hasPodFeatures ? '' : 'none';

  // Load info in right panel only — bottom panel stays as-is
  loadInfoTab();

  // If bottom panel is open, do not auto-reload bottom tab, keep user where they are
  updateOpenTabBtnStates();

  if (meta.hasPodFeatures) loadPodContainers();
}

function closeRightPanel() {
  document.getElementById('k8s-detail').style.display = 'none';
  if (document.getElementById('k8s-bottom-panel').style.display === 'none') {
    selectedItem = null;
    document.querySelectorAll('.k8s-row.selected').forEach(r => r.classList.remove('selected'));
  }
}

function closeBottomPanel() {
  document.getElementById('k8s-bottom-panel').style.display = 'none';
  openTabs = [];
  activeBottomTabId = null;
  clearInterval(logsPollTimer);
  logsPollTimer = null;
  updateOpenTabBtnStates();
  resetYamlEditor();
  if (document.getElementById('k8s-detail').style.display === 'none') {
    selectedItem = null;
    document.querySelectorAll('.k8s-row.selected').forEach(r => r.classList.remove('selected'));
  }
}

function closeAllPanels() {
  document.getElementById('k8s-detail').style.display = 'none';
  document.getElementById('k8s-bottom-panel').style.display = 'none';
  openTabs = [];
  activeBottomTabId = null;
  clearInterval(logsPollTimer);
  logsPollTimer = null;
  updateOpenTabBtnStates();
  resetYamlEditor();
  selectedItem = null;
  document.querySelectorAll('.k8s-row.selected').forEach(r => r.classList.remove('selected'));
}

// ===== Bottom panel tab content loading =====
async function loadBottomTab(tabId) {
  const tab = openTabs.find(t => t.id === tabId);
  if (!tab || !k8sInvoke) return;
  
  const el = document.getElementById('k8s-detail-content');
  el.textContent = 'Loading...';

  const { name, namespace, resource, type } = tab;
  const nsArgs = namespace ? ['-n', namespace] : [];
  let args;

  switch (type) {
    case 'yaml':
      args = ['get', resource, name, ...nsArgs, '-o', 'yaml'];
      break;
    case 'events':
      args = ['get', 'events', ...nsArgs, '--field-selector', `involvedObject.name=${name}`, '--sort-by=.lastTimestamp'];
      break;
    case 'logs':
      const isFollow = document.getElementById('k8s-logs-follow-btn')?.classList.contains('active');
      fetchLogs();
      if (isFollow && !logsPollTimer) {
        logsPollTimer = setInterval(() => fetchLogs(true), 3000);
      }
      return;
    default:
      return;
  }

  const result = await k8sInvoke('run_kubectl', { args, stdinInput: null });
  if (result?.success) {
    el.textContent = result.stdout || '(empty)';
    if (type === 'yaml') {
      setTimeout(() => handleEditYaml(), 50);
    }
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

  // Owner references — clickable link to navigate
  if (meta.ownerReferences?.length) {
    const owner = meta.ownerReferences[0];
    html += infoRow('Controlled By', `${owner.kind} <span class="k8s-info-link k8s-owner-link" data-owner-kind="${owner.kind}" data-owner-name="${owner.name}">${owner.name}</span>`);
  }

  // Resource-specific properties
  if (resource === 'pods') {
    html += infoRow('Status', `<span class="k8s-status k8s-status-${(status.phase||'').toLowerCase()}">${status.phase || '-'}</span>`);
    html += infoRow('Node', spec.nodeName ? `<span class="k8s-info-link k8s-node-link" data-node-name="${spec.nodeName}">${spec.nodeName}</span>` : '-');
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
      // Find container status if it's a pod
      let cStatus = null;
      if (status.containerStatuses) {
        cStatus = status.containerStatuses.find(cs => cs.name === c.name);
      }
      
      let stateBadge = '🟢';
      let stateText = 'running';
      if (cStatus) {
        const stateKey = Object.keys(cStatus.state || {})[0];
        if (stateKey === 'waiting') { stateBadge = '🟡'; stateText = 'waiting'; }
        else if (stateKey === 'terminated') { stateBadge = '🔴'; stateText = 'terminated'; }
      }

      html += `<div class="k8s-info-container">`;
      html += `<div class="k8s-info-container-name">${stateBadge} ${c.name}</div>`;
      
      if (cStatus) {
        html += infoRow('Status', `<span style="color:${stateText==='running'?'var(--success)':'var(--warning)'}">${stateText}${cStatus.ready ? ', ready' : ''}</span>`);
      }
      
      html += infoRow('Image', `<span class="k8s-info-badge">${c.image || '-'}</span>`);
      html += infoRow('ImagePullPolicy', c.imagePullPolicy || '-');
      
      if (c.ports?.length) {
        html += infoRow('Ports', c.ports.map(p => `<span class="k8s-info-link">http: ${p.containerPort}/${p.protocol || 'TCP'}</span> <span class="k8s-info-badge" style="float:right;">Forward...</span>`).join('<br>'));
      }
      
      if (c.env?.length) {
        html += infoRow('Environment', `${c.env.length} Environmental Variables`);
      }
      
      if (c.volumeMounts?.length) {
        html += infoRow('Mounts', c.volumeMounts.map(m => `<span style="font-family:var(--font-mono);font-size:0.75rem;background:rgba(255,255,255,0.05);padding:2px 4px;border-radius:2px;">${m.mountPath}</span><br><span style="color:var(--text-muted);font-size:0.75rem;">from ${m.name} ${m.readOnly ? '(ro)' : '(rw)'}</span>`).join('<br><br>'));
      }
      
      const formatProbe = (p) => {
        if (!p) return null;
        let parts = [];
        if (p.httpGet) parts.push(`http-get http://:${p.httpGet.port}${p.httpGet.path}`);
        else if (p.exec) parts.push(`exec ${p.exec.command?.join(' ')}`);
        else if (p.tcpSocket) parts.push(`tcp-socket :${p.tcpSocket.port}`);
        parts.push(`delay=${p.initialDelaySeconds||0}s`);
        parts.push(`timeout=${p.timeoutSeconds||1}s`);
        parts.push(`period=${p.periodSeconds||10}s`);
        parts.push(`#success=${p.successThreshold||1}`);
        parts.push(`#failure=${p.failureThreshold||3}`);
        return parts.map(x => `<span class="k8s-info-badge">${x}</span>`).join(' ');
      };
      
      if (c.livenessProbe) html += infoRow('Liveness', formatProbe(c.livenessProbe));
      if (c.readinessProbe) html += infoRow('Readiness', formatProbe(c.readinessProbe));
      
      if (c.resources) {
        const req = c.resources.requests || {};
        const lim = c.resources.limits || {};
        html += infoRow('Requests', Object.keys(req).length ? Object.entries(req).map(([k,v]) => `${k.toUpperCase()}: ${v}`).join(', ') : '-');
        html += infoRow('Limits', Object.keys(lim).length ? Object.entries(lim).map(([k,v]) => `${k.toUpperCase()}: ${v}`).join(', ') : '-');
      } else {
        html += infoRow('Requests', 'CPU: —, Memory: —');
        html += infoRow('Limits', 'CPU: —, Memory: —');
      }
      
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

  // ===== Events Section =====
  html += '<div class="k8s-info-section"><div class="k8s-info-section-title">Events</div>';
  const eventsResult = await k8sInvoke('run_kubectl', { 
    args: ['get', 'events', ...nsArgs, '--field-selector', `involvedObject.name=${name}`, '-o', 'json'],
    stdinInput: null
  });
  
  if (eventsResult?.success) {
    try {
      const eventsObj = JSON.parse(eventsResult.stdout);
      const items = eventsObj.items || [];
      if (items.length > 0) {
        items.sort((a, b) => new Date(b.lastTimestamp || b.eventTime) - new Date(a.lastTimestamp || a.eventTime));
        items.forEach(ev => {
          html += `<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.05);">`;
          html += `<div style="display:flex;justify-content:space-between;color:var(--text-muted);font-size:0.75rem;margin-bottom:4px;">
                     <span><span style="color:${ev.type==='Warning'?'var(--danger)':'var(--success)'}">${ev.type}</span> • ${ev.reason}</span>
                     <span>${timeAgo(ev.lastTimestamp || ev.eventTime)}</span>
                   </div>`;
          html += `<div style="color:var(--text-primary);font-size:0.8rem;">${ev.message}</div>`;
          html += `</div>`;
        });
      } else {
        html += '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px 0;">No events found</div>';
      }
    } catch {
      html += '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px 0;">Failed to parse events</div>';
    }
  } else {
    html += '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px 0;">No events found</div>';
  }
  html += '</div>';

  html += '</div>';
  el.innerHTML = html;

  // Attach click handler to owner link
  el.querySelectorAll('.k8s-owner-link').forEach(link => {
    link.addEventListener('click', () => {
      const kind = link.dataset.ownerKind;
      const ownerName = link.dataset.ownerName;
      if (kind && ownerName) {
        navigateToOwner(kind, ownerName, selectedItem?.namespace);
      }
    });
    link.style.cursor = 'pointer';
  });

  // Attach click handler to node link
  el.querySelectorAll('.k8s-node-link').forEach(link => {
    link.addEventListener('click', () => {
      const nodeName = link.dataset.nodeName;
      if (nodeName) {
        navigateToOwner('Node', nodeName, '');
      }
    });
    link.style.cursor = 'pointer';
  });
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
    
    // Auto fetch logs for active tab if it's matching
    if (activeBottomTabId && activeBottomTabId.includes(name)) {
      const activeTab = openTabs.find(t => t.id === activeBottomTabId);
      if (activeTab && activeTab.type === 'logs') fetchLogs();
    }
  }
}

async function fetchLogs(isAutoRefresh = false) {
  const tab = openTabs.find(t => t.id === activeBottomTabId);
  if (!tab || tab.type !== 'logs' || !k8sInvoke) return;
  
  const el = document.getElementById('k8s-detail-content');
  
  if (!isAutoRefresh) {
    el.textContent = 'Fetching logs...';
    window._rawLogsContent = '';
  }

  const { name, namespace } = tab;
  const container = document.getElementById('k8s-logs-container')?.value || '';
  const tail = '500'; // Default to 500 lines for better Lens-like experience
  const nsArgs = namespace ? ['-n', namespace] : [];
  
  const previous = document.getElementById('k8s-logs-previous-btn')?.classList.contains('active');
  const timestamps = document.getElementById('k8s-logs-timestamps-btn')?.classList.contains('active');

  const args = ['logs', name, ...nsArgs];
  if (container) args.push('-c', container);
  
  args.push(`--tail=${tail}`);
  if (previous) args.push('--previous');
  if (timestamps) args.push('--timestamps');
  
  const result = await k8sInvoke('run_kubectl', { args, stdinInput: null });

  if (result?.success) {
    const logs = result.stdout || '(no logs)';
    
    // If it's an auto-refresh and the logs haven't changed, skip DOM updates entirely
    if (isAutoRefresh && window._rawLogsContent === logs) {
      return;
    }
    
    window._rawLogsContent = logs;
    
    // Check if user has scrolled up to prevent auto-scrolling if they are reading
    const isScrolledUp = el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight < el.scrollHeight - 20;

    if (ansiUp) {
      el.innerHTML = ansiUp.ansi_to_html(logs);
    } else {
      el.textContent = logs;
    }
    
    // Apply search filter if active
    const searchInput = document.getElementById('k8s-logs-search-input');
    if (searchInput && searchInput.value) {
      searchInput.dispatchEvent(new Event('input'));
    } else {
      const searchCount = document.getElementById('k8s-logs-search-count');
      if (searchCount) searchCount.textContent = '0/0';
    }

    // Auto-scroll to bottom only if we were already at bottom
    if (!isScrolledUp) {
      el.scrollTop = el.scrollHeight;
    }
  } else {
    el.textContent = result?.stderr || 'Failed to fetch logs';
  }
}

// ===== YAML Edit & Apply =====
let monacoReady = false;

function resetYamlEditor() {
  const container = document.getElementById('k8s-yaml-editor-container');
  if (container) container.style.display = 'none';
  const content = document.getElementById('k8s-detail-content');
  if (content) content.style.display = '';
}

function handleEditYaml() {
  const tab = openTabs.find(t => t.id === activeBottomTabId);
  if (!tab || tab.type !== 'yaml') return;

  const content = document.getElementById('k8s-detail-content');
  const editorContainer = document.getElementById('k8s-yaml-editor-container');
  content.style.display = 'none';
  editorContainer.style.display = 'flex';
  editorContainer.style.flexDirection = 'column';
  editorContainer.style.height = '100%';

  // Subheader update
  const kind = RESOURCE_META[tab.resource]?.singleName || (tab.resource.charAt(0).toUpperCase() + tab.resource.slice(1, -1));
  const name = tab.name || 'unknown';
  const ns = tab.namespace || '';
  
  const kindEl = document.getElementById('k8s-yaml-kind');
  if (kindEl) kindEl.textContent = kind;
  
  const nameEl = document.getElementById('k8s-yaml-name-link');
  if (nameEl) nameEl.textContent = name;
  
  const nsEl = document.getElementById('k8s-yaml-ns-text');
  if (nsEl) {
    if (ns) {
      nsEl.innerHTML = `in namespace <a href="#" style="color:var(--accent-primary);text-decoration:none;">${ns}</a>`;
    } else {
      nsEl.textContent = '';
    }
  }

  if (!monacoReady) {
    createEditor(document.getElementById('k8s-yaml-editor'));
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
    loadBottomTab(activeBottomTabId);
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
  Node: 'nodes',
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
  navigateToOwner(ownerKind, ownerName, namespace);
}

async function navigateToOwner(ownerKind, ownerName, namespace) {
  const resourceType = KIND_TO_RESOURCE[ownerKind];

  // Update right panel to show owner info (don't change left table)
  selectedItem = { name: ownerName, namespace, resource: resourceType || ownerKind.toLowerCase() + 's' };
  document.getElementById('k8s-detail').style.display = '';
  document.getElementById('k8s-detail-badge').textContent = ownerKind.toUpperCase();
  document.getElementById('k8s-detail-name').textContent = ownerName;
  document.getElementById('k8s-detail-ns').textContent = namespace ? `ns: ${namespace}` : 'cluster-scoped';

  // Update action button visibility based on owner's resource meta
  const meta = resourceType ? RESOURCE_META[resourceType] : null;
  document.getElementById('k8s-btn-restart').style.display = meta?.restartable ? '' : 'none';
  document.getElementById('k8s-btn-scale').style.display = meta?.scalable ? '' : 'none';
  document.getElementById('k8s-logs-tab').style.display = meta?.hasPodFeatures ? '' : 'none';

  // Reload info tab for owner
  loadInfoTab();

  // If bottom panel tabs are open, reload for new item
  if (activeBottomTab && openTabs.length > 0) {
    loadBottomTab(activeBottomTab);
  }
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
    closeAllPanels();
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

  // Show scale modal
  const modal = document.getElementById('scale-modal');
  const input = document.getElementById('scale-modal-input');
  const title = document.getElementById('scale-modal-title');
  title.textContent = `Scale ${name}`;
  input.value = '1';
  modal.style.display = '';
  input.focus();
  input.select();

  // Wait for user action
  const replicas = await new Promise(resolve => {
    const confirmBtn = document.getElementById('scale-modal-confirm');
    const cancelBtn = document.getElementById('scale-modal-cancel');
    const closeBtn = document.getElementById('scale-modal-close');

    function cleanup() {
      modal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
    }
    function onConfirm() { cleanup(); resolve(input.value); }
    function onCancel() { cleanup(); resolve(null); }
    function onKeydown(e) {
      if (e.key === 'Enter') { onConfirm(); }
      if (e.key === 'Escape') { onCancel(); }
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });

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
