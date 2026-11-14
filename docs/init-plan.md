Để vận hành ổn định 24/7 trên môi trường **Debian (`proot-distro`) trong Termux** với mức tiêu thụ RAM thấp nhất, kiến trúc dự án cần tách biệt hoàn toàn lớp lõi (Scheduler, Deduplication, Discord Dispatcher) khỏi lớp thu thập dữ liệu (Providers) thông qua một giao diện chuẩn (`FeedProvider`). Khi mở rộng sang Instagram hoặc Facebook sau này, bạn chỉ cần thêm file provider mới và đăng ký vào hệ thống mà không phải sửa code cốt lõi.

---

### 1. Kiến trúc hệ thống & Cấu trúc thư mục

Để tối ưu bộ nhớ (giữ mức RAM quanh **50–80 MB**), bot sẽ giao tiếp với Discord thông qua **Webhook REST API** (thay vì giữ kết nối WebSocket Gateway tốn RAM) và dùng **SQLite tích hợp sẵn trong Node.js 22+** (`node:sqlite`) để không phải biên dịch native C++ addon trên kiến trúc ARM64 của điện thoại.

```text
discord-feed-bot/
├── config/
│   ├── targets.json          # Danh sách tài khoản X/IG/FB cần theo dõi & Webhook đích
│   └── sessions.json         # Lưu cookie/token (auth_token, ct0...) tách biệt để dễ hot-reload
├── data/
│   └── feed_state.db         # File SQLite lưu ID bài viết đã gửi (tránh trùng lặp)
├── src/
│   ├── core/
│   │   ├── database.ts       # Quản lý SQLite (check trùng, lưu lịch sử, tự dọn dẹp > 30 ngày)
│   │   ├── scheduler.ts      # Vòng lặp quét có Random Jitter & hàng đợi tuần tự (Queue)
│   │   └── dispatcher.ts     # Định dạng Discord Embed, tải media buffer & gửi qua Webhook
│   ├── providers/
│   │   ├── base.provider.ts  # Interface chuẩn (FeedItem, FeedProvider) cho mọi nền tảng
│   │   ├── x.provider.ts     # [Giai đoạn 1] Cào dữ liệu từ X (GraphQL API)
│   │   ├── ig.provider.ts    # [Giai đoạn 2] Mở rộng cho Instagram
│   │   └── fb.provider.ts    # [Giai đoạn 3] Mở rộng cho Facebook
│   ├── utils/
│   │   ├── http.ts           # Wrapper giả lập TLS Fingerprint / Header chuẩn trình duyệt
│   │   └── notifier.ts       # Gửi cảnh báo riêng cho Admin khi cookie hết hạn (401/403)
│   └── index.ts              # Entry point khởi chạy hệ thống
├── ecosystem.config.cjs      # Cấu hình PM2 giới hạn RAM và auto-restart
├── package.json
└── tsconfig.json

```

---

### 2. Kế hoạch triển khai chi tiết theo từng giai đoạn

#### Giai đoạn 1: Khóa cứng hạ tầng Termux & Debian (Chống bị Android kill)

Android có cơ chế tự động đóng các tiến trình con (`proot`) chạy ngầm nếu tiêu thụ CPU/RAM vượt ngưỡng. Cần xử lý triệt để trước khi viết code:

1. **Cấu hình phía Android & Termux:**
* Bật **Acquire Wakelock** trên thanh thông báo của Termux.
* Vào *Cài đặt Android > Ứng dụng > Termux > Pin* chọn **Không hạn chế (Unrestricted)**.
* Chạy lệnh ADB (một lần duy nhất từ PC hoặc LADB trên máy) để tắt *Phantom Process Killer* (Android 12+):
```bash
adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent"
adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"

```




2. **Cài đặt môi trường tối giản trong Debian (`proot-distro login debian`):**
```bash
apt update && apt upgrade -y
apt install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2 typescript

```



---

#### Giai đoạn 2: Xây dựng Core Engine & Plugin Interface (Ngày 1 - 2)

Thiết kế các module nền tảng để đảm bảo bot chạy nhẹ và dễ mở rộng:

1. **Chuẩn hóa dữ liệu (`base.provider.ts`):**
Mọi nền tảng (X, IG, FB) sau khi cào đều phải quy về một cấu trúc thống nhất:
```typescript
export interface FeedItem {
  id: string;              // Định danh duy nhất (VD: "x:185692019283")
  platform: 'x' | 'ig' | 'fb';
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  content: string;
  url: string;
  mediaUrls: string[];     // Danh sách link ảnh/thumbnail
  createdAt: Date;
}

export interface FeedProvider {
  platform: 'x' | 'ig' | 'fb';
  fetchLatest(targetHandle: string): Promise<FeedItem[]>;
}

```


2. **SQLite Deduplication (`database.ts`):**
* Sử dụng module `node:sqlite` có sẵn của Node 22.
* Tạo bảng `posts (id TEXT PRIMARY KEY, platform TEXT, created_at INTEGER)`.
* Tích hợp hàm `cleanupOldRecords()` chạy mỗi 24h để xóa các bản ghi cũ hơn 30 ngày, giữ dung lượng file `.db` luôn dưới vài MB.


3. **Smart Scheduler (`scheduler.ts`):**
* **Không chạy song song ồ ạt:** Dùng hàng đợi tuần tự (Sequential Queue) kèm độ trễ `2–5 giây` giữa mỗi tài khoản cần quét để tránh đột biến CPU/RAM trên điện thoại và tránh bị X đánh dấu spam IP.
* **Random Jitter:** Thay vì cron cố định mỗi 5 phút, sử dụng `setTimeout` đệ quy với khoảng nghỉ ngẫu nhiên từ **4 đến 7 phút** (`240_000ms + Math.random() * 180_000ms`).



---

#### Giai đoạn 3: Triển khai X (Twitter) Provider (Ngày 3 - 4)

Thay vì dùng trình duyệt ảo (Chromium ngốn >500MB RAM), sử dụng trực tiếp **Internal GraphQL API** của X Web Client:

1. **Cơ chế xác thực (Session-based):**
* Tạo một tài khoản X phụ (burner account), đăng nhập trên trình duyệt máy tính và trích xuất 2 giá trị cookie: `auth_token` và `ct0`.
* Lưu vào `config/sessions.json` để bot có thể tự đọc lại file khi bạn cập nhật cookie mới mà không cần khởi động lại tiến trình.


2. **Luồng gọi API của `x.provider.ts`:**
* **Bước 1:** Gọi GraphQL `UserByScreenName` để chuyển đổi `@username` sang `rest_id` (lưu cache `rest_id` vào SQLite để không phải gọi lại bước này ở các lần quét sau).
* **Bước 2:** Gọi GraphQL `UserTweets` với `rest_id` và `count: 5` (chỉ lấy 5 bài mới nhất để giảm kích thước JSON phản hồi).
* **Bước 3:** Lọc bỏ bài ghim cũ (`Pinned Tweet`) nếu thời gian đăng nhỏ hơn mốc trong DB, bóc tách text, trích xuất ảnh chất lượng cao (`media_url_https`) và link bài viết.


3. **Cơ chế cảnh báo lỗi (Healthcheck):**
* Nếu API trả về HTTP `401` hoặc `403` (cookie hết hạn hoặc tài khoản phụ bị khóa), `notifier.ts` sẽ bắn ngay một tin nhắn màu đỏ vào kênh Admin trên Discord và tạm dừng provider X để tránh spam request lỗi.



---

#### Giai đoạn 4: Vận hành 24/7 với PM2 & Lộ trình mở rộng (Ngày 5+)

1. **Cấu hình PM2 (`ecosystem.config.cjs`):**
Giới hạn cứng mức RAM tối đa là **150MB**; nếu rò rỉ bộ nhớ, PM2 sẽ tự khởi động lại bot trong 3 giây:
```javascript
module.exports = {
  apps: [
    {
      name: 'discord-feed-bot',
      script: './dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};

```


Khởi chạy: `npm run build && pm2 start ecosystem.config.cjs && pm2 save`.
2. **Lộ trình cắm thêm Instagram & Facebook sau này:**
* **Mở rộng Instagram (`ig.provider.ts`):**
* Gọi endpoint `/api/v1/users/web_profile_info/?username=<handle>` kèm cookie `sessionid` và header `X-IG-App-ID`.
* *Điểm lưu ý ở `dispatcher.ts`:* Vì CDN ảnh của Instagram chặn hiển thị trực tiếp trên Discord (hotlink protection), cần bổ sung logic tải ảnh về dạng `Buffer` trong RAM rồi gửi đính kèm file (`files: [{ attachment: buffer, name: 'post.jpg' }]`) lên Discord Webhook.


* **Mở rộng Facebook (`fb.provider.ts`):**
* Do Facebook mã hóa cấu trúc GraphQL rất phức tạp và dễ dính checkpoint theo IP di động, giải pháp nhẹ nhất trên Termux là triển khai một container/script **RSS-Bridge** cục bộ hoặc cào qua giao diện rút gọn (`mbasic.facebook.com`) bằng cookie tài khoản phụ, sau đó map dữ liệu trả về đúng chuẩn `FeedItem` đã định nghĩa ở Giai đoạn 2.