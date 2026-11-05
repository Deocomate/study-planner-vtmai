# Hướng Dẫn Deploy Study Planner Lên Coolify

Tài liệu này hướng dẫn chi tiết cách cấu hình và triển khai dự án **Study Planner** lên **Coolify** sử dụng **Dockerfile** và **Docker Compose** với cơ chế `expose` port để tránh xung đột cổng (port collision) trên máy chủ/VPS.

---

## 1. Tại Sao Dùng `expose` Thay Vì `ports`?

- Khi dùng `ports: - "3000:3000"`, Docker sẽ cố gắng bind cổng 3000 trực tiếp vào IP của máy chủ host (`0.0.0.0:3000`). Nếu trên máy chủ đã có một ứng dụng hoặc container khác đang dùng cổng 3000, lệnh chạy sẽ bị lỗi: `bind: address already in use`.
- Khi dùng `expose: - "3000"`, cổng 3000 **chỉ mở bên trong mạng nội bộ Docker**. Coolify sử dụng Reverse Proxy (Traefik) để nhận yêu cầu từ domain bên ngoài (cổng 80/443) và chuyển tiếp trực tiếp vào cổng 3000 của container.
- **Lợi ích**: Bạn có thể chạy bao nhiêu ứng dụng hoặc nhiều container dùng cổng 3000 tuỳ ý trên cùng một VPS mà không bao giờ bị trùng cổng.

---

## 2. Các Bước Triển Khai Trên Coolify

### Bước 1: Thêm Resource Mới Trên Dashboard Coolify
1. Truy cập vào giao diện web của **Coolify**.
2. Chọn **Project** và **Environment** bạn muốn triển khai.
3. Nhấn **+ New** -> chọn **Git Repository** (hoặc GitHub App nếu đã liên kết).
4. Nhập URL của Git repository chứa mã nguồn dự án này.
5. Chọn nhánh (Branch) cần deploy (ví dụ: `main`).

### Bước 2: Chọn Phương Thức Build (Docker Compose)
- Coolify sẽ tự động nhận diện file `docker-compose.yml` ở thư mục gốc của repository.
- Kiểu build (Build Pack): Chọn **Docker Compose**.
- Compose File: `./docker-compose.yml`.

### Bước 3: Cấu Hình Domain (FQDN)
1. Trong trang cài đặt ứng dụng trên Coolify, tìm ô **Domains** hoặc **FQDN**.
2. Nhập domain / subdomain mà bạn đã trỏ DNS về IP của VPS (ví dụ: `https://study.yourdomain.com`).
3. Coolify (Traefik) sẽ tự động tạo chứng chỉ SSL miễn phí (Let's Encrypt) và route lưu lượng HTTPS tới cổng `3000` nội bộ của container.

### Bước 4: Cấu Hình Biến Môi Trường (Environment Variables)
Chuyển qua tab **Environment Variables** trong Coolify và thêm các biến cần thiết:

| Tên biến | Giá trị mẫu | Bắt buộc? | Mô tả |
|---|---|---|---|
| `APP_BASE_URL` | `https://study.yourdomain.com` | Khuyên dùng | Domain chính thức của ứng dụng (dùng tạo link trong email nhắc việc). |
| `TZ` | `Asia/Ho_Chi_Minh` | Tuỳ chọn | Múi giờ dùng cho tên file sao lưu. |
| `APP_PASSWORD` | `MatKhauGiaDinh2026` | **Nên đặt** | Mật khẩu mở trang web (trình duyệt hỏi khi vào). Để trống = ai có link cũng xem/sửa được dữ liệu. |
| `APP_USER` | `me` | Tuỳ chọn | Tên đăng nhập; để trống = tên gì cũng được, chỉ cần đúng mật khẩu. |
| `MAX_UPLOAD_MB` | `20` | Tuỳ chọn | Giới hạn dung lượng mỗi file đính kèm (mặc định 20MB). |
| `MAX_IMPORT_MB` | `1024` | Tuỳ chọn | Giới hạn dung lượng file .zip khi nhập dữ liệu. |
| `KEEP_BACKUPS` | `30` | Tuỳ chọn | Số bản sao lưu tự động giữ lại trong `/data/backups`. |

### Bước 5: Kiểm Tra Volume Lưu Trữ Dữ Liệu
Trong `docker-compose.yml`, volume được định nghĩa:
```yaml
volumes:
  - study_data:/data
```
Volume này đảm bảo cơ sở dữ liệu SQLite (`/data/study_planner.sqlite`, chứa cả bài tập lẫn file đính kèm) và các bản sao lưu tự động (`/data/backups`) được lưu trên ổ cứng VPS của Coolify, không bị mất khi redeploy hoặc cập nhật code.

### Bước 6: Nhấn Deploy
1. Nhấn nút **Deploy** ở góc phải trên Coolify.
2. Theo dõi build log trong vài chục giây (Node.js 22 LTS khởi động rất nhanh vì không có `node_modules` nặng nề).
3. Sau khi trạng thái chuyển sang **Running (Healthy)**, truy cập vào domain của bạn.

---

## 3. Trải Nghiệm Ứng Dụng Sau Khi Deploy

1. Mở trình duyệt và truy cập: `https://study.yourdomain.com`.
2. Hệ thống sẽ hiển thị giao diện **chính thức bản gốc của khách hàng** (`web-app`):
   - Màn hình chào (**Splash screen**) tương tác sinh động với sticker hoạt hình tự vẽ và thông báo việc cần làm trong ngày cho Mẹ / Ben / Shin.
   - Giao diện đổi theme tự động theo vai trò người dùng (Ben màu đỏ, Shin màu xanh, Mẹ màu nâu).
   - Trang **Hôm nay**: phân chia rõ ràng Việc của mẹ, Bài quá hạn, Hạn hôm nay, Luyện tập hằng ngày; cột bên phải hiển thị Lịch học thêm và Hạn nộp trong tuần.
   - Đầy đủ tính năng: Nhập file Excel/CSV xem trước (`Import`), Thêm việc (`Add task`), Xem lịch tháng (`Month`), Phiếu in bài tập (`Print sheet`), Phần thưởng & tích điểm iPad (`Rewards`), và giao diện tối ưu trên điện thoại.
   - Hình ảnh giao diện thực tế đối chiếu chuẩn xác với 10 ảnh mẫu trong thư mục `web-app/docs/screenshots/`.
3. Dữ liệu được lưu trên máy chủ và dùng chung giữa các máy.
4. **Sao lưu / khôi phục:** vào `https://study.yourdomain.com/backup` → "Tải bản sao lưu (.zip)" để xuất, hoặc chọn file .zip rồi "Nhập dữ liệu" để khôi phục.
