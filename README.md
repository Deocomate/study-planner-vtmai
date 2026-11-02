# Study Planner – Ben & Shin (bàn giao cho dev)

Ứng dụng lên lịch học cho Ben (lớp 5), Shin (lớp 4) và việc chuẩn bị của mẹ. Bản đang dùng là một trang web chạy trên claude.ai (artifact): https://claude.ai/artifact/8USbApC9iwG41HFaV6sBNd

## Trong gói này

| Thư mục | Nội dung |
|---|---|
| `web-app/` | **Mã nguồn bản đang dùng.** Vanilla JS, không framework, không thư viện. |
| `web-app/src/` | `js1.js` (tiện ích, ngày giờ, state, điểm thưởng) · `js2.js` (giao diện chung, form việc, đính kèm file, theme theo người dùng, màn hình chào, hình động hai bên) · `js3.js` (Hôm nay, Tháng, Hiệu suất, Tài liệu, Học sinh) · `js4.js` (Phần thưởng, nhập Excel/CSV, xếp lịch, phiếu in) · `js5.js` (nhắc việc, khởi động) · `style.css` |
| `web-app/i18n/vi.json` | Bản dịch tiếng Việt (key = câu tiếng Anh trong `t('…')`). |
| `web-app/build.py` | Gộp `src/` + `i18n/` thành một file `dist/index.html`. Chạy: `python3 build.py`. |
| `web-app/dist/index.html` | Bản build, giống bản đang chạy trên claude.ai. Mở trực tiếp bằng trình duyệt cũng chạy. |
| `web-app/docs/DATA_MODEL.md` | Cấu trúc dữ liệu, nơi lưu, luật xếp lịch, tính điểm, nhập Excel. |
| `web-app/samples/` | File Excel/CSV mẫu (định dạng mới và định dạng có cột lặp lại), file PDF mẫu. |
| `web-app/tests/smoke.test.js` | Kiểm thử nhanh bằng Playwright (`npm i -D playwright && npx playwright install chromium && node tests/smoke.test.js`). |
| `database/` | `schema.sql` (lược đồ SQL cho backend thật, theo đúng mô hình dữ liệu hiện tại), `seed.sql` / `seed.json` (học sinh, giáo viên, môn, lịch học thêm, phần thưởng, luật điểm), `study_planner.sqlite` (đã tạo sẵn từ schema + seed). |
| `legacy-server-prototype/` | Bản thử nghiệm đầu tiên có server: Node.js 22, không phụ thuộc thư viện ngoài, SQLite (`migrations/001_init.sql`), đăng nhập phụ huynh/con, email nhắc việc, đọc ảnh/PDF qua API, Dockerfile, 77 test (`npm test`). Giao diện và tính năng cũ hơn bản `web-app/`, nhưng phần backend dùng lại được. |

## Lưu ý quan trọng cho dev

- **Bản đang dùng không có database trên server.** Mọi dữ liệu (bài tập, điểm, file đính kèm) nằm trong trình duyệt của người dùng (localStorage + IndexedDB) và kho file của claude.ai. Vì vậy dữ liệu thật của gia đình **không có trong gói này**. Thư mục `database/` chỉ có lược đồ và dữ liệu mặc định.
- Muốn dùng chung giữa các máy (mẹ nhập, con xem trên máy khác) thì cần backend thật: dùng `database/schema.sql`, chuyển state `D` (xem `DATA_MODEL.md`) sang API, file đính kèm sang object storage.
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
