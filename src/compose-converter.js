// ===== Docker Compose → Kubernetes YAML Converter =====

import { showToast } from './utils.js';

// ─── Simple YAML parser (subset for docker-compose) ───────────────────────────

function parseYaml(text) {
  // Strip comments and normalize
  const lines = text.split('\n').map(l => l.replace(/#.*$/, ''));
  return parseBlock(lines, 0, 0).value;
}

function countLeadingSpaces(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}

function parseBlock(lines, startIdx, baseIndent) {
  const result = {};
  const arr = [];
  let isArray = false;
  let i = startIdx;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    if (!trimmed) { i++; continue; }

    const indent = countLeadingSpaces(raw);
    if (indent < baseIndent) break;

    // List item
    if (trimmed.startsWith('- ')) {
      isArray = true;
      const rest = trimmed.slice(2).trim();
      if (rest.includes(':')) {
        // Inline key:value object in list
        const obj = {};
        const [k, ...vParts] = rest.split(':');
        obj[k.trim()] = vParts.join(':').trim();
        // Check for nested lines
        i++;
        while (i < lines.length) {
          const nr = lines[i];
          const nt = nr.trimStart();
          if (!nt) { i++; continue; }
          const ni = countLeadingSpaces(nr);
          if (ni <= indent) break;
          const subParsed = parseBlock(lines, i, ni);
          Object.assign(obj, subParsed.value);
          i = subParsed.nextIdx;
        }
        arr.push(obj);
      } else {
        arr.push(parseScalar(rest));
        i++;
      }
      continue;
    }

    // Bare list item (no space after -)
    if (trimmed === '-') {
      isArray = true;
      i++;
      const ni = i < lines.length ? countLeadingSpaces(lines[i]) : 0;
      const sub = parseBlock(lines, i, ni);
      arr.push(sub.value);
      i = sub.nextIdx;
      continue;
    }

    // Key: value
    if (trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const rest = trimmed.slice(colonIdx + 1).trim();

      if (rest === '|' || rest === '>') {
        // Block scalar
        i++;
        const blockLines = [];
        while (i < lines.length) {
          const bl = lines[i];
          const bi = countLeadingSpaces(bl);
          const bt = bl.trimStart();
          if (!bt && i + 1 < lines.length && countLeadingSpaces(lines[i + 1]) <= indent) { i++; break; }
          if (bi <= indent && bt) break;
          blockLines.push(bl.slice(indent + 2));
          i++;
        }
        result[key] = blockLines.join('\n');
      } else if (!rest) {
        // Nested object or array
        i++;
        if (i >= lines.length) { result[key] = null; break; }
        const nextTrimmed = lines[i].trimStart();
        const nextIndent = countLeadingSpaces(lines[i]);
        if (!nextTrimmed) { result[key] = null; continue; }
        const sub = parseBlock(lines, i, nextIndent);
        result[key] = sub.value;
        i = sub.nextIdx;
      } else {
        result[key] = parseScalar(rest);
        i++;
      }
      continue;
    }

    i++;
  }

  return { value: isArray ? arr : result, nextIdx: i };
}

function parseScalar(s) {
  if (s === 'true' || s === 'yes') return true;
  if (s === 'false' || s === 'no') return false;
  if (s === 'null' || s === '~') return null;
  const n = Number(s);
  if (!isNaN(n) && s !== '') return n;
  // Strip quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ─── YAML Emitter ─────────────────────────────────────────────────────────────

function emitYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return 'null\n';
  if (typeof obj === 'boolean') return obj + '\n';
  if (typeof obj === 'number') return obj + '\n';
  if (typeof obj === 'string') {
    if (obj.includes('\n')) {
      return '|\n' + obj.split('\n').map(l => pad + '  ' + l).join('\n') + '\n';
    }
    if (obj.includes(':') || obj.includes('#') || obj.startsWith(' ') || obj === '') {
      return `"${obj.replace(/"/g, '\\"')}"\n`;
    }
    return obj + '\n';
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]\n';
    return obj.map(item => {
      if (typeof item === 'object' && item !== null) {
        const sub = emitYaml(item, indent + 1);
        return `${pad}- ${sub.trimStart()}`;
      }
      return `${pad}- ${emitYaml(item, 0).trimEnd()}\n`;
    }).join('');
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}\n';
    return keys.map(k => {
      const v = obj[k];
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length > 0) {
        return `${pad}${k}:\n${emitYaml(v, indent + 1)}`;
      }
      if (Array.isArray(v)) {
        if (v.length === 0) return `${pad}${k}: []\n`;
        const sub = emitYaml(v, indent + 1);
        return `${pad}${k}:\n${sub}`;
      }
      return `${pad}${k}: ${emitYaml(v, 0).trimEnd()}\n`;
    }).join('');
  }
  return String(obj) + '\n';
}

// ─── Docker Compose → K8s Conversion ─────────────────────────────────────────

/**
 * Convert a docker-compose service definition into K8s manifests.
 * Returns an object { name, files: { filename: yamlString } }
 */
function convertService(name, svc, namespace, globalVolumes) {
  const files = {};
  const appLabel = name;
  const ns = namespace || 'default';

  // ── Parse environment variables ──────────────────────────────────────────
  const envVars = [];
  if (svc.environment) {
    const env = svc.environment;
    if (Array.isArray(env)) {
      env.forEach(e => {
        if (typeof e === 'string') {
          const idx = e.indexOf('=');
          if (idx >= 0) {
            envVars.push({ name: e.slice(0, idx), value: e.slice(idx + 1) });
          } else {
            envVars.push({ name: e, value: '' });
          }
        }
      });
    } else if (typeof env === 'object') {
      Object.entries(env).forEach(([k, v]) => {
        envVars.push({ name: k, value: String(v ?? '') });
      });
    }
  }

  // ── Parse ports ──────────────────────────────────────────────────────────
  const ports = [];
  if (svc.ports) {
    const rawPorts = svc.ports;
    (Array.isArray(rawPorts) ? rawPorts : [rawPorts]).forEach(p => {
      const ps = typeof p === 'object' ? `${p.target}` : String(p);
      // Formats: "host:container", "container", "host:container/proto"
      const parts = ps.split(':');
      const containerPart = parts[parts.length - 1] || ps;
      const [portNum, proto] = containerPart.split('/');
      const num = parseInt(portNum, 10);
      if (!isNaN(num)) {
        ports.push({ containerPort: num, protocol: (proto || 'TCP').toUpperCase() });
      }
    });
  }

  // ── Parse volumes ────────────────────────────────────────────────────────
  const volumeMounts = [];
  const volumes = [];
  const pvcNames = [];
  if (svc.volumes) {
    (Array.isArray(svc.volumes) ? svc.volumes : [svc.volumes]).forEach((v, idx) => {
      const vStr = typeof v === 'object' ? `${v.source}:${v.target}` : String(v);
      const parts = vStr.split(':');
      const source = parts[0];
      const target = parts[1] || parts[0];
      const volName = `${name}-vol-${idx}`;

      volumeMounts.push({ name: volName, mountPath: target });

      // Named volume → PVC, host path → hostPath
      if (source.startsWith('/') || source.startsWith('./') || source.startsWith('../')) {
        volumes.push({ name: volName, hostPath: { path: source, type: 'DirectoryOrCreate' } });
      } else {
        // Named volume → use PVC
        const pvcName = `${name}-${source}-pvc`;
        pvcNames.push({ volName, pvcName, sourceName: source });
        volumes.push({ name: volName, persistentVolumeClaim: { claimName: pvcName } });
      }
    });
  }

  // ── Build Deployment ─────────────────────────────────────────────────────
  const image = svc.image || `${name}:latest`;
  const replicas = svc.deploy?.replicas ?? 1;

  const containerSpec = {
    name,
    image,
    imagePullPolicy: 'IfNotPresent',
  };
  if (ports.length > 0) {
    containerSpec.ports = ports.map(p => ({ containerPort: p.containerPort, protocol: p.protocol }));
  }
  if (envVars.length > 0) {
    containerSpec.env = envVars.map(e => ({ name: e.name, value: e.value }));
  }
  if (volumeMounts.length > 0) {
    containerSpec.volumeMounts = volumeMounts;
  }

  // Resource limits from deploy
  if (svc.deploy?.resources) {
    const res = {};
    const limits = svc.deploy.resources.limits;
    const reservations = svc.deploy.resources.reservations;
    if (limits) {
      res.limits = {};
      if (limits.cpus) res.limits.cpu = String(limits.cpus);
      if (limits.memory) res.limits.memory = dockerMemToK8s(String(limits.memory));
    }
    if (reservations) {
      res.requests = {};
      if (reservations.cpus) res.requests.cpu = String(reservations.cpus);
      if (reservations.memory) res.requests.memory = dockerMemToK8s(String(reservations.memory));
    }
    if (Object.keys(res).length > 0) containerSpec.resources = res;
  }

  const podSpec = {
    containers: [containerSpec],
  };
  if (volumes.length > 0) podSpec.volumes = volumes;

  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name,
      namespace: ns,
      labels: { app: appLabel },
    },
    spec: {
      replicas,
      selector: { matchLabels: { app: appLabel } },
      template: {
        metadata: { labels: { app: appLabel } },
        spec: podSpec,
      },
    },
  };
  files[`${name}-deployment.yaml`] = '---\n' + emitYaml(deployment);

  // ── Build Service (if ports exposed) ────────────────────────────────────
  if (ports.length > 0) {
    const svcPorts = ports.map(p => ({
      name: `port-${p.containerPort}`,
      port: p.containerPort,
      targetPort: p.containerPort,
      protocol: p.protocol,
    }));
    const svcManifest = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name,
        namespace: ns,
        labels: { app: appLabel },
      },
      spec: {
        selector: { app: appLabel },
        ports: svcPorts,
        type: 'ClusterIP',
      },
    };
    files[`${name}-service.yaml`] = '---\n' + emitYaml(svcManifest);
  }

  // ── Build PVCs ───────────────────────────────────────────────────────────
  pvcNames.forEach(({ pvcName }) => {
    const pvc = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: pvcName, namespace: ns },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: '1Gi' } },
      },
    };
    files[`${pvcName}.yaml`] = '---\n' + emitYaml(pvc);
  });

  // ── Build ConfigMap from env_file references (placeholder) ──────────────
  if (svc.env_file) {
    const envFiles = Array.isArray(svc.env_file) ? svc.env_file : [svc.env_file];
    envFiles.forEach(ef => {
      const cmName = `${name}-envfile-cm`;
      const cm = {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: cmName, namespace: ns },
        data: { NOTE: `# Populate from ${ef}` },
      };
      files[`${cmName}.yaml`] = '---\n' + emitYaml(cm);
    });
  }

  return { name, files };
}

function dockerMemToK8s(mem) {
  // "512m" → "512Mi", "1g" → "1Gi", "1G" → "1Gi"
  return mem
    .replace(/(\d+)m$/i, '$1Mi')
    .replace(/(\d+)g$/i, '$1Gi')
    .replace(/(\d+)k$/i, '$1Ki');
}

/**
 * Parse docker-compose YAML text and return per-service K8s files.
 * Returns { services: [{ name, files }], errors: [] }
 */
export function convertCompose(composeText, namespace) {
  const errors = [];
  let compose;
  try {
    compose = parseYaml(composeText);
  } catch (e) {
    return { services: [], errors: [`YAML parse error: ${e.message}`] };
  }

  const services = compose.services || compose.service || {};
  const globalVolumes = compose.volumes || {};

  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) {
    return { services: [], errors: ['Không tìm thấy mục "services" trong file docker-compose.'] };
  }

  const result = [];
  for (const [svcName, svcDef] of Object.entries(services)) {
    if (!svcDef) { errors.push(`Service "${svcName}" trống, bỏ qua.`); continue; }
    try {
      const converted = convertService(svcName, svcDef, namespace, globalVolumes);
      result.push(converted);
    } catch (e) {
      errors.push(`Lỗi khi convert service "${svcName}": ${e.message}`);
    }
  }
  return { services: result, errors };
}

// ─── UI Initialization ────────────────────────────────────────────────────────

let currentConvertedFiles = {}; // flat map filename → yaml string
let currentActiveFile = null;

function renderConvertedFiles() {
  const tabs = document.getElementById('compose-result-tabs');
  const preview = document.getElementById('compose-yaml-preview');
  if (!tabs || !preview) return;

  const fileNames = Object.keys(currentConvertedFiles);
  if (fileNames.length === 0) {
    tabs.innerHTML = '';
    preview.textContent = '# Kết quả chuyển đổi sẽ hiển thị ở đây';
    return;
  }

  // Build tabs: "All" + per-file
  const allFiles = { 'all': null, ...currentConvertedFiles };
  const tabNames = ['all', ...fileNames];

  if (!currentActiveFile || !currentConvertedFiles[currentActiveFile]) {
    currentActiveFile = fileNames[0];
  }

  tabs.innerHTML = tabNames.map(name => {
    const isActive = name === currentActiveFile || (name === 'all' && currentActiveFile === null);
    return `<button class="compose-tab ${isActive ? 'active' : ''}" data-file="${name}">
      ${name === 'all' ? '📦 All' : name}
    </button>`;
  }).join('');

  // Tab click
  tabs.querySelectorAll('.compose-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentActiveFile = btn.dataset.file;
      renderConvertedFiles();
    });
  });

  // Show content
  if (currentActiveFile === 'all') {
    preview.textContent = Object.entries(currentConvertedFiles)
      .map(([fname, content]) => `# ===== ${fname} =====\n${content}`)
      .join('\n\n');
  } else {
    preview.textContent = currentConvertedFiles[currentActiveFile] || '';
  }

  // Highlight keywords
  highlightYaml(preview);
}

function highlightYaml(el) {
  // Simple coloring via CSS class trick — wrap in pre is enough for now
  el.style.color = '';
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function initComposeConverter() {
  const convertBtn = document.getElementById('btn-compose-convert');
  const copyBtn = document.getElementById('btn-compose-copy');
  const downloadBtn = document.getElementById('btn-compose-download');
  const downloadAllBtn = document.getElementById('btn-compose-download-all');
  const clearBtn = document.getElementById('btn-compose-clear');
  const nsInput = document.getElementById('compose-namespace');
  const textarea = document.getElementById('compose-input');
  const errorBox = document.getElementById('compose-errors');

  if (!convertBtn) return;

  // Sample button
  document.getElementById('btn-compose-sample')?.addEventListener('click', () => {
    textarea.value = SAMPLE_COMPOSE;
    showToast('Đã tải mẫu docker-compose', 'success');
  });

  convertBtn.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) { showToast('Vui lòng nhập nội dung docker-compose.yaml', 'error'); return; }

    const namespace = nsInput?.value.trim() || 'default';
    const { services, errors } = convertCompose(text, namespace);

    // Show errors
    errorBox.innerHTML = '';
    if (errors.length > 0) {
      errorBox.innerHTML = errors.map(e => `<div class="compose-error-item">⚠️ ${e}</div>`).join('');
      errorBox.style.display = 'block';
    } else {
      errorBox.style.display = 'none';
    }

    // Flatten all files
    currentConvertedFiles = {};
    services.forEach(({ files }) => {
      Object.assign(currentConvertedFiles, files);
    });
    currentActiveFile = Object.keys(currentConvertedFiles)[0] || null;

    renderConvertedFiles();

    const count = Object.keys(currentConvertedFiles).length;
    if (count > 0) {
      showToast(`✅ Đã tạo ${count} file YAML cho ${services.length} service(s)`, 'success');
    }
  });

  copyBtn?.addEventListener('click', () => {
    const yaml = document.getElementById('compose-yaml-preview')?.textContent;
    if (!yaml || yaml.startsWith('#')) { showToast('Không có nội dung để copy', 'error'); return; }
    navigator.clipboard.writeText(yaml);
    showToast('Đã copy YAML', 'success');
  });

  downloadBtn?.addEventListener('click', () => {
    if (!currentActiveFile || !currentConvertedFiles[currentActiveFile]) {
      showToast('Không có file nào được chọn', 'error');
      return;
    }
    if (currentActiveFile === 'all') {
      const combined = Object.entries(currentConvertedFiles)
        .map(([f, c]) => `# ===== ${f} =====\n${c}`)
        .join('\n\n');
      downloadFile('k8s-manifests.yaml', combined);
    } else {
      downloadFile(currentActiveFile, currentConvertedFiles[currentActiveFile]);
    }
    showToast('Đã tải file!', 'success');
  });

  downloadAllBtn?.addEventListener('click', () => {
    const files = Object.entries(currentConvertedFiles);
    if (files.length === 0) { showToast('Chưa có file nào', 'error'); return; }
    const combined = files.map(([f, c]) => `# ===== ${f} =====\n${c}`).join('\n\n');
    downloadFile('k8s-all-manifests.yaml', combined);
    showToast(`Đã tải ${files.length} files!`, 'success');
  });

  clearBtn?.addEventListener('click', () => {
    textarea.value = '';
    currentConvertedFiles = {};
    currentActiveFile = null;
    errorBox.style.display = 'none';
    renderConvertedFiles();
    showToast('Đã xóa', 'success');
  });
}

// ─── Sample compose ───────────────────────────────────────────────────────────

const SAMPLE_COMPOSE = `version: "3.9"
services:
  web:
    image: nginx:1.25-alpine
    ports:
      - "80:80"
      - "443:443"
    environment:
      - NODE_ENV=production
      - APP_PORT=80
    volumes:
      - web-data:/usr/share/nginx/html
      - ./nginx.conf:/etc/nginx/nginx.conf
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: "0.5"
          memory: 256m
        reservations:
          cpus: "0.1"
          memory: 128m

  api:
    image: my-api:latest
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/mydb
      REDIS_URL: redis://cache:6379
    volumes:
      - api-uploads:/app/uploads
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: "1"
          memory: 512m

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mydb
    volumes:
      - pg-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  cache:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  web-data:
  api-uploads:
  pg-data:
`;
