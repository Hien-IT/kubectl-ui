// ===== Monaco YAML Editor Module =====
import * as monaco from 'monaco-editor';

// Configure Monaco workers
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new Worker(
        new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
        { type: 'module' }
      );
    }
    return new Worker(
      new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
      { type: 'module' }
    );
  }
};

// Register YAML language coloring
monaco.languages.register({ id: 'yaml' });
monaco.languages.setMonarchTokensProvider('yaml', {
  tokenizer: {
    root: [
      // Comments
      [/#.*$/, 'comment'],
      // Keys
      [/^[\w][\w.\-]*(?=\s*:)/, 'type'],
      [/^\s+[\w][\w.\-]*(?=\s*:)/, 'type'],
      // Strings
      [/"[^"]*"/, 'string'],
      [/'[^']*'/, 'string'],
      // Booleans
      [/\b(true|false|yes|no|on|off)\b/i, 'keyword'],
      // Null
      [/\b(null|~)\b/i, 'keyword'],
      // Numbers
      [/\b\d+(\.\d+)?\b/, 'number'],
      // YAML directives
      [/^---/, 'tag'],
      [/^\.\.\./, 'tag'],
      // Anchors & Aliases
      [/[&*]\w+/, 'tag'],
      // Tags
      [/!\w+/, 'tag'],
      // List markers
      [/^\s*-\s/, 'operator'],
    ]
  }
});

// Define K8s YAML dark theme (VS Code Default Dark+)
monaco.editor.defineTheme('k8s-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'type', foreground: '9CDCFE' },      // Keys - light blue
    { token: 'string', foreground: 'CE9178' },     // Strings - orange
    { token: 'keyword', foreground: '569CD6' },    // Booleans - blue
    { token: 'number', foreground: 'B5CEA8' },     // Numbers - light green
    { token: 'comment', foreground: '6A9955' },    // Comments - green
    { token: 'tag', foreground: '569CD6' },        // Tags - blue
    { token: 'operator', foreground: 'D4D4D4' },   // List markers - default
  ],
  colors: {
    'editor.background': '#1E1E1E',
    'editor.foreground': '#D4D4D4',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#C6C6C6',
    'editor.selectionBackground': '#264F78',
    'editor.lineHighlightBackground': '#2A2D2E',
    'editorCursor.foreground': '#AEAFAD',
    'editorWidget.background': '#252526',
    'editorWidget.border': '#454545',
    'editorSuggestWidget.background': '#252526',
    'editorSuggestWidget.border': '#454545',
    'editorSuggestWidget.selectedBackground': '#062F4A',
  }
});

// Common K8s YAML keys for auto-completion
const K8S_KEYS = [
  'apiVersion', 'kind', 'metadata', 'spec', 'status',
  'name', 'namespace', 'labels', 'annotations',
  'containers', 'initContainers', 'image', 'imagePullPolicy',
  'ports', 'containerPort', 'protocol', 'env', 'envFrom',
  'resources', 'limits', 'requests', 'cpu', 'memory',
  'volumeMounts', 'volumes', 'mountPath', 'subPath',
  'replicas', 'selector', 'matchLabels', 'template',
  'strategy', 'rollingUpdate', 'maxSurge', 'maxUnavailable',
  'readinessProbe', 'livenessProbe', 'startupProbe',
  'httpGet', 'path', 'port', 'exec', 'command', 'args',
  'initialDelaySeconds', 'periodSeconds', 'timeoutSeconds',
  'serviceAccountName', 'nodeSelector', 'tolerations', 'affinity',
  'configMap', 'secret', 'persistentVolumeClaim', 'emptyDir',
  'hostPath', 'nfs', 'claimName',
  'restartPolicy', 'terminationGracePeriodSeconds',
  'dnsPolicy', 'hostNetwork', 'securityContext',
  'runAsUser', 'runAsGroup', 'fsGroup', 'privileged',
];

const K8S_KINDS = [
  'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet',
  'Service', 'Ingress', 'ConfigMap', 'Secret',
  'Pod', 'Job', 'CronJob', 'PersistentVolumeClaim',
  'HorizontalPodAutoscaler', 'ServiceAccount', 'Role',
  'ClusterRole', 'RoleBinding', 'ClusterRoleBinding',
  'NetworkPolicy', 'LimitRange', 'ResourceQuota',
];

const API_VERSIONS = [
  'v1', 'apps/v1', 'batch/v1', 'networking.k8s.io/v1',
  'rbac.authorization.k8s.io/v1', 'autoscaling/v2',
  'policy/v1', 'storage.k8s.io/v1',
];

// Register completion provider
monaco.languages.registerCompletionItemProvider('yaml', {
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn
    };

    const lineContent = model.getLineContent(position.lineNumber).trimStart();

    const suggestions = [];

    // Suggest API versions after 'apiVersion:'
    if (lineContent.startsWith('apiVersion:')) {
      API_VERSIONS.forEach(v => suggestions.push({
        label: v,
        kind: monaco.languages.CompletionItemKind.Value,
        insertText: v,
        range
      }));
    }
    // Suggest kinds after 'kind:'
    else if (lineContent.startsWith('kind:')) {
      K8S_KINDS.forEach(k => suggestions.push({
        label: k,
        kind: monaco.languages.CompletionItemKind.Class,
        insertText: k,
        range
      }));
    }
    // General K8s key suggestions
    else {
      K8S_KEYS.forEach(key => suggestions.push({
        label: key,
        kind: monaco.languages.CompletionItemKind.Property,
        insertText: key + ': ',
        range
      }));
    }

    return { suggestions };
  }
});

let editorInstance = null;

export function createEditor(container) {
  if (editorInstance) {
    editorInstance.dispose();
  }

  editorInstance = monaco.editor.create(container, {
    value: '',
    language: 'yaml',
    theme: 'k8s-dark',
    fontSize: 13,
    lineNumbers: 'on',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    tabSize: 2,
    insertSpaces: true,
    automaticLayout: true,
    formatOnPaste: true,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    guides: { indentation: true },
    folding: true,
    suggest: { showWords: false },
    quickSuggestions: true,
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
    padding: { top: 8 },
  });

  // Add keyboard shortcut: Ctrl/Cmd+S = format document
  editorInstance.addAction({
    id: 'format-yaml',
    label: 'Format YAML',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
    run(ed) {
      ed.getAction('editor.action.formatDocument')?.run();
    }
  });

  return editorInstance;
}

export function setEditorValue(value) {
  if (editorInstance) {
    editorInstance.setValue(value);
  }
}

export function getEditorValue() {
  return editorInstance ? editorInstance.getValue() : '';
}

export function disposeEditor() {
  if (editorInstance) {
    editorInstance.dispose();
    editorInstance = null;
  }
}

export function focusEditor() {
  if (editorInstance) {
    editorInstance.focus();
  }
}
