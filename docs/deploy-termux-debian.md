# 📱 Hướng Dẫn Chi Tiết Deploy Trên Android (Termux + Debian proot-distro)

Tài liệu này hướng dẫn từng bước thiết lập môi trường để **Discord Feed Bot** vận hành ổn định **24/7** trên điện thoại Android cũ mà **không bị hệ điều hành tắt ngầm (kill process)**.

---

## 📑 Mục Lục
1. [Yêu cầu chuẩn bị](#1-yêu-cầu-chuẩn-bị)
2. [Khóa cứng hệ thống Android (Chống kill app)](#2-khóa-cứng-hệ-thống-android-chống-kill-app)
3. [Cài đặt Termux & Debian proot-distro](#3-cài-đặt-termux--debian-proot-distro)
4. [Cài đặt Node.js 22+ & PM2 trong Debian](#4-cài-đặt-nodejs-22--pm2-trong-debian)
5. [Tải source code & Cấu hình Bot](#5-tải-source-code--cấu-hình-bot)
6. [Quản lý vận hành 24/7 với PM2](#6-quản-lý-vận-hành-247-với-pm2)
7. [Tự động chạy lại khi khởi động máy (Auto-start)](#7-tự-động-chạy-lại-khi-khởi-động-máy-auto-start)
8. [Troubleshooting & Xử lý sự cố](#8-troubleshooting--xử-lý-sự-cố)

---

## 1. Yêu cầu chuẩn bị

- Điện thoại Android (khuyến nghị Android 8.0 trở lên, kiến trúc ARM64).
- Kết nối WiFi ổn định, cắm sạc liên tục nếu dùng làm server 24/7.
- **Quan trọng:** Cài đặt **Termux từ F-Droid** (hoặc GitHub Releases của Termux), **tuyệt đối không dùng bản trên Google Play Store** (đã ngưng cập nhật và bị lỗi repository).
  - Tải Termux tại: [F-Droid Termux](https://f-droid.org/packages/com.termux/)

---

## 2. Khóa cứng hệ thống Android (Chống kill app)

Android có các cơ chế tiết kiệm pin rất mạnh tay (Doze mode, Phantom Process Killer) sẽ tắt Termux sau một khoảng thời gian chạy ngầm. Cần xử lý triệt để 3 bước sau:

### Bước 2.1: Bật Termux Wakelock
Kéo thanh thông báo trạng thái của Android xuống, tại mục thông báo của Termux, nhấn vào **`Acquire Wakelock`** (hoặc gõ lệnh `termux-wake-lock` trong cửa sổ Termux).

### Bước 2.2: Tắt tối ưu hóa pin cho Termux
1. Vào **Cài đặt Android (Settings)** > **Ứng dụng (Apps)** > **Termux**.
2. Tìm mục **Pin (Battery)** > Chọn **Không hạn chế (Unrestricted)**.
3. Tắt tùy chọn: **"Tự động gỡ quyền của ứng dụng nếu không dùng" (Remove permissions if app is unused)**.
4. *(Tùy dòng máy như Xiaomi/MIUI, Huawei, Samsung)*:
   - **Xiaomi**: Tắt MIUI Optimization, bật *Tự khởi chạy (Autostart)* và khóa ứng dụng trong màn hình Đa nhiệm.
   - **Samsung**: Vào *Chăm sóc thiết bị (Device Care)* > *Pin* > Thêm Termux vào danh sách *Ứng dụng không bao giờ ở chế độ ngủ (Never sleeping apps)*.

### Bước 2.3: Tắt Phantom Process Killer (Dành cho Android 12+)
Từ Android 12 trở lên, hệ thống sẽ tự động kill bất kỳ tiến trình con nào (như `proot`) nếu tổng số tiến trình con vượt quá 32. Bạn cần tắt cơ chế này qua ADB (chỉ cần chạy **1 lần duy nhất**):

- **Cách 1: Dùng máy tính cắm cáp USB (Bật USB Debugging):**
  ```bash
  adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent"
  adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"
  ```

- **Cách 2: Dùng app LADB trực tiếp trên điện thoại (qua Wireless Debugging):**
  Nhập 2 lệnh trên vào cửa sổ lệnh của LADB mà không cần máy tính.

---

## 3. Cài đặt Termux & Debian proot-distro

Mở ứng dụng Termux và thực hiện theo thứ tự:

### Bước 3.1: Cập nhật package gốc của Termux
```bash
pkg update -y && pkg upgrade -y
pkg install -y git curl proot-distro
```

### Bước 3.2: Cài đặt bản phân phối Debian
```bash
proot-distro install debian
```
*(Quá trình tải và giải nén mất khoảng 1–2 phút tùy tốc độ mạng)*

### Bước 3.3: Đăng nhập vào Debian container
```bash
proot-distro login debian
```
> [!NOTE]
> Khi dấu nhắc lệnh chuyển thành `root@localhost:~#`, bạn đã ở bên trong hệ điều hành Debian hoàn chỉnh.

---

## 4. Cài đặt Node.js 22+ & PM2 trong Debian

Trong môi trường Debian (`root@localhost:~#`), chạy các lệnh:

### Bước 4.1: Cập nhật kho gói của Debian
```bash
apt update && apt upgrade -y
apt install -y curl ca-certificates git nano
```

### Bước 4.2: Cài đặt Node.js 22.x LTS từ NodeSource
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

Kiểm tra phiên bản sau khi cài:
```bash
node -v   # Phải hiển thị phiên bản >= v22.0.0 (hỗ trợ node:sqlite tích hợp sẵn)
npm -v
```

### Bước 4.3: Cài đặt PM2 toàn cục
PM2 là trình quản lý tiến trình, tự động restart bot nếu gặp crash hoặc rò rỉ bộ nhớ:
```bash
npm install -g pm2
```

---

## 5. Tải source code & Cấu hình Bot

### Bước 5.1: Đưa code lên thiết bị

- **Cách A (Khuyến nghị): Clone trực tiếp từ Git repo của bạn:**
  ```bash
  cd ~
  git clone <URL_REPO_CUA_BAN> discord-feed-bot
  cd discord-feed-bot
  ```

- **Cách B: Copy từ thư mục bộ nhớ ngoài của Android vào Debian:**
  Nếu bạn đã chép source code vào bộ nhớ máy (ví dụ thư mục `Download/discord-feed-bot`):
  1. Trong Termux (ngoài Debian), cấp quyền bộ nhớ: `termux-setup-storage`.
  2. Đăng nhập Debian với bind mount:
     ```bash
     proot-distro login debian --bind /sdcard:/sdcard
     cp -r /sdcard/Download/discord-feed-bot ~/discord-feed-bot
     cd ~/discord-feed-bot
     ```

### Bước 5.2: Cài đặt thư viện & Build TypeScript
```bash
npm install
npm run build
```

### Bước 5.3: Chạy test kiểm tra hệ thống
Chạy test suite nội bộ để đảm bảo SQLite và logic hoạt động chuẩn trên CPU ARM:
```bash
npm test
```
*Kết quả xuất hiện `🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!` là môi trường hoàn toàn tương thích.*

### Bước 5.4: Tạo và chỉnh sửa file cấu hình

1. **Cấu hình targets & bot token:**
   ```bash
   cp config/targets.example.json config/targets.json
   nano config/targets.json
   ```
   - Điền `botToken` của Discord Bot.
   - Điền `targets`: danh sách các handle X và Webhook URL Discord tương ứng.
   - Điền `admin.webhookUrl`: Webhook nhận thông báo khi cookie hết hạn hoặc có lỗi.
   - *(Nhấn `Ctrl + O` rồi `Enter` để lưu, `Ctrl + X` để thoát `nano`)*.

2. **Cấu hình Cookie X (Twitter):**
   ```bash
   cp config/sessions.example.json config/sessions.json
   nano config/sessions.json
   ```
   - Lấy cookie từ trình duyệt máy tính (F12 -> Application -> Cookies -> `https://x.com`):
     - `auth_token`: Chuỗi token đăng nhập.
     - `ct0`: Mã CSRF token.
   - Dán vào file và lưu lại.

### Bước 5.5: Đăng ký Slash Commands với Discord
```bash
npm run register
```
> [!TIP]
> Nếu muốn lệnh `/feed` xuất hiện ngay lập tức trong Server Discord để test (thay vì chờ lệnh Global đồng bộ), thêm ID server:
> ```bash
> DISCORD_GUILD_ID="ID_SERVER_DISCORD_CUA_BAN" npm run register
> ```

---

## 6. Quản lý vận hành 24/7 với PM2

### Bước 6.1: Khởi động bot bằng PM2
Chạy lệnh sử dụng cấu hình giới hạn RAM 500MB đã có sẵn:
```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### Bước 6.2: Các lệnh quản lý bot thông dụng

| Thao tác | Lệnh |
| :--- | :--- |
| **Xem trạng thái & RAM tiêu thụ** | `pm2 list` hoặc `pm2 status` |
| **Xem log realtime (bài mới, lỗi)** | `pm2 logs discord-feed-bot` |
| **Xem 50 dòng log gần nhất** | `pm2 logs discord-feed-bot --lines 50` |
| **Khởi động lại bot** | `pm2 restart discord-feed-bot` |
| **Tạm dừng bot** | `pm2 stop discord-feed-bot` |
| **Xóa bot khỏi danh sách PM2** | `pm2 delete discord-feed-bot` |

> [!TIP]
> **Hot-Reload Cookie không cần restart:**
> Khi cookie tài khoản X hết hạn, bạn chỉ cần sửa lại `config/sessions.json`. Bot sử dụng `fs.watchFile` sẽ tự động nạp session mới trong vòng 5 giây mà không làm gián đoạn tiến trình!

---

## 7. Tự động chạy lại khi khởi động máy (Auto-start)

Để đảm bảo bot tự động bật mỗi khi điện thoại khởi động lại hoặc khi mở app Termux:

### Cách đơn giản: Cấu hình `~/.bashrc` của Termux
Thoát ra khỏi Debian (`exit`) về lại shell chính của Termux:
```bash
nano ~/.bashrc
```
Thêm các dòng sau vào cuối file:
```bash
# Giữ CPU thức
termux-wake-lock

# Tự động đăng nhập Debian và khôi phục PM2
proot-distro login debian -- pm2 resurrect
```

Lưu lại. Kể từ giờ, mỗi khi bạn mở ứng dụng Termux, bot sẽ tự động được phục hồi và chạy ngầm.

### Cách nâng cao (Không cần mở app): Dùng `Termux:Boot`
1. Cài đặt thêm ứng dụng **Termux:Boot** từ F-Droid.
2. Mở ứng dụng Termux:Boot một lần để cấp quyền khởi động cùng hệ thống.
3. Trong Termux:
   ```bash
   mkdir -p ~/.termux/boot/
   nano ~/.termux/boot/start-bot.sh
   ```
4. Dán nội dung:
   ```bash
   #!/data/data/com.termux/files/usr/bin/sh
   termux-wake-lock
   proot-distro login debian -- pm2 resurrect
   ```
5. Cấp quyền thực thi:
   ```bash
   chmod +x ~/.termux/boot/start-bot.sh
   ```

---

## 8. Troubleshooting & Xử lý sự cố

### 1. Bot bị văng với mã lỗi `Signal 9` (Killed)
- **Nguyên nhân:** Android Phantom Process Killer đã đóng tiến trình `proot`.
- **Cách khắc phục:** Kiểm tra lại [Bước 2.3](#bước-23-tắt-phantom-process-killer-dành-cho-android-12) và chạy lại 2 lệnh ADB để vô hiệu hóa cơ chế này.

### 2. Nhận được thông báo "🔒 Auth Expired — X" trên kênh Discord Admin
- **Nguyên nhân:** Cookie `auth_token` hoặc `ct0` của tài khoản phụ bị hết hạn hoặc X yêu cầu xác thực lại.
- **Cách khắc phục:** Mở trình duyệt web, đăng nhập lại tài khoản phụ, lấy cặp cookie mới và dán vào `config/sessions.json`. Bot sẽ tự động nhận mà không cần restart.

### 3. Lệnh Slash Command `/feed` không phản hồi
- Kiểm tra bot có đang chạy không: `pm2 status`.
- Kiểm tra `botToken` trong `config/targets.json` đã chính xác chưa.
- Kiểm tra bot đã được mời vào Server với quyền `Send Messages`, `Embed Links`, `Use Application Commands` chưa.
- Kiểm tra người gõ lệnh có quyền `Administrator` trên server hay không (bot chặn người dùng thông thường để bảo mật).

### 4. RAM tăng dần sau nhiều ngày chạy liên tục
- File `ecosystem.config.cjs` đã cấu hình `max_memory_restart: '500M'`. Nếu mức sử dụng RAM vượt quá 500MB, PM2 sẽ tự động tái khởi động bot trong 3 giây.
- Database SQLite cũng tự động chạy hàm `cleanupOldRecords()` mỗi 24 giờ để xóa các ID bài viết cũ hơn 30 ngày, giữ dung lượng DB luôn dưới vài MB.
