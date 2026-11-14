# 🤖 Discord Feed Bot (Node.js)

Bot tự động cào bài viết mới từ mạng xã hội (**X / Twitter**, mở rộng được cho **Instagram**, **Facebook**) và gửi thông báo qua Discord Webhook. Hỗ trợ quản lý danh sách theo dõi trực tiếp từ Discord thông qua **Slash Commands (`/feed`)**.

Được tối ưu để chạy **24/7 trên môi trường Debian (`proot-distro`) trong Termux (Android)** hoặc bất kỳ máy chủ Linux / VPS nào với mức tiêu thụ tài nguyên cực thấp (RAM giới hạn 500MB qua PM2, zero native dependencies).

---

## 📁 Cấu trúc thư mục

```text
discord-feed-bot-nodejs/
├── config/
│   ├── targets.json            # Cấu hình Webhook, bot token & danh sách theo dõi
│   ├── targets.example.json    # Mẫu cấu hình targets
│   ├── sessions.json           # Cookie xác thực X (auth_token, ct0)
│   └── sessions.example.json   # Mẫu cấu hình cookie
├── data/
│   └── feed_state.db           # SQLite database lưu ID bài viết đã gửi & cache user
├── src/
│   ├── bot/
│   │   ├── client.ts           # Discord.js client (Gateway intents tối thiểu)
│   │   ├── register.ts         # Script đăng ký Slash Commands
│   │   └── commands/
│   │       └── feed.ts         # Slash commands (/feed add, remove, list, status)
│   ├── core/
│   │   ├── config.ts           # Quản lý đọc/ghi config & hot-reload
│   │   ├── database.ts         # SQLite wrapper (node:sqlite)
│   │   ├── dispatcher.ts       # Format Embeds & gửi qua Discord Webhook
│   │   └── scheduler.ts        # Hàng đợi tuần tự + Random Jitter (4-7 phút)
│   ├── providers/
│   │   ├── base.provider.ts    # Interface chuẩn FeedItem & FeedProvider
│   │   └── x.provider.ts       # X (Twitter) GraphQL API scraper
│   ├── utils/
│   │   ├── http.ts             # Fetch wrapper + auto retry & backoff
│   │   ├── logger.ts           # Logger có màu sắc và timestamp ISO
│   │   └── notifier.ts         # Báo động lỗi auth / sự cố về Discord Admin
│   └── index.ts                # Entry point khởi động hệ thống
├── test/
│   └── verify.ts               # Test suite kiểm tra Core Engine
├── ecosystem.config.cjs        # Cấu hình PM2 giới hạn 500MB RAM & auto restart
├── package.json
└── tsconfig.json
```

---

## ⚡ Hướng dẫn cài đặt & Cấu hình

### 1. Cài đặt Dependencies
```bash
npm install
```

### 2. Thiết lập cấu hình

Tạo 2 file cấu hình từ mẫu:
```bash
cp config/targets.example.json config/targets.json
cp config/sessions.example.json config/sessions.json
```

#### a. `config/targets.json`:
- `botToken`: Token Discord Bot (lấy tại [Discord Developer Portal](https://discord.com/developers/applications)).
- `targets`: Danh sách các tài khoản ban đầu và Discord Webhook URL tương ứng.
- `admin.webhookUrl`: Webhook nhận cảnh báo lỗi (khi cookie hết hạn hoặc provider lỗi).
- `admin.adminRoleId`: (Tùy chọn) ID Role Discord được phép dùng Slash Commands.

#### b. `config/sessions.json`:
- `x.auth_token` và `x.ct0`: Đăng nhập tài khoản phụ trên trình duyệt web, mở DevTools (`F12`) -> Application -> Cookies -> `https://x.com` để copy 2 giá trị này.

### 3. Đăng ký Slash Commands lên Discord
Chạy script để đăng ký bộ lệnh `/feed`:
```bash
npm run register
```
*(Nếu muốn đăng ký ngay lập tức vào một Server Discord cụ thể để test, chạy: `DISCORD_GUILD_ID=your_server_id npm run register`)*

### 4. Chạy Bot

#### Chế độ Development (Auto-reload):
```bash
npm run dev
```

#### Chế độ Test kiểm tra hệ thống:
```bash
npm test
```

#### Chạy Production với PM2:
```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

---

## 🎮 Quản lý qua Discord Slash Commands

Bot cung cấp nhóm lệnh `/feed` (chỉ dành cho Administrator):

| Lệnh | Mô tả |
| :--- | :--- |
| `/feed add <platform> <handle> [webhook_url] [media_only]` | Thêm tài khoản mới vào danh sách theo dõi (mặc định: `media_only=True`) |
| `/feed set-filter <platform> <handle> <media_only>` | Bật/tắt bộ lọc chỉ lấy bài có Ảnh/Video cho tài khoản (`True`/`False`) |
| `/feed remove <platform> <handle>` | Xóa tài khoản khỏi danh sách |
| `/feed list` | Xem danh sách các tài khoản đang theo dõi kèm nhãn `[🖼️ Media Only]` hoặc `[📄 All Posts]` |
| `/feed status` | Xem trạng thái bot, uptime, RAM (RSS/Heap), lần quét gần nhất |

---

## 📱 Hướng Dẫn Triển Khai Trên Android (Termux + Debian)

Xem hướng dẫn chi tiết từng bước (cách khóa Wakelock, tắt Phantom Process Killer trên Android 12+, cài Node 22 trong `proot-distro` và chạy PM2 auto-start) tại:
👉 **[Hướng Dẫn Deploy Chi Tiết Trên Debian/Termux](docs/deploy-termux-debian.md)**

Kế hoạch kiến trúc ban đầu: [docs/init-plan.md](docs/init-plan.md).
