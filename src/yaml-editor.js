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
      // Keys (with or without quotes)
      [/(?:^|\s+)(?:[a-zA-Z0-9_\-\.]+)(?=\s*:)/, 'type'],
      [/"([^"\\]|\\.)*"(?=\s*:)/, 'type'],
      [/'([^'\\]|\\.)*'(?=\s*:)/, 'type'],
      // Unquoted Date/Time & IPs
      [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[A-Za-z0-9\+\-\:.]*/, 'string.unquoted'],
      [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?\b/, 'string.unquoted'],
      // Strings (Quoted) -> Orange/Brown
      [/"([^"\\]|\\.)*"/, 'string.quote'],
      [/'([^'\\]|\\.)*'/, 'string.quote'],
      // Identify block strings indicators -> Blue
      [/(\|\-?|\>\-?)\s*$/, 'string.unquoted'],
      // Booleans -> Purple
      [/\b(true|false)\b/i, 'keyword'],
      // Null -> Purple
      [/\b(null|~)\b/i, 'keyword'],
      // Numbers -> Orange/Yellow
      [/\b\d+(\.\d+)?\b/, 'number'],
      // YAML directives
      [/^---/, 'tag'],
      [/^\.\.\./, 'tag'],
      // Anchors & Aliases
      [/[&*]\w+/, 'tag'],
      // List markers -> Gray
      [/^\s*-\s/, 'operator'],
      // Unquoted strings (catch all) -> Blue
      [/(?<=:\s+)[^#\n"'\{\[\>\|]+$/, 'string.unquoted'],
    ]
  }
});

// Define K8s YAML dark theme (Lens Dark Theme)
monaco.editor.defineTheme('k8s-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'type', foreground: '56B6C2' },       // Keys - cyan/teal
    { token: 'string', foreground: '56B6C2' },     // Strings - cyan
    { token: 'string.quote', foreground: '56B6C2' }, // Quoted Strings - cyan
    { token: 'string.unquoted', foreground: '56B6C2' }, // Unquoted Strings - cyan
    { token: 'keyword', foreground: 'D19A66' },    // Booleans/Null - orange
    { token: 'number', foreground: 'D19A66' },     // Numbers - orange
    { token: 'comment', foreground: '5C6370', fontStyle: 'italic' }, // Comments - gray
    { token: 'tag', foreground: 'E06C75' },        // Tags - red
    { token: 'operator', foreground: 'ABB2BF' },   // List markers - default text color
  ],
  colors: {
    'editor.background': '#1E1E1E',                // Keep VS Code dark background for consistency with the rest of the UI
    'editor.foreground': '#ABB2BF',
    'editorLineNumber.foreground': '#4B5263',
    'editorLineNumber.activeForeground': '#ABB2BF',
    'editor.selectionBackground': '#3E4451',
    'editor.lineHighlightBackground': '#2C313A',
    'editorCursor.foreground': '#528BFF',
    'editorWidget.background': '#21252B',
    'editorWidget.border': '#181A1F',
    'editorSuggestWidget.background': '#21252B',
    'editorSuggestWidget.border': '#181A1F',
    'editorSuggestWidget.selectedBackground': '#2C313A',
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
