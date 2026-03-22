// ===== Resource Manager — Session-Grouped View =====
// Shows apply history entries as collapsible session groups
// Each session lists the resources that were applied, with live edit/delete from cluster

import { getInvoke } from './tauri.js';
import { showToast, escapeHtml } from './utils.js';
import { showConfirmModal } from './modal.js';

/** Initialize resource manager page */
export function initHistory() {
  document.getElementById('btn-refresh-resources')?.addEventListener('click', loadResources);
  document.getElementById('btn-clear-history')?.addEventListener('click', clearAllHistory);

  // Auto-load when page becomes visible
  const observer = new MutationObserver(() => {
    const page = document.getElementById('page-history');
    if (page && page.classList.contains('active')) {
      loadResources();
    }
  });
  const page = document.getElementById('page-history');
  if (page) observer.observe(page, { attributes: true, attributeFilter: ['class'] });
}

/** Load history entries and render session groups */
export async function loadResources() {
  const invoke = getInvoke();
  if (!invoke) return;

  const container = document.getElementById('history-list');
  container.innerHTML = '<div class="history-loading"><span class="res-spinner"></span> Đang tải lịch sử...</div>';

  try {
    const result = await invoke('get_history');
    if (!result.success) {
      container.innerHTML = `<div class="history-empty"><p>Lỗi: ${escapeHtml(result.stderr)}</p></div>`;
      return;
    }

    const entries = JSON.parse(result.stdout);

    if (entries.length === 0) {
      container.innerHTML = `
        <div class="history-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" opacity="0.3">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
            <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <p>Chưa có lịch sử apply nào</p>
          <p style="font-size:0.78rem;color:var(--text-muted);">Tạo YAML và nhấn kubectl apply để bắt đầu</p>
        </div>`;
      return;
    }

    container.innerHTML = entries.map(renderSessionCard).join('');
    attachSessionListeners(container);
  } catch (e) {
    container.innerHTML = `<div class="history-empty"><p>Lỗi: ${e}</p></div>`;
  }
}

/** Render a session group card */
function renderSessionCard(entry) {
  const date = new Date(entry.timestamp);
  const timeStr = date.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const statusClass = entry.success ? 'success' : 'error';
  const statusIcon = entry.success ? '✓' : '✗';
  const statusText = entry.success ? 'Success' : 'Failed';

  // Parse resources from file names (e.g. "deployment.yaml" -> "Deployment")
  const resources = parseResourcesFromFiles(entry.files, entry.yaml);

  return `
    <div class="session-card" data-id="${entry.id}" data-namespace="${escapeHtml(entry.namespace)}">
      <div class="session-header">
        <div class="session-info">
          <div class="session-top">
            <span class="history-badge ${statusClass}">${statusIcon} ${statusText}</span>
            <span class="session-time">${timeStr}</span>
          </div>
          <div class="session-meta">
            <span class="history-meta-item" title="Context">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20M2 12h20" stroke="currentColor" stroke-width="1.5"/></svg>
              ${escapeHtml(entry.context)}
            </span>
            <span class="history-meta-item" title="Namespace">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M9 3v18M15 3v18" stroke="currentColor" stroke-width="1.5"/></svg>
              ${escapeHtml(entry.namespace)}
            </span>
            <span class="history-meta-item" title="Resources">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2"/><path d="M14 2v6h6" stroke="currentColor" stroke-width="2"/></svg>
              ${resources.length} resource${resources.length > 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div class="session-actions">
          <button class="btn-icon btn-delete-session" data-id="${entry.id}" title="Xóa khỏi lịch sử">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="1.5"/></svg>
          </button>
          <svg class="history-expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </div>
      </div>
      <div class="session-body">
        <div class="session-resources">
          ${resources.map((r, i) => renderResourceItem(r, entry, i)).join('')}
        </div>
        ${entry.output ? `
        <div class="session-output">
          <div class="history-section-header"><span>Output</span></div>
          <pre class="session-output-pre"><code>${escapeHtml(entry.output)}</code></pre>
        </div>` : ''}
      </div>
    </div>`;
}

/** Parse resources from file names + YAML content */
function parseResourcesFromFiles(files, yamlContent) {
  const resources = [];
  // Split YAML by --- to get individual documents
  const docs = yamlContent.split(/^---$/m).filter(d => d.trim());

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const kindMatch = doc.match(/^kind:\s*(.+)$/m);
    const nameMatch = doc.match(/^\s*name:\s*(.+)$/m);
    const kind = kindMatch ? kindMatch[1].trim() : 'Unknown';
    const name = nameMatch ? nameMatch[1].trim() : files[i] || `resource-${i}`;

    resources.push({
      kind,
      name,
      yaml: doc.trim(),
      fileName: files[i] || `${kind.toLowerCase()}.yaml`,
    });
  }

  // If no docs parsed, create entries from file names
  if (resources.length === 0) {
    for (const file of files) {
      const kind = file.replace('.yaml', '').replace(/(^\w)/, m => m.toUpperCase());
      resources.push({ kind, name: file, yaml: '', fileName: file });
    }
  }

  return resources;
}

const KIND_BADGE_MAP = {
  'Deployment': 'deploy-badge',
  'Service': 'svc-res-badge',
  'Ingress': 'ingress-badge',
  'PersistentVolumeClaim': 'pvc-res-badge',
  'ConfigMap': 'cm-res-badge',
  'Secret': 'secret-res-badge',
  'HorizontalPodAutoscaler': 'hpa-badge',
  'Namespace': 'ns-badge',
};

const KIND_SHORT = {
  'Deployment': 'deploy',
  'Service': 'svc',
  'Ingress': 'ingress',
  'PersistentVolumeClaim': 'pvc',
  'ConfigMap': 'configmap',
  'Secret': 'secret',
  'HorizontalPodAutoscaler': 'hpa',
  'Namespace': 'namespace',
};

/** Render a single resource item within a session */
function renderResourceItem(res, entry, index) {
  const badgeClass = KIND_BADGE_MAP[res.kind] || '';
  const kindLabel = res.kind === 'PersistentVolumeClaim' ? 'PVC' :
                    res.kind === 'HorizontalPodAutoscaler' ? 'HPA' : res.kind;
  const kindShort = KIND_SHORT[res.kind] || res.kind.toLowerCase();

  return `
    <div class="res-item" data-kind="${kindShort}" data-name="${escapeHtml(res.name)}" data-ns="${escapeHtml(entry.namespace)}" data-index="${index}">
      <div class="res-item-header">
        <span class="res-kind-badge ${badgeClass}">${kindLabel}</span>
        <span class="res-name">${escapeHtml(res.name)}</span>
        <div class="res-item-actions">
          <button class="btn btn-ghost btn-sm btn-view-live" title="Xem YAML hiện tại trên cluster">Live</button>
          <button class="btn-icon btn-delete-res" data-kind="${kindShort}" data-name="${escapeHtml(res.name)}" data-ns="${escapeHtml(entry.namespace)}" title="Xóa khỏi cluster">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="1.5"/></svg>
          </button>
        </div>
      </div>
      <div class="res-item-body">
        <div class="history-section-header">
          <span>YAML</span>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm btn-copy-yaml">Copy</button>
            <button class="btn btn-success btn-sm btn-apply-yaml">Apply</button>
          </div>
        </div>
        <textarea class="res-yaml-textarea" spellcheck="false" rows="12">${escapeHtml(res.yaml)}</textarea>
      </div>
    </div>`;
}

/** Attach event listeners to rendered session cards */
function attachSessionListeners(container) {
  // Session header click → toggle expand
  container.querySelectorAll('.session-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-session')) return;
      header.closest('.session-card').classList.toggle('expanded');
    });
  });

  // Delete session from history
  container.querySelectorAll('.btn-delete-session').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryEntry(btn.dataset.id);
    });
  });

  // Resource item header click → toggle individual resource
  container.querySelectorAll('.res-item-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      header.closest('.res-item').classList.toggle('expanded');
    });
  });

  // View live YAML from cluster
  container.querySelectorAll('.btn-view-live').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.res-item');
      loadLiveYaml(item);
      item.classList.add('expanded');
    });
  });

  // Delete resource from cluster
  container.querySelectorAll('.btn-delete-res').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteResource(btn.dataset.kind, btn.dataset.name, btn.dataset.ns);
    });
  });

  // Copy YAML
  container.querySelectorAll('.btn-copy-yaml').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const textarea = btn.closest('.res-item-body').querySelector('.res-yaml-textarea');
      navigator.clipboard.writeText(textarea.value).then(() => showToast('YAML copied!', 'success'));
    });
  });

  // Apply YAML
  container.querySelectorAll('.btn-apply-yaml').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = btn.closest('.res-item');
      const textarea = item.querySelector('.res-yaml-textarea');
      const ns = item.dataset.ns;
      await applyYaml(textarea.value, ns);
    });
  });
}

/** Load live YAML from the cluster for a resource item */
async function loadLiveYaml(item) {
  const invoke = getInvoke();
  if (!invoke) return;

  const kind = item.dataset.kind;
  const name = item.dataset.name;
  const ns = item.dataset.ns;
  const textarea = item.querySelector('.res-yaml-textarea');

  textarea.value = 'Loading...';

  try {
    const result = await invoke('run_kubectl', {
      args: ['get', kind, name, '-n', ns, '-o', 'yaml'],
      stdinInput: null,
    });

    if (result.success) {
      let yaml = result.stdout;
      // Strip noisy metadata
      yaml = yaml.replace(/  managedFields:[\s\S]*?(?=\n  [a-z]|\nspec:)/g, '');
      yaml = yaml.replace(/  resourceVersion:.*\n/g, '');
      yaml = yaml.replace(/  uid:.*\n/g, '');
      yaml = yaml.replace(/  generation:.*\n/g, '');
      yaml = yaml.replace(/^\s*\n/gm, '');
      textarea.value = yaml.trim();
      showToast('Loaded live YAML', 'success');
    } else {
      textarea.value = `# Resource not found on cluster\n# ${result.stderr}`;
      showToast('Resource not found', 'error');
    }
  } catch (e) {
    textarea.value = `# Error: ${e}`;
  }
}

/** Apply YAML to the cluster */
async function applyYaml(yaml, namespace) {
  const invoke = getInvoke();
  if (!invoke) return;

  const confirmed = await showConfirmModal(
    `kubectl apply -n ${namespace}`,
    `Sẽ apply YAML vào namespace "${namespace}"`,
    'Apply'
  );
  if (!confirmed) return;

  try {
    const result = await invoke('apply_yaml', { yaml, namespace });
    if (result.success) {
      showToast('Applied successfully!', 'success');
    } else {
      showToast('Failed: ' + result.stderr, 'error');
    }
  } catch (e) {
    showToast('Error: ' + e, 'error');
  }
}

/** Delete a resource from the cluster */
async function deleteResource(kind, name, namespace) {
  const invoke = getInvoke();
  if (!invoke) return;

  const confirmed = await showConfirmModal(
    `kubectl delete ${kind} ${name}`,
    `Sẽ xóa ${kind} "${name}" khỏi namespace "${namespace}"\n\nHành động này không thể hoàn tác!`,
    'Xóa'
  );
  if (!confirmed) return;

  try {
    const result = await invoke('run_kubectl', {
      args: ['delete', kind, name, '-n', namespace],
      stdinInput: null,
    });
    if (result.success) {
      showToast(`Đã xóa ${kind}/${name}`, 'success');
    } else {
      showToast('Lỗi: ' + result.stderr, 'error');
    }
  } catch (e) {
    showToast('Lỗi: ' + e, 'error');
  }
}

/** Delete a single history entry */
async function deleteHistoryEntry(id) {
  const invoke = getInvoke();
  if (!invoke) return;

  try {
    const result = await invoke('delete_history', { id });
    if (result.success) {
      showToast('Đã xóa khỏi lịch sử', 'success');
      loadResources();
    }
  } catch (e) {
    showToast('Lỗi: ' + e, 'error');
  }
}

/** Clear all history */
async function clearAllHistory() {
  const invoke = getInvoke();
  if (!invoke) return;

  const confirmed = await showConfirmModal(
    'Xóa tất cả lịch sử',
    'Bạn có chắc muốn xóa toàn bộ lịch sử apply?\n\nChỉ xóa lịch sử lưu trên máy, không ảnh hưởng resources trên cluster.',
    'Xóa tất cả'
  );
  if (!confirmed) return;

  try {
    const result = await invoke('clear_history');
    if (result.success) {
      showToast('Đã xóa tất cả lịch sử', 'success');
      loadResources();
    }
  } catch (e) {
    showToast('Lỗi: ' + e, 'error');
  }
}
