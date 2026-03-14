// ===== YAML Preview Rendering =====

import { escapeHtml } from './utils.js';
import { collectConfig } from './form-collectors.js';
import { getAllYaml } from './generators.js';

// ===== State =====
let currentPreviewTab = 'all';
let generatedFiles = {};

/** Get the current generated files */
export function getGeneratedFiles() {
  return generatedFiles;
}

/** Get the current preview tab name */
export function getCurrentPreviewTab() {
  return currentPreviewTab;
}

/** Update the YAML preview from current form state */
export function updatePreview() {
  const config = collectConfig();
  generatedFiles = getAllYaml(config);
  updatePreviewTabs();
  updateResourceTabIndicators(config);
  renderCurrentPreview();
}

/** Update the preview tab bar */
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

/** Get icon for a YAML file type */
function getFileIcon(name) {
  const icons = {
    'namespace.yaml': '🏷️', 'deployment.yaml': '🚀', 'service.yaml': '🔗',
    'ingress.yaml': '🌐', 'pvc.yaml': '💾', 'configmap.yaml': '⚙️',
    'secret.yaml': '🔐', 'hpa.yaml': '📊'
  };
  return icons[name] || '📄';
}

/** Update tab indicators showing which resources are enabled */
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

/** Render the current preview content */
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

/** Get the current YAML content (all or single file) */
export function getCurrentYaml() {
  if (currentPreviewTab === 'all') {
    return Object.entries(generatedFiles)
      .map(([name, content]) => `# --- ${name} ---\n${content}`)
      .join('\n\n---\n\n');
  }
  return generatedFiles[currentPreviewTab] || '';
}

// ===== YAML Syntax Highlighting =====

/** Highlight YAML syntax with HTML spans */
export function highlightYaml(yaml) {
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
