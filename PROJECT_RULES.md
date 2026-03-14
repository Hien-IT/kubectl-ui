# PROJECT_RULES.md

## 1. Project Overview
**Kubectl UI (K8s Manager)** là một ứng dụng Desktop được xây dựng bằng **Tauri (Rust)** kết hợp với **Vite** và **Vanilla JavaScript**. Ứng dụng này cung cấp ba tính năng chính:
- **YAML Generator**: Một form UI đồ sộ để giúp cấu hình và sinh ra các file YAML Kubernetes chuẩn (Deployment, Service, Ingress, ConfigMap, Secret, PVC, HPA, v.v.).
- **K8s Manager**: Giao diện giống Lens để duyệt, xem thông tin tài nguyên, theo dõi metrics, xem logs và thay đổi file YAML trực tiếp trên cluster.
- **ServiceAccount (SA) Manager**: Công cụ tự động hóa việc tạo SA, gán RoleBinding cho namespace, và xuất file kubeconfig an toàn.

## 2. Architecture & File Structure

### Backend (Tauri/Rust)
- **`src-tauri/src/main.rs`, `lib.rs`**: Điểm khởi tạo ứng dụng Tauri và đăng ký các commands.
- **`src-tauri/src/shell.rs`**: Injection môi trường shell của người dùng (PATH, KUBECONFIG) để đảm bảo các lệnh `kubectl` chạy chính xác.
- **`src-tauri/src/commands/`**: Chứa các hàm Rust gọi `kubectl` thông qua `std::process::Command` và trả về kết nối standard output (`stdout`/`stderr`) cho Frontend xử lý.

### Frontend (Vanilla JS + Vite)
Ứng dụng hoàn toàn sử dụng VanillaJS, thao tác DOM trực tiếp không qua framework ảo (ví dụ: không React/Vue).
- **`src/main.js`**: Orchestrator file, gọi các hàm `init...` để thiết lập các module khi DOMContentLoaded.
- **`src/tauri.js`**: Wrapper logic kết nối với Tauri backend qua `invoke`. Nếu không ở trong Tauri, fallback sang "Browser Mode".
- **YAML Generator Modules**:
  - `src/form-creators.js`: Tạo các phần tử DOM động cho Form (ví dụ tạo row cho PVC, ConfigMap, Mount).
  - `src/form-lists.js`: Bắt các sự kiện click nút Add/Remove cho các mảng input động.
  - `src/form-collectors.js`: Hàm `collectConfig()` đọc toàn bộ trạng thái DOM của Generator và trả về cấu hình JSON tổng hợp.
  - `src/generators.js`: Pure functions nhận cấu hình JSON và trả về chuỗi YAML.
- **K8s Resource Browser modules**:
  - `src/k8s-manager.js`: Quản lý việc fetch (`kubectl get`), hiển thị danh sách (Table), lazy-load Pod metrics, kéo thả columns, và mở bảng chi tiết (Logs, Events, YAML edit).
- **Service Account Module**:
  - `src/sa-manager.js`: Quy trình tạo Namespace, ServiceAccount, apply manifest RoleBinding, và chạy `kubectl create token` hoặc sinh legacy-token secret để xuất Kubeconfig.
- **Editors & Tools**:
  - `src/yaml-editor.js`: Khởi tạo và thiết lập thư viện bộ gõ Monaco Editor với Syntax Highlighting cho file YAML và tự động auto-complete khóa Kubernetes.
  - `src/preview.js`: Render YAML syntax highlights ra HTML bên phải tab Generator.
  - `src/actions.js`: Xử lý click button Apply All, Download YAML...
  - `src/modal.js`, `src/utils.js`, `src/namespace.js`, `src/context.js`: Các component UI nhỏ phục vụ toàn bộ app.

## 3. Quy trình chuẩn cho AI và Lập Trình Viên (MANDATORY WORKFLOW)

Để đảm bảo không làm ảnh hưởng tính năng cũ khi tạo tính năng mới (hoặc chỉnh sửa), AI phải tuân thủ nghiêm ngặt quy trình sau đây:

**QUY TRÌNH PHÁT TRIỂN / CHỈNH SỬA TÍNH NĂNG**:
1. **Khảo sát tính năng cũ**: Trước khi đụng vào code, AI **phải** dùng công cụ đọc mã nguồn của tính năng/module liên quan để nắm rõ logic hiện tại ở cả Frontend lẫn Backend. 
2. **Đề xuất hướng giải quyết**: AI **bắt buộc** phải đưa ra mô tả giải pháp (solution) rõ ràng bằng tiếng Việt cho User thông qua tính năng chat (`notify_user`).
3. **Chờ sự đồng ý**: Trạng thái lúc này phải dừng lại để User đọc và xác nhận. KHÔNG TỰ ĐỘNG SỬA CODE ngay.
4. **Cập nhật tài liệu trước**: Sau khi User đồng ý với giải pháp, điều đầu tiên cần làm là **cập nhật lại các tài liệu kiến trúc hoặc file `PROJECT_RULES.md` / `.cursorrules`** để phản ánh thay đổi mới và duy trì tính nhất quán.
5. **Thực thi sửa code**: Cuối cùng mới tiến hành sửa target source code.
6. **Tiêu chuẩn ngôn ngữ**: 
   - Code commit message **bắt buộc** dùng tiếng Anh chuẩn `commitizen` format (`feat: ...`, `fix: ...`, `refactor: ...`).
   - Mọi cuộc hội thoại và giải thích với User **bắt buộc** 100% bằng tiếng Việt.

## 4. State Management Convetions
- DOM đóng vai trò là single source of truth cho Generator UI.
- LocalStorage được dùng trong `k8s-manager.js` để lưu lại trạng thái cột (rộng, thứ tự) bằng keys như `k8s-col-state`, `k8s-detail-height`, `k8s-col-lock`.
- Mọi event binding động cho phần list nên đưa về Root / Event Delegation hoặc bind sau khi DOM Element được khởi tạo (xem cách `form-lists.js` hoạt động).
