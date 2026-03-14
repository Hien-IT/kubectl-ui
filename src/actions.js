// ===== Kubectl Apply, Copy, Download Actions =====

import { getInvoke } from './tauri.js';
import { showToast } from './utils.js';
import { showModal, setModalResult, showConfirmModal } from './modal.js';
import { getNamespace } from './namespace.js';
import { getGeneratedFiles, getCurrentPreviewTab, getCurrentYaml } from './preview.js';

/** Apply all generated files via kubectl */
async function applyAllFiles() {
  const invoke = getInvoke();
  if (!invoke) { showToast('kubectl apply chỉ khả dụng trong Tauri desktop app', 'error'); return; }
  const generatedFiles = getGeneratedFiles();
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

/** Apply the currently previewed file via kubectl */
async function applyCurrentFile() {
  const invoke = getInvoke();
  if (!invoke) { showToast('kubectl apply chỉ khả dụng trong Tauri desktop app', 'error'); return; }
  const yaml = getCurrentYaml();
  if (!yaml) { showToast('Không có YAML nào để apply', 'error'); return; }
  const namespace = getNamespace();
  const currentPreviewTab = getCurrentPreviewTab();
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

/** Download a file as a blob */
function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Initialize all action button handlers */
export function initActions() {
  // Copy to clipboard
  document.getElementById('btn-copy').addEventListener('click', () => {
    const yaml = getCurrentYaml();
    if (!yaml) return;
    navigator.clipboard.writeText(yaml);
  });

  // Download current file
  document.getElementById('btn-download').addEventListener('click', () => {
    const currentPreviewTab = getCurrentPreviewTab();
    if (currentPreviewTab === 'all') {
      downloadFile('k8s-manifests.yaml', getCurrentYaml());
    } else {
      const generatedFiles = getGeneratedFiles();
      const yaml = generatedFiles[currentPreviewTab];
      if (yaml) downloadFile(currentPreviewTab, yaml);
    }
    showToast('File downloaded!', 'success');
  });

  // Download all files
  document.getElementById('btn-download-all').addEventListener('click', async () => {
    const generatedFiles = getGeneratedFiles();
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

  // Apply buttons
  document.getElementById('btn-apply-all').addEventListener('click', applyAllFiles);
  document.getElementById('btn-apply-current').addEventListener('click', applyCurrentFile);
}
