// ===== Form Data Collectors =====
// Reads form DOM state and returns structured config objects

import { getNamespace } from './namespace.js';

/** Get names of created PVC items */
export function getPvcNames() {
  const names = [];
  document.querySelectorAll('#pvc-items-list .resource-item').forEach(item => {
    const name = item.querySelector('.item-name')?.value?.trim();
    if (name) names.push(name);
  });
  return names;
}

/** Get names of created ConfigMap items */
export function getConfigMapNames() {
  const names = [];
  document.querySelectorAll('#configmap-items-list .resource-item').forEach(item => {
    const name = item.querySelector('.item-name')?.value?.trim();
    if (name) names.push(name);
  });
  return names;
}

/** Get names of created Secret items */
export function getSecretNames() {
  const names = [];
  document.querySelectorAll('#secret-items-list .resource-item').forEach(item => {
    const name = item.querySelector('.item-name')?.value?.trim();
    if (name) names.push(name);
  });
  return names;
}

/** Collect the entire form configuration into a config object */
export function collectConfig() {
  const labels = {};
  document.querySelectorAll('#labels-list .kv-row').forEach(row => {
    const key = row.querySelector('.kv-key')?.value?.trim();
    const value = row.querySelector('.kv-value')?.value?.trim();
    if (key) labels[key] = value || '';
  });

  const appName = document.getElementById('app-name').value.trim() || 'my-app';
  const selectorLabels = { app: appName, ...labels };

  const containerPorts = [];
  document.querySelectorAll('#container-ports .port-row').forEach(row => {
    const name = row.querySelector('.port-name')?.value?.trim() || 'http';
    const port = parseInt(row.querySelector('.port-number')?.value) || 80;
    const protocol = row.querySelector('.port-protocol')?.value || 'TCP';
    containerPorts.push({ name, port, protocol });
  });

  // imagePullSecrets
  const imagePullSecrets = [];
  document.querySelectorAll('#image-pull-secrets-list .pull-secret-row').forEach(row => {
    const name = row.querySelector('.pullsecret-name-input')?.value?.trim() || '';
    if (name) imagePullSecrets.push(name);
  });

  const envVars = [];
  document.querySelectorAll('#env-vars-list .env-var-row').forEach(row => {
    const key = row.querySelector('.env-name')?.value?.trim();
    const source = row.querySelector('.env-source')?.value || 'value';
    if (!key) return;
    if (source === 'value') {
      envVars.push({ key, source: 'value', value: row.querySelector('.env-value')?.value?.trim() || '' });
    } else {
      const refName = row.querySelector('.env-ref-select')?.value || '';
      const refKey = row.querySelector('.env-ref-key')?.value?.trim() || key;
      envVars.push({ key, source, refName, refKey });
    }
  });

  // envFrom — import all keys from ConfigMap/Secret
  const envFrom = [];
  document.querySelectorAll('#env-from-list .env-from-row').forEach(row => {
    const type = row.querySelector('.envfrom-type')?.value || 'configmap';
    const refName = row.querySelector('.envfrom-ref-select')?.value || '';
    const prefix = row.querySelector('.envfrom-prefix')?.value?.trim() || '';
    if (refName) envFrom.push({ type, refName, prefix });
  });

  // Collect multiple service items
  const serviceItems = [];
  document.querySelectorAll('#service-items-list .resource-item').forEach(item => {
    const ports = [];
    item.querySelectorAll('.svc-port-row').forEach(row => {
      ports.push({
        name: row.querySelector('.svc-port-name')?.value?.trim() || 'http',
        port: parseInt(row.querySelector('.svc-port-port')?.value) || 80,
        targetPort: parseInt(row.querySelector('.svc-port-target')?.value) || 80,
        nodePort: parseInt(row.querySelector('.svc-port-nodeport')?.value) || null,
        protocol: row.querySelector('.svc-port-protocol')?.value || 'TCP'
      });
    });
    serviceItems.push({
      name: item.querySelector('.item-name')?.value?.trim() || '',
      type: item.querySelector('.svc-type-select')?.value || 'ClusterIP',
      ports
    });
  });

  const ingressRules = [];
  document.querySelectorAll('#ingress-rules .ingress-rule').forEach(rule => {
    const host = rule.querySelector('.ingress-host')?.value?.trim() || '';
    const paths = [];
    rule.querySelectorAll('.ingress-path-row').forEach(pathRow => {
      paths.push({
        path: pathRow.querySelector('.ingress-path')?.value?.trim() || '/',
        pathType: pathRow.querySelector('.ingress-path-type')?.value || 'Prefix',
        serviceName: pathRow.querySelector('.ingress-svc-name')?.value || '',
        servicePort: parseInt(pathRow.querySelector('.ingress-svc-port')?.value) || 80
      });
    });
    ingressRules.push({ host, paths });
  });

  const ingressAnnotations = {};
  document.querySelectorAll('#ingress-annotations-list .kv-row').forEach(row => {
    const key = row.querySelector('.kv-key')?.value?.trim();
    const value = row.querySelector('.kv-value')?.value?.trim();
    if (key) ingressAnnotations[key] = value || '';
  });

  const tlsHosts = [];
  document.querySelectorAll('#tls-hosts-list .kv-row .kv-key').forEach(input => {
    const val = input.value?.trim();
    if (val) tlsHosts.push(val);
  });

  // Collect multiple PVC items
  const pvcItems = [];
  document.querySelectorAll('#pvc-items-list .resource-item').forEach(item => {
    pvcItems.push({
      name: item.querySelector('.item-name')?.value?.trim() || '',
      storageClass: item.querySelector('.pvc-storage-class')?.value?.trim() || '',
      accessMode: item.querySelector('.pvc-access-mode')?.value || 'ReadWriteOnce',
      storageSize: item.querySelector('.pvc-storage-size')?.value?.trim() || '1Gi'
    });
  });

  // Collect multiple ConfigMap items
  const configMapItems = [];
  document.querySelectorAll('#configmap-items-list .resource-item').forEach(item => {
    const data = [];
    item.querySelectorAll('.kv-row').forEach(row => {
      const key = row.querySelector('.kv-key')?.value?.trim();
      const value = row.querySelector('.kv-value')?.value?.trim();
      if (key) data.push({ key, value: value || '' });
    });
    configMapItems.push({
      name: item.querySelector('.item-name')?.value?.trim() || '',
      data
    });
  });

  // Collect multiple Secret items
  const secretItems = [];
  document.querySelectorAll('#secret-items-list .resource-item').forEach(item => {
    const type = item.querySelector('.secret-type-select')?.value || 'Opaque';
    const name = item.querySelector('.item-name')?.value?.trim() || '';
    
    if (type === 'kubernetes.io/dockerconfigjson') {
      secretItems.push({
        name, type,
        dockerServer: item.querySelector('.docker-server')?.value?.trim() || '',
        dockerUsername: item.querySelector('.docker-username')?.value?.trim() || '',
        dockerPassword: item.querySelector('.docker-password')?.value?.trim() || '',
        dockerEmail: item.querySelector('.docker-email')?.value?.trim() || '',
        data: []
      });
    } else {
      const data = [];
      item.querySelectorAll('.secret-generic-fields .kv-row').forEach(row => {
        const key = row.querySelector('.kv-key')?.value?.trim();
        const value = row.querySelector('.kv-value')?.value?.trim();
        if (key) data.push({ key, value: value || '' });
      });
      secretItems.push({ name, type, data });
    }
  });

  // Volume mounts
  const volumeMounts = [];
  document.querySelectorAll('#volume-mounts .mount-row').forEach(row => {
    const name = row.querySelector('.mount-name')?.value?.trim();
    const mountPath = row.querySelector('.mount-path')?.value?.trim();
    const type = row.querySelector('.mount-type')?.value || 'pvc';
    const subPath = row.querySelector('.mount-subpath')?.value?.trim() || '';
    const refName = row.querySelector('.mount-ref-select')?.value || '';
    if (name && mountPath) {
      volumeMounts.push({ name, mountPath, type, subPath, refName });
    }
  });

  return {
    appName,
    namespace: getNamespace(),
    createNamespace: document.getElementById('namespace').value === '__create__',
    labels: selectorLabels,
    selectorLabels: { app: appName },
    enableDeployment: document.getElementById('enable-deployment').checked,
    image: document.getElementById('image').value.trim() || 'nginx:latest',
    imagePullPolicy: document.getElementById('image-pull-policy').value,
    replicas: parseInt(document.getElementById('replicas').value) || 1,
    containerPorts, envVars,
    cpuRequest: document.getElementById('cpu-request').value.trim(),
    cpuLimit: document.getElementById('cpu-limit').value.trim(),
    memRequest: document.getElementById('mem-request').value.trim(),
    memLimit: document.getElementById('mem-limit').value.trim(),
    volumeMounts, envFrom, imagePullSecrets,
    enableInitPermissions: document.getElementById('enable-init-permissions').checked,
    scRunAsUser: document.getElementById('sc-run-as-user').value.trim(),
    scRunAsGroup: document.getElementById('sc-run-as-group').value.trim(),
    scFsGroup: document.getElementById('sc-fs-group').value.trim(),
    scRunAsNonRoot: document.getElementById('sc-run-as-nonroot').checked,
    scReadOnlyRoot: document.getElementById('sc-readonly-root').checked,
    nodeSelector: (() => {
      const ns = {};
      document.querySelectorAll('#node-selector-list .kv-row').forEach(row => {
        const k = row.querySelector('.kv-key')?.value?.trim();
        const v = row.querySelector('.kv-value')?.value?.trim();
        if (k) ns[k] = v || '';
      });
      return ns;
    })(),
    enableLiveness: document.getElementById('enable-liveness').checked,
    livenessType: document.getElementById('liveness-type').value,
    livenessPath: document.getElementById('liveness-path').value.trim(),
    livenessPort: document.getElementById('liveness-port').value.trim(),
    livenessTcpPort: document.getElementById('liveness-tcp-port').value.trim(),
    livenessExecCmd: document.getElementById('liveness-exec-cmd').value.trim(),
    livenessDelay: document.getElementById('liveness-delay').value.trim(),
    livenessPeriod: document.getElementById('liveness-period').value.trim(),
    enableReadiness: document.getElementById('enable-readiness').checked,
    readinessType: document.getElementById('readiness-type').value,
    readinessPath: document.getElementById('readiness-path').value.trim(),
    readinessPort: document.getElementById('readiness-port').value.trim(),
    readinessTcpPort: document.getElementById('readiness-tcp-port').value.trim(),
    readinessExecCmd: document.getElementById('readiness-exec-cmd').value.trim(),
    readinessDelay: document.getElementById('readiness-delay').value.trim(),
    readinessPeriod: document.getElementById('readiness-period').value.trim(),
    enableService: document.getElementById('enable-service').checked,
    serviceItems,
    enableIngress: document.getElementById('enable-ingress').checked,
    ingressClass: document.getElementById('ingress-class').value.trim(),
    ingressRules, ingressAnnotations,
    ingressTls: document.getElementById('ingress-tls').checked,
    tlsSecret: document.getElementById('tls-secret').value.trim(),
    tlsHosts,
    enablePvc: document.getElementById('enable-pvc').checked,
    pvcItems,
    enableConfigMap: document.getElementById('enable-configmap').checked,
    configMapItems,
    enableSecret: document.getElementById('enable-secret').checked,
    secretItems,
    enableHpa: document.getElementById('enable-hpa').checked,
    hpaMin: parseInt(document.getElementById('hpa-min').value) || 1,
    hpaMax: parseInt(document.getElementById('hpa-max').value) || 5,
    hpaCpu: document.getElementById('hpa-cpu').value.trim(),
    hpaMemory: document.getElementById('hpa-memory').value.trim()
  };
}
