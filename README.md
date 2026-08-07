# All-in-One

個人化工具庫。第一個工具是把舊 iPhone 變成寵物攝影機，第二個是數據儀表板（規劃中）。

架構決策與其理由記錄在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 現況

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| M0a | Monorepo、protocol、signaling、web viewer、瀏覽器測試攝影機 | ✅ 完成 |
| M0b | iOS 空殼（可產生 Xcode project） | ✅ 骨架完成，待安裝 Xcode 驗證編譯 |
| M1 | iOS 攝影機端：AVFoundation 擷取 + WebRTC | ⬜ |
| M2 | Pairing、TURN、外網連線 | ⬜ |
| M3 | 鏡頭切換 / zoom / 對焦 / 手電筒 / 畫質 | ⬜ |
| M4 | 保活：重連、過熱降級、黑屏省電、憑證倒數 | ⬜ |
| M5 | iOS 觀看端 | ⬜ |
| M6 | DataHub 骨架 | ⬜ |

## 快速開始

```bash
pnpm install
make dev
```

開啟 <http://localhost:3000>。

### 在 iOS App 完成前先驗證串流

M0a 附了一個瀏覽器版的攝影機端，用電腦的鏡頭模擬 iPhone，讓整條鏈路（signaling →
ICE → 影像 → DataChannel 指令）在 Xcode 裝好之前就能測：

1. 分頁 A 開 <http://localhost:3000/petcam/dev-camera>，裝置 ID 填 `home-cam`，按「開始廣播」
2. 分頁 B 開 <http://localhost:3000/petcam>，輸入相同的 `home-cam`
3. 分頁 B 應該看到影像，並且鏡頭切換 / zoom / 畫質按鈕會實際作用

要用另一支手機測，把 `localhost` 換成你 Mac 的區網 IP，兩台接同一個 Wi-Fi。
（瀏覽器只在 `localhost` 或 HTTPS 下才給鏡頭權限，所以攝影機端請留在電腦上。）

### 測試 signaling

```bash
make test-signaling
```

## iOS

需要 Xcode（目前這台機器只有 Command Line Tools）：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

然後：

```bash
make ios-gen        # 由 project.yml 產生 AllInOne.xcodeproj
make ios-devices    # 找出 iPhone 的 UDID
echo "DEVICE_ID = <你的 UDID>" > .make.env
make ios-install    # 建置並安裝
```

`.xcodeproj` 不進版控 —— 它是由 `apps/ios/project.yml` 產生的，所有建置設定都在那份
YAML 裡，diff 看得懂、也不會偷偷漂移。

### 免費 provisioning 的每週儀式

免費 Apple ID 簽出來的憑證 **7 天到期**，過期後 App 直接無法啟動。緩解措施：

- 在 Xcode 的 Devices and Simulators 幫這支 iPhone 勾選 **Connect via network**，
  之後 `make ios-install` 就能無線重簽，手機不用拔下來
- App 內與 web viewer 的狀態列都會顯示 **憑證剩餘天數**，剩 3 天內會變色
- Viewer 會顯示攝影機的 last-seen 心跳（免費帳號不能用推播，這是替代方案）

## 專案結構

```
apps/
  web/                Next.js — web viewer、signaling、瀏覽器測試攝影機
  ios/                SwiftUI App（XcodeGen spec + 原始碼）
packages/
  protocol/
    src/              TypeScript — 控制指令與 signaling 的唯一真相來源
    swift/            Swift 鏡像，兩邊必須同步修改
scripts/
  test-signaling.mjs
docs/
  ARCHITECTURE.md
```
