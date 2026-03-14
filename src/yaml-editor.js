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

// Define K8s YAML dark theme
monaco.editor.defineTheme('k8s-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'type', foreground: '6ab0f3' },      // Keys - blue
    { token: 'string', foreground: '98c379' },     // Strings - green
    { token: 'keyword', foreground: 'c678dd' },    // Booleans - purple
    { token: 'number', foreground: 'd19a66' },     // Numbers - orange
    { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
    { token: 'tag', foreground: 'e06c75' },        // Tags - red
    { token: 'operator', foreground: '56b6c2' },   // List markers - cyan
  ],
  colors: {
    'editor.background': '#0c0c1d',
    'editor.foreground': '#abb2bf',
    'editorLineNumber.foreground': '#4b5263',
    'editorLineNumber.activeForeground': '#6b7280',
    'editor.selectionBackground': '#3e4451',
    'editor.lineHighlightBackground': '#1a1a2e',
    'editorCursor.foreground': '#6366f1',
    'editorWidget.background': '#161625',
    'editorWidget.border': '#2a2a3d',
    'editorSuggestWidget.background': '#161625',
    'editorSuggestWidget.border': '#2a2a3d',
    'editorSuggestWidget.selectedBackground': '#2a2a3d',
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
