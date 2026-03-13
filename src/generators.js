/**
 * YAML Generators for Kubernetes Resources
 */

/**
 * Generate Namespace YAML
 */
export function generateNamespace(config) {
  if (!config.createNamespace || config.namespace === 'default') return '';
  
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ${config.namespace}
  labels:
${formatLabels(config.labels, 4)}`;
}

/**
 * Generate Deployment YAML
 */
export function generateDeployment(config) {
  if (!config.enableDeployment) return '';
  
  let yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${config.appName}
  namespace: ${config.namespace}
  labels:
${formatLabels(config.labels, 4)}
spec:
  replicas: ${config.replicas}
  selector:
    matchLabels:
${formatLabels(config.selectorLabels, 6)}
  template:
    metadata:
      labels:
${formatLabels(config.selectorLabels, 8)}
    spec:`;

  // Init container for PVC permissions
  const pvcMounts = config.volumeMounts.filter(m => m.type === 'pvc');
  if (config.enableInitPermissions && pvcMounts.length > 0) {
    const uid = config.scRunAsUser || '1000';
    const gid = config.scRunAsGroup || '1000';
    const mkdirCmds = pvcMounts.map(m => `mkdir -p ${m.mountPath}`).join(' && ');
    const chownCmds = pvcMounts.map(m => `chown -R ${uid}:${gid} ${m.mountPath}`).join(' && ');
    const fullCmd = `${mkdirCmds} && ${chownCmds}`;
    yaml += `
      initContainers:
        - name: fix-permissions
          image: busybox:latest
          command: ["sh", "-c", "${fullCmd}"]
          securityContext:
            runAsUser: 0
          volumeMounts:`;
    for (const mount of pvcMounts) {
      yaml += `
            - name: ${mount.name}
              mountPath: ${mount.mountPath}`;
    }
  }

  // Pod-level securityContext (fsGroup, runAsUser, runAsGroup, runAsNonRoot)
  const hasPodSC = config.scRunAsUser || config.scRunAsGroup || config.scFsGroup || config.scRunAsNonRoot;
  if (hasPodSC) {
    yaml += `\n      securityContext:`;
    if (config.scRunAsUser) yaml += `\n        runAsUser: ${config.scRunAsUser}`;
    if (config.scRunAsGroup) yaml += `\n        runAsGroup: ${config.scRunAsGroup}`;
    if (config.scFsGroup) yaml += `\n        fsGroup: ${config.scFsGroup}`;
    if (config.scRunAsNonRoot) yaml += `\n        runAsNonRoot: true`;
  }

  yaml += `
      containers:
        - name: ${config.appName}
          image: ${config.image}
          imagePullPolicy: ${config.imagePullPolicy}`;

  // Container-level securityContext
  if (config.scReadOnlyRoot) {
    yaml += `\n          securityContext:`;
    yaml += `\n            readOnlyRootFilesystem: true`;
  }
  // Ports
  if (config.containerPorts.length > 0) {
    yaml += `\n          ports:`;
    for (const port of config.containerPorts) {
      yaml += `\n            - name: ${port.name}`;
      yaml += `\n              containerPort: ${port.port}`;
      yaml += `\n              protocol: ${port.protocol}`;
    }
  }

  // Environment variables
  if (config.envVars.length > 0) {
    yaml += `\n          env:`;
    for (const env of config.envVars) {
      yaml += `\n            - name: ${env.key}`;
      if (env.source === 'configmap' && env.refName) {
        yaml += `\n              valueFrom:`;
        yaml += `\n                configMapKeyRef:`;
        yaml += `\n                  name: ${env.refName}`;
        yaml += `\n                  key: ${env.refKey || env.key}`;
      } else if (env.source === 'secret' && env.refName) {
        yaml += `\n              valueFrom:`;
        yaml += `\n                secretKeyRef:`;
        yaml += `\n                  name: ${env.refName}`;
        yaml += `\n                  key: ${env.refKey || env.key}`;
      } else {
        yaml += `\n              value: "${env.value || ''}"`;
      }
    }
  }

  // envFrom — import all keys from ConfigMap/Secret
  if (config.envFrom && config.envFrom.length > 0) {
    yaml += `\n          envFrom:`;
    for (const ef of config.envFrom) {
      if (ef.type === 'configmap') {
        yaml += `\n            - configMapRef:`;
        yaml += `\n                name: ${ef.refName}`;
      } else if (ef.type === 'secret') {
        yaml += `\n            - secretRef:`;
        yaml += `\n                name: ${ef.refName}`;
      }
      if (ef.prefix) {
        yaml += `\n              prefix: ${ef.prefix}`;
      }
    }
  }

  // Resources
  const hasResources = config.cpuRequest || config.cpuLimit || config.memRequest || config.memLimit;
  if (hasResources) {
    yaml += `\n          resources:`;
    if (config.cpuRequest || config.memRequest) {
      yaml += `\n            requests:`;
      if (config.cpuRequest) yaml += `\n              cpu: "${config.cpuRequest}"`;
      if (config.memRequest) yaml += `\n              memory: "${config.memRequest}"`;
    }
    if (config.cpuLimit || config.memLimit) {
      yaml += `\n            limits:`;
      if (config.cpuLimit) yaml += `\n              cpu: "${config.cpuLimit}"`;
      if (config.memLimit) yaml += `\n              memory: "${config.memLimit}"`;
    }
  }

  // Probes
  function generateProbe(prefix, config) {
    const type = config[`${prefix}Type`];
    let yaml = '';
    if (type === 'httpGet') {
      yaml += `\n            httpGet:`;
      yaml += `\n              path: ${config[`${prefix}Path`] || '/'}`;
      yaml += `\n              port: ${config[`${prefix}Port`] || 80}`;
    } else if (type === 'tcpSocket') {
      yaml += `\n            tcpSocket:`;
      yaml += `\n              port: ${config[`${prefix}TcpPort`] || 80}`;
    } else if (type === 'exec') {
      const cmds = (config[`${prefix}ExecCmd`] || '').split('\n').filter(c => c.trim());
      yaml += `\n            exec:`;
      yaml += `\n              command:`;
      for (const cmd of cmds) yaml += `\n                - ${cmd.trim()}`;
    }
    if (config[`${prefix}Delay`]) yaml += `\n            initialDelaySeconds: ${config[`${prefix}Delay`]}`;
    if (config[`${prefix}Period`]) yaml += `\n            periodSeconds: ${config[`${prefix}Period`]}`;
    return yaml;
  }

  if (config.enableLiveness) {
    yaml += `\n          livenessProbe:`;
    yaml += generateProbe('liveness', config);
  }

  if (config.enableReadiness) {
    yaml += `\n          readinessProbe:`;
    yaml += generateProbe('readiness', config);
  }

  // Volume mounts
  if (config.volumeMounts.length > 0) {
    yaml += `\n          volumeMounts:`;
    for (const mount of config.volumeMounts) {
      yaml += `\n            - name: ${mount.name}`;
      yaml += `\n              mountPath: ${mount.mountPath}`;
      if (mount.subPath) yaml += `\n              subPath: ${mount.subPath}`;
    }
    yaml += `\n      volumes:`;
    for (const mount of config.volumeMounts) {
      yaml += `\n        - name: ${mount.name}`;
      if (mount.type === 'pvc') {
        yaml += `\n          persistentVolumeClaim:`;
        yaml += `\n            claimName: ${mount.refName || config.appName + '-data'}`;
      } else if (mount.type === 'configmap') {
        yaml += `\n          configMap:`;
        yaml += `\n            name: ${mount.refName || config.appName}`;
      } else if (mount.type === 'secret') {
        yaml += `\n          secret:`;
        yaml += `\n            secretName: ${mount.refName || config.appName}`;
      } else if (mount.type === 'emptyDir') {
        yaml += `\n          emptyDir: {}`;
      }
    }
  }

  // imagePullSecrets
  if (config.imagePullSecrets && config.imagePullSecrets.length > 0) {
    yaml += `\n      imagePullSecrets:`;
    for (const name of config.imagePullSecrets) {
      yaml += `\n        - name: ${name}`;
    }
  }

  // nodeSelector
  const nsKeys = Object.keys(config.nodeSelector || {});
  if (nsKeys.length > 0) {
    yaml += `\n      nodeSelector:`;
    for (const k of nsKeys) {
      yaml += `\n        ${k}: "${config.nodeSelector[k]}"`;
    }
  }

  return yaml;
}

/**
 * Generate Service YAML
 */
export function generateService(config) {
  if (!config.enableService || !config.serviceItems || config.serviceItems.length === 0) return '';
  
  return config.serviceItems.map(svc => {
    let yaml = `apiVersion: v1
kind: Service
metadata:
  name: ${svc.name || config.appName}
  namespace: ${config.namespace}
  labels:
${formatLabels(config.labels, 4)}
spec:
  type: ${svc.type}
  selector:
${formatLabels(config.selectorLabels, 4)}
  ports:`;

    for (const port of svc.ports) {
      yaml += `\n    - name: ${port.name}`;
      yaml += `\n      port: ${port.port}`;
      yaml += `\n      targetPort: ${port.targetPort}`;
      yaml += `\n      protocol: ${port.protocol}`;
      if (svc.type === 'NodePort' && port.nodePort) {
        yaml += `\n      nodePort: ${port.nodePort}`;
      }
    }

    return yaml;
  }).join('\n---\n');
}

/**
 * Generate Ingress YAML
 */
export function generateIngress(config) {
  if (!config.enableIngress) return '';
  
  let yaml = `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${config.appName}
  namespace: ${config.namespace}
  labels:
${formatLabels(config.labels, 4)}`;

  // Annotations
  const annotations = { ...config.ingressAnnotations };
  if (config.ingressClass) {
    annotations['kubernetes.io/ingress.class'] = config.ingressClass;
  }
  
  const annotationKeys = Object.keys(annotations);
  if (annotationKeys.length > 0) {
    yaml += `\n  annotations:`;
    for (const key of annotationKeys) {
      yaml += `\n    ${key}: "${annotations[key]}"`;
    }
  }

  yaml += `\nspec:`;

  if (config.ingressClass) {
    yaml += `\n  ingressClassName: ${config.ingressClass}`;
  }

  // TLS
  if (config.ingressTls && config.tlsHosts.length > 0) {
    yaml += `\n  tls:`;
    yaml += `\n    - secretName: ${config.tlsSecret || config.appName + '-tls'}`;
    yaml += `\n      hosts:`;
    for (const host of config.tlsHosts) {
      yaml += `\n        - ${host}`;
    }
  }

  // Rules
  yaml += `\n  rules:`;
  for (const rule of config.ingressRules) {
    if (rule.host) {
      yaml += `\n    - host: ${rule.host}`;
      yaml += `\n      http:`;
    } else {
      yaml += `\n    - http:`;
    }
    yaml += `\n        paths:`;
    for (const path of rule.paths) {
      yaml += `\n          - path: ${path.path}`;
      yaml += `\n            pathType: ${path.pathType}`;
      yaml += `\n            backend:`;
      yaml += `\n              service:`;
      yaml += `\n                name: ${path.serviceName || config.appName}`;
      yaml += `\n                port:`;
      yaml += `\n                  number: ${path.servicePort}`;
    }
  }

  return yaml;
}

/**
 * Generate PVC YAML — supports multiple PVCs
 */
export function generatePVCs(config) {
  if (!config.enablePvc || !config.pvcItems || config.pvcItems.length === 0) return '';
  
  return config.pvcItems.map(pvc => {
    let yaml = `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${pvc.name || config.appName + '-data'}
  namespace: ${config.namespace}
  labels:
${formatLabels(config.labels, 4)}
spec:
  accessModes:
    - ${pvc.accessMode || 'ReadWriteOnce'}`;

    if (pvc.storageClass) {
      yaml += `\n  storageClassName: ${pvc.storageClass}`;
    }

    yaml += `\n  resources:
    requests:
      storage: ${pvc.storageSize || '1Gi'}`;

    return yaml;
  }).join('\n---\n');
}

/**
 * Generate ConfigMap YAML — supports multiple ConfigMaps
 */
export function generateConfigMaps(config) {
  if (!config.enableConfigMap || !config.configMapItems || config.configMapItems.length === 0) return '';
  
  return config.configMapItems.map(cm => {
    let yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${cm.name || config.appName + '-config'}
  namespace: ${config.namespace}
  labels:
${formatLabels(config.labels, 4)}
data:`;

    for (const item of cm.data) {
      yaml += `\n  ${item.key}: "${item.value}"`;
    }

    return yaml;
  }).join('\n---\n');
}

/**
 * Generate Secret YAML — supports multiple Secrets
 */
export function generateSecrets(config) {
  if (!config.enableSecret || !config.secretItems || config.secretItems.length === 0) return '';
  
  return config.secretItems.map(secret => {
    let yaml = `apiVersion: v1
kind: Secret
metadata:
  name: ${secret.name || config.appName + '-secret'}
  namespace: ${config.namespace}
  labels:
${formatLabels(config.labels, 4)}
type: ${secret.type || 'Opaque'}`;

    if (secret.type === 'kubernetes.io/dockerconfigjson') {
      // Build the .dockerconfigjson structure
      const server = secret.dockerServer || 'https://index.docker.io/v1/';
      const username = secret.dockerUsername || '';
      const password = secret.dockerPassword || '';
      const email = secret.dockerEmail || '';
      const auth = btoa(`${username}:${password}`);
      
      const dockerConfig = {
        auths: {
          [server]: { username, password, email, auth }
        }
      };
      const encoded = btoa(JSON.stringify(dockerConfig));
      yaml += `\ndata:`;
      yaml += `\n  .dockerconfigjson: ${encoded}`;
    } else {
      yaml += `\ndata:`;
      for (const item of secret.data) {
        const encoded = btoa(item.value);
        yaml += `\n  ${item.key}: ${encoded}`;
      }
    }

    return yaml;
  }).join('\n---\n');
}

/**
 * Generate HPA YAML
 */
export function generateHPA(config) {
  if (!config.enableHpa) return '';
  
  let yaml = `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${config.appName}
  namespace: ${config.namespace}
  labels:
${formatLabels(config.labels, 4)}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${config.appName}
  minReplicas: ${config.hpaMin}
  maxReplicas: ${config.hpaMax}
  metrics:`;

  if (config.hpaCpu) {
    yaml += `\n    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: ${config.hpaCpu}`;
  }

  if (config.hpaMemory) {
    yaml += `\n    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: ${config.hpaMemory}`;
  }

  return yaml;
}

/**
 * Helper: Format labels as YAML
 */
function formatLabels(labels, indent) {
  const spaces = ' '.repeat(indent);
  return Object.entries(labels)
    .map(([key, value]) => `${spaces}${key}: ${value}`)
    .join('\n');
}

/**
 * Get all enabled generators and their configs
 */
export function getAllYaml(config) {
  const files = {};
  
  const ns = generateNamespace(config);
  if (ns) files['namespace.yaml'] = ns;
  
  const deploy = generateDeployment(config);
  if (deploy) files['deployment.yaml'] = deploy;
  
  const svc = generateService(config);
  if (svc) files['service.yaml'] = svc;
  
  const ing = generateIngress(config);
  if (ing) files['ingress.yaml'] = ing;
  
  const pvc = generatePVCs(config);
  if (pvc) files['pvc.yaml'] = pvc;
  
  const cm = generateConfigMaps(config);
  if (cm) files['configmap.yaml'] = cm;
  
  const secret = generateSecrets(config);
  if (secret) files['secret.yaml'] = secret;
  
  const hpa = generateHPA(config);
  if (hpa) files['hpa.yaml'] = hpa;
  
  return files;
}
