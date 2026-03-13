#!/bin/bash
# ============================================================
# Kubernetes ServiceAccount RBAC Manager (macOS compatible)
#
# Features:
# [1] Create ServiceAccount + auto export kubeconfig
# [2] Delete ServiceAccount
# [3] Update ServiceAccount RBAC
# [4] Export kubeconfig for existing ServiceAccount
#
# Token duration:
# - Auto convert d,w -> h (kubectl compatible)
# ============================================================

set -e

# ================= COLOR =================
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors)" -ge 8 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; NC=''
fi

run() { eval "$@"; }

require_sa() {
  kubectl get sa "$1" -n "$2" >/dev/null 2>&1 || {
    echo -e "${RED}✗ ServiceAccount không tồn tại${NC}"
    exit 1
  }
}

# ============================================================
# Normalize duration: d,w -> h
# ============================================================
normalize_duration() {
  local input="$1"

  if [[ "$input" =~ ^([0-9]+)d$ ]]; then
    echo "$((BASH_REMATCH[1] * 24))h"
  elif [[ "$input" =~ ^([0-9]+)w$ ]]; then
    echo "$((BASH_REMATCH[1] * 7 * 24))h"
  else
    echo "$input"
  fi
}

# ============================================================
# Build kubeconfig (common)
# ============================================================
build_kubeconfig() {
  local sa=$1
  local sa_ns=$2
  local token=$3
  local suffix=$4

  CLUSTER_NAME=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}')
  SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  CA=$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')

  FILE="./${sa}-${sa_ns}-${suffix}.kubeconfig"

  cat <<EOF > "$FILE"
apiVersion: v1
kind: Config
clusters:
- name: ${CLUSTER_NAME}
  cluster:
    server: ${SERVER}
    certificate-authority-data: ${CA}
users:
- name: ${sa}
  user:
    token: ${token}
contexts:
- name: ${sa}@${CLUSTER_NAME}
  context:
    cluster: ${CLUSTER_NAME}
    user: ${sa}
    namespace: ${sa_ns}
current-context: ${sa}@${CLUSTER_NAME}
EOF

  chmod 600 "$FILE"
  echo -e "${GREEN}✓ Kubeconfig đã tạo:${NC} $FILE"
}

# ============================================================
# Export kubeconfig - token có thời hạn
# ============================================================
export_expiring_kubeconfig() {
  local sa=$1
  local sa_ns=$2

  read -r -p "Nhập thời hạn token (vd: 1h, 8h, 24h, 7d, 2w): " RAW_DURATION

  DURATION=$(normalize_duration "$RAW_DURATION")

  echo -e "${CYAN}→ Dùng duration:${NC} $DURATION"

  TOKEN=$(kubectl create token "$sa" -n "$sa_ns" --duration="$DURATION")

  build_kubeconfig "$sa" "$sa_ns" "$TOKEN" "exp-${DURATION}"
}

# ============================================================
# Export kubeconfig - token KHÔNG hết hạn (legacy)
# ============================================================
export_legacy_kubeconfig() {
  local sa=$1
  local sa_ns=$2

  echo -e "${YELLOW}⚠️  CẢNH BÁO:${NC} Token KHÔNG hết hạn (legacy, rủi ro bảo mật)"
  read -r -p "Bạn chắc chắn muốn tiếp tục? (yes/no): " CONFIRM
  [ "$CONFIRM" != "yes" ] && return

  SECRET_NAME="${sa}-legacy-token"

  kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${SECRET_NAME}
  namespace: ${sa_ns}
  annotations:
    kubernetes.io/service-account.name: ${sa}
type: kubernetes.io/service-account-token
EOF

  echo -e "${CYAN}→ Chờ Kubernetes inject token...${NC}"
  sleep 2

  TOKEN=$(kubectl get secret "$SECRET_NAME" -n "$sa_ns" \
    -o jsonpath='{.data.token}' | base64 --decode)

  build_kubeconfig "$sa" "$sa_ns" "$TOKEN" "legacy"
}

# ============================================================
# Ensure Role cho xem metrics pod
# ============================================================
ensure_metrics_role() {
  local ns=$1

  if ! kubectl get role metrics-reader -n "$ns" >/dev/null 2>&1; then
    kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: metrics-reader
  namespace: $ns
rules:
- apiGroups: ["metrics.k8s.io"]
  resources: ["pods"]
  verbs: ["get", "list"]
EOF
  fi
}

# ============================================================
# Select namespaces (macOS safe)
# ============================================================
select_namespaces() {
  NS_LIST=()
  while IFS= read -r ns; do
    NS_LIST+=("$ns")
  done < <(kubectl get ns -o jsonpath='{.items[*].metadata.name}' | tr ' ' '\n')

  for i in "${!NS_LIST[@]}"; do
    printf "  [%d] %s\n" "$i" "${NS_LIST[$i]}"
  done

  echo -e "${YELLOW}Nhập số tương ứng (cách nhau bởi dấu cách) hoặc 'new':${NC}"
  read -r INPUT

  SELECTED_NS=()

  if [ "$INPUT" = "new" ]; then
    while true; do
      read -r -p "Namespace mới (Enter để kết thúc): " NEWNS
      [ -z "$NEWNS" ] && break
      SELECTED_NS+=("$NEWNS")
    done
  else
    for idx in $INPUT; do
      SELECTED_NS+=("${NS_LIST[$idx]}")
    done
  fi
}

# ================= UI =================
clear
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      ${CYAN}Kubernetes SA RBAC Manager${BLUE}     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"

echo -e "${CYAN}Chọn chức năng:${NC}"
echo "  [1] Tạo ServiceAccount"
echo "  [2] Xóa ServiceAccount"
echo "  [3] Update quyền ServiceAccount"
echo "  [4] Xuất kubeconfig cho ServiceAccount"
echo ""
read -r -p "Lựa chọn: " ACTION

case "$ACTION" in

1)
  read -r -p "ServiceAccount name: " SA
  read -r -p "Namespace tạo SA (default): " SA_NS
  SA_NS=${SA_NS:-default}

  kubectl create ns "$SA_NS" --dry-run=client -o yaml | kubectl apply -f -

  kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: $SA
  namespace: $SA_NS
EOF

  echo -e "${GREEN}✓ ServiceAccount created${NC}"

  echo -e "${CYAN}Chọn loại token export:${NC}"
  echo "  [1] Token có thời hạn"
  echo "  [2] Token KHÔNG hết hạn (legacy)"
  read -r TOKEN_TYPE

  case "$TOKEN_TYPE" in
    1) export_expiring_kubeconfig "$SA" "$SA_NS" ;;
    2) export_legacy_kubeconfig "$SA" "$SA_NS" ;;
  esac

  echo -e "${CYAN}Gán quyền cho namespace:${NC}"
  select_namespaces

  for NS in "${SELECTED_NS[@]}"; do
    read -r -p "Role cho $NS (view/edit/admin): " ROLE

    kubectl create ns "$NS" --dry-run=client -o yaml | kubectl apply -f -

    kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SA}-${ROLE}
  namespace: $NS
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: $ROLE
subjects:
- kind: ServiceAccount
  name: $SA
  namespace: $SA_NS
EOF

    ensure_metrics_role "$NS"

    kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SA}-metrics-reader
  namespace: $NS
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: metrics-reader
subjects:
- kind: ServiceAccount
  name: $SA
  namespace: $SA_NS
EOF
  done
  ;;

2)
  read -r -p "ServiceAccount: " SA
  read -r -p "Namespace: " SA_NS

  for n in $(kubectl get ns -o jsonpath='{.items[*].metadata.name}'); do
    kubectl get rolebinding -n "$n" -o json | jq -r \
      --arg sa "$SA" --arg ns "$SA_NS" \
      '.items[]
       | select(.subjects[]?
         | select(.kind=="ServiceAccount"
           and .name==$sa
           and .namespace==$ns))
       | .metadata.name' \
    | xargs -r kubectl delete rolebinding -n "$n"
  done

  kubectl delete secret "${SA}-legacy-token" -n "$SA_NS" 2>/dev/null || true
  kubectl delete sa "$SA" -n "$SA_NS"

  echo -e "${GREEN}✓ ServiceAccount deleted${NC}"
  ;;

3)
  read -r -p "ServiceAccount: " SA
  read -r -p "Namespace của SA: " SA_NS
  require_sa "$SA" "$SA_NS"

  for n in $(kubectl get ns -o jsonpath='{.items[*].metadata.name}'); do
    kubectl get rolebinding -n "$n" -o json | jq -r \
      --arg sa "$SA" --arg ns "$SA_NS" \
      '.items[]
       | select(.subjects[]?
         | select(.kind=="ServiceAccount"
           and .name==$sa
           and .namespace==$ns))
       | .metadata.name' \
    | xargs -r kubectl delete rolebinding -n "$n"
  done

  echo -e "${CYAN}Chọn namespace gán quyền mới:${NC}"
  select_namespaces

  for NS in "${SELECTED_NS[@]}"; do
    read -r -p "Role cho $NS (view/edit/admin): " ROLE

    kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SA}-${ROLE}
  namespace: $NS
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: $ROLE
subjects:
- kind: ServiceAccount
  name: $SA
  namespace: $SA_NS
EOF

    ensure_metrics_role "$NS"

    kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SA}-metrics-reader
  namespace: $NS
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: metrics-reader
subjects:
- kind: ServiceAccount
  name: $SA
  namespace: $SA_NS
EOF
  done

  echo -e "${GREEN}✓ RBAC updated${NC}"
  ;;

4)
  read -r -p "ServiceAccount: " SA
  read -r -p "Namespace của SA: " SA_NS
  require_sa "$SA" "$SA_NS"

  echo -e "${CYAN}Chọn loại token:${NC}"
  echo "  [1] Token có thời hạn"
  echo "  [2] Token KHÔNG hết hạn (legacy)"
  read -r TOKEN_TYPE

  case "$TOKEN_TYPE" in
    1) export_expiring_kubeconfig "$SA" "$SA_NS" ;;
    2) export_legacy_kubeconfig "$SA" "$SA_NS" ;;
  esac
  ;;

*)
  echo -e "${RED}Lựa chọn không hợp lệ${NC}"
  ;;
esac
