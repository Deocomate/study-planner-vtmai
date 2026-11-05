# Study Planner – Ben & Shin (bàn giao cho dev)

Ứng dụng lên lịch học cho Ben (lớp 5), Shin (lớp 4) và việc chuẩn bị của mẹ. Bản đang dùng là một trang web chạy trên claude.ai (artifact): https://claude.ai/artifact/8USbApC9iwG41HFaV6sBNd

## Trong gói này

| Thư mục | Nội dung |
|---|---|
| `web-app/` | **Mã nguồn bản đang dùng.** Vanilla JS, không framework, không thư viện. |
| `web-app/src/` | `js1.js` (tiện ích, ngày giờ, state, điểm thưởng) · `js2.js` (giao diện chung, form việc, đính kèm file, theme theo người dùng, màn hình chào, hình động hai bên) · `js3.js` (Hôm nay, Tháng, Hiệu suất, Tài liệu, Học sinh) · `js4.js` (Phần thưởng, nhập Excel/CSV, xếp lịch, phiếu in) · `js5.js` (nhắc việc, khởi động) · `style.css` |
| `web-app/i18n/vi.json` | Bản dịch tiếng Việt (key = câu tiếng Anh trong `t('…')`). |
| `web-app/build.py` / `web-app/build.mjs` | Gộp `src/` + `i18n/` thành một file `dist/index.html`. Chạy: `python3 build.py` hoặc `node build.mjs` (cùng kết quả, không cần Python). |
| `server/` | **Backend Node.js** (không thư viện ngoài, dùng `node:sqlite`): phục vụ giao diện `web-app` và lưu toàn bộ dữ liệu vào SQLite (`/data/study_planner.sqlite`), xuất/nhập dữ liệu bằng file .zip, sao lưu tự động hằng ngày. Test: `cd server && npm test`. |
| `web-app/dist/index.html` | Bản build, giống hệt bản đang chạy trên claude.ai (đã đối chiếu ngày 4/11/2026). Mở trực tiếp bằng trình duyệt là chạy, có dữ liệu mẫu ở `samples/` để import thử. |
| `web-app/docs/screenshots/` | Ảnh chụp giao diện từng màn hình: màn hình chào của Mẹ / Ben / Shin, Hôm nay, Nhập file, Thêm việc, Tháng, Phiếu in, Phần thưởng, điện thoại. |
| `web-app/docs/DATA_MODEL.md` | Cấu trúc dữ liệu, nơi lưu, luật xếp lịch, tính điểm, nhập Excel. |
| `web-app/samples/` | File Excel/CSV mẫu (định dạng mới và định dạng có cột lặp lại), file PDF mẫu. |
| `web-app/tests/smoke.test.js` | Kiểm thử nhanh bằng Playwright (`npm i -D playwright && npx playwright install chromium && node tests/smoke.test.js`). |
| `database/` | `schema.sql` (lược đồ SQL cho backend thật, theo đúng mô hình dữ liệu hiện tại), `seed.sql` / `seed.json` (học sinh, giáo viên, môn, lịch học thêm, phần thưởng, luật điểm), `study_planner.sqlite` (đã tạo sẵn từ schema + seed). |
| `legacy-server-prototype/` | Bản thử nghiệm đầu tiên có server: Node.js 22, không phụ thuộc thư viện ngoài, SQLite (`migrations/001_init.sql`), đăng nhập phụ huynh/con, email nhắc việc, đọc ảnh/PDF qua API, Dockerfile, 77 test (`npm test`). Giao diện và tính năng cũ hơn bản `web-app/`, nhưng phần backend dùng lại được. |

## Lưu ý quan trọng cho dev

- **Có backend (`server/`) từ 05/11/2026.** Khi trang được mở qua server này, toàn bộ state `D` và file đính kèm được lưu trong SQLite trên server, dùng chung giữa các máy (tự đồng bộ mỗi 15 giây và khi quay lại tab). Mở `dist/index.html` trực tiếp (không có server) thì vẫn chạy như cũ, lưu trong trình duyệt.
- Lần đầu một trình duyệt kết nối server: nếu server còn trống thì dữ liệu của trình duyệt đó được đưa lên; nếu server đã có dữ liệu thì các bài tập riêng của trình duyệt được gộp vào (không mất). File đính kèm cũ trong IndexedDB tự được chuyển lên server.
- **Sao lưu:** trang `/backup` (không nằm trong giao diện chính) có nút Xuất dữ liệu → tải `study-planner-backup_DD-MM-YYYY_HH-mm-ss.zip` (gồm `manifest.json`, `data.json`, `files.json`, `files/<id>/<tên file>`), và Nhập dữ liệu từ file zip đó. Server tự lưu 1 bản trước mỗi lần nhập và 1 bản mỗi ngày trong `/data/backups`.
- API: `GET/PUT /api/state`, `POST /api/files`, `GET /_blob/:id`, `GET /api/export`, `POST /api/import`, `GET /api/backups` (xem đầu file `server/index.js`).
- Bảo vệ bằng mật khẩu: đặt biến `APP_PASSWORD` (và tuỳ chọn `APP_USER`) → trình duyệt hỏi mật khẩu trước khi mở trang. Để trống thì ai có link cũng vào được.
- Trang chạy trong khung bảo mật của claude.ai: không gọi được `window.print`, không tải file trực tiếp (dùng capability `downloads`), không gọi mạng ra ngoài. Ngoài claude.ai thì những giới hạn này không còn.
- Không có khoá API hay mật khẩu nào trong gói. `legacy-server-prototype/.env.example` chỉ là mẫu.

## Tính năng chính (bản web-app)

- Trang Hôm nay chia phần: Việc của mẹ · Quá hạn · Hạn hôm nay · Luyện tập hằng ngày, sắp theo giáo viên (Vinschool trước), ô Lịch học thêm và Hạn nộp trong tuần ở cột phải.
- Nhập Excel `STT | Tên giáo viên | Tên môn học | Bài tập | Due date | Link`, xem lại trước khi lưu. Due date là ngày làm bài.
- Thêm/sửa việc (môn và giáo viên chọn từ danh sách, có "+ Thêm mới"), lặp lại hằng tuần, đính kèm file để in.
- Phiếu học in được (Overdue / Due / Daily tasks, cột giáo viên).
- Tháng, Hiệu suất tuần, Phần thưởng và điểm (iPad, quà), Tài liệu, thời khoá biểu.
- Theme theo người dùng: Ben đỏ, Shin xanh, Mẹ nâu, nền ca-rô vẽ tay (tạo bằng SVG trong code). Màn hình chào có hình hoạt hình động ở viền, hình động ở hai bên trang chính trên màn hình rộng. Tất cả hình là SVG tự vẽ trong `js2.js` (`STK`), không dùng ảnh hay nhân vật có bản quyền.
- Tiếng Anh / tiếng Việt, sáng/tối, trang trí ngày lễ.
