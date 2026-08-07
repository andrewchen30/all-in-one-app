# 架構決策記錄

記錄「為什麼是這樣」，而不是「是什麼」。後者讀程式碼就好。

---

## 1. 攝影機端必須是原生 iOS App

不是偏好，是 iOS 的硬限制：

- Safari 的 `getUserMedia` 在 App 切到背景或螢幕鎖定時**立刻停止**串流
- iOS Safari 對 `applyConstraints({ zoom, focusMode })` 的支援極差，需求裡的
  zoom 與對焦控制在網頁端做不到
- 網頁無法停用 idle timer，螢幕會自己睡

觀看端則沒有這個問題 —— 瀏覽器的 WebRTC **接收**端很完整，所以 web viewer 是
一等公民，「用另一支手機看」和「用網頁看」是同一份實作。

**iOS 沒有 camera 的背景執行權限**（audio / location 才有）。攝影機端的形態只能是
「插著電、App 開在前景、鎖在引導使用模式」。這不是妥協，是唯一可行解，所有保活設計
都建立在這個前提上。

---

## 2. 串流用 WebRTC P2P，不用 SFU

| 方案 | 延遲 | 外網 | 成本 | 判斷 |
|---|---|---|---|---|
| **WebRTC P2P** | 0.2–0.5s | 需 STUN/TURN | 近乎 0 | ✅ 採用 |
| MJPEG over HTTP | 0.3–1s | 只能同網段 | 0 | 頻寬與畫質不可接受 |
| HLS / LL-HLS | 3–15s | 好 | 中 | 延遲對監看無意義 |
| 託管 SFU (LiveKit 等) | 0.3s | 內建 | 計價 | 1 對 1~2 不需要 SFU；且影像會經第三方 |

拓撲是一台攝影機對一到兩個觀看者，SFU 解決的是「多方轉發」，這裡沒有那個問題。
兩台都在家裡 Wi-Fi 時走 host candidate 直連，零成本、最低延遲。

編碼指定 **H.264**：iPhone 硬體編碼、Safari 硬體解碼，省電且低延遲。

---

## 3. 控制指令走 DataChannel，不另開 socket

切鏡頭、zoom、對焦這些指令跟影像走**同一條 WebRTC 連線**：

- 延遲最低（不繞伺服器）
- 跟媒體同生共死 —— 不會出現「影像斷了但控制還在」的矛盾狀態
- 少一套連線管理程式碼

指令格式定義在 `packages/protocol/src/petcam.ts`，Swift 鏡像在
`packages/protocol/swift/PetCamProtocol.swift`。**兩份必須同一個 commit 一起改。**

### 攝影機永遠是 offerer

不做 perfect negotiation。攝影機同時擁有媒體與控制 channel，讓它當唯一的 offerer 就
從根本上避開 glare，一對少的拓撲不值得那套機制的複雜度。

### zoom 的兩個細節

iPhone 13 是**廣角 + 超廣角**雙鏡頭（沒有望遠）。用 `.builtInDualWideCamera`
virtual device，系統會在某個倍率自動無縫切換實體鏡頭，程式只需設一個
`videoZoomFactor`。

- `minAvailableVideoZoomFactor` / `maxAvailableVideoZoomFactor` /
  `virtualDeviceSwitchOverVideoZoomFactors` **一律 runtime 查詢**，不寫死。
  protocol 裡的 `zoomRange`、`switchOverFactors`、`zoomUiBaseline` 就是為此而設。
- **樂觀 zoom**：viewer 拖動時先用 CSS `transform: scale()` 立即回饋，等攝影機回報
  新倍率再還原。裝置往返約 200–400ms，沒有這個處理會有明顯的「拖不動」感。
  已實作於 `apps/web/app/petcam/page.tsx` 的 `zoomPreview`。

### 對焦的兩個陷阱

- 座標轉換要處理 `videoOrientation`、前鏡頭鏡像、以及 preview 的 aspect-fill 裁切。
  viewer 端額外要扣掉 `object-contain` 的黑邊 —— 用元素自身的 rect 換算會對焦到錯的
  位置。已處理於 `handleTapFocus`。
- **iPhone 13 的前鏡頭是固定焦距**（前鏡頭自動對焦是 iPhone 14 之後才有）。
  一律檢查 `isFocusPointOfInterestSupported`，並透過 `focusSupported` 讓 viewer
  停用對焦 UI，而不是接受指令然後靜默失敗。

---

## 4. Signaling 用 SSE + POST，不用 WebSocket

Serverless function 是水平擴展的：同一台裝置的兩條連線可能落在不同 instance，
程序內狀態沒辦法把訊息從觀看端的 instance 送到攝影機端的 instance。WebSocket 一樣
需要共享 broker，卻換不到任何好處。

SSE + POST 的實際優勢：

- 瀏覽器對 SSE 有原生重連
- `curl` 就能除錯，整條 signaling 的行為看得見
- signaling 的訊息量本來就只有每次連線幾則；真正需要長命的是攝影機的**在線狀態**，
  而那是一個心跳問題，不是連線問題

**不使用 `EventSource`**，因為它無法帶 `Authorization` header —— 唯一替代是把 token
塞進 query string，那會進 access log 和瀏覽器歷史。改用 `fetch` + `ReadableStream`
自己解析，重連邏輯也因此掌握在自己手上（伺服器在 `maxDuration` 會正常關閉串流，
這種「乾淨結束」必須立刻重連而不是退避）。

### Broker

`lib/broker/` 是介面 + 實作。目前只有 `MemoryBroker`，**僅適用於單一長命程序**
（`next dev`）。部署前必須實作 `RedisBroker`：

```bash
vercel integration add upstash/upstash-kv --yes
```

`BROKER=redis` 目前會直接拋錯而不是降級 —— 一個會靜默丟訊息的 broker 比一個大聲
失敗的設定錯誤危險得多。

---

## 5. 外網優先，所以 TURN 不是選配

**已知使用情境是「常在外面用 4G/5G 看家裡」**，這改變了幾件事：

- ICE 從一開始就設計成 host / srflx / relay 三層。約 10–20% 的 NAT 組合打不通洞，
  行動網路的 CGNAT 是常見元凶。
- Viewer 狀態列**顯示實際採用的 candidate pair 與是否走 TURN 中繼**
  （`selectedCandidatePair()`）。沒有這個，你分不清「TURN 正常運作」和「TURN 根本
  沒被用到」—— 這是 WebRTC 除錯最容易誤判的地方。
- **發送端主動壓 bitrate 上限**（`applyBitrateCap`），不讓頻寬估計往上探測。
  攝影機在家用上行、觀看端在行動網路，無上限探測產生的鋸齒比穩定的較低碼率更像「卡」。
- 4G 換基地台會斷線，重連邏輯提前到 M2，不等 M4。

TURN 服務尚未設定。透過 `STUN_URL` / `TURN_URL` / `TURN_USERNAME` /
`TURN_CREDENTIAL` 環境變數注入，憑證由伺服器在 SSE `ready` 事件發給 client，
不落在前端程式碼裡。

---

## 6. 免費 provisioning 的取捨

使用者選擇先用免費 Apple ID 驗證可行性，好用再買開發者帳號。核心功能不受影響：

| 能力 | 免費帳號 | 影響 |
|---|---|---|
| Camera / Microphone 權限 | ✅ | 無 |
| Local Network 權限 | ✅ | 無 |
| WebRTC | ✅ | 無 |
| **簽章有效期** | ⚠️ **7 天** | App 每週失效一次 |
| Push Notifications | ❌ | 改用 viewer 端 last-seen 心跳 |
| Sign in with Apple | ❌ | 無 —— 本來就用 pairing code |
| iCloud / App Groups | ❌ | 無 —— DataHub 資料放後端 |
| Associated Domains | ❌ | 配對改手動輸入，不做 universal link |

緩解措施（都已在 M0a 落地或預留）：

1. `make ios-install` 一行重簽，配合 Xcode 的 Connect via network 免拔線
2. `ProvisioningInfo` 讀 `embedded.mobileprovision` 的 `ExpirationDate`，
   App 內與 viewer 狀態列都顯示剩餘天數，剩 3 天內變色
3. Viewer 顯示 last-seen，取代不能用的推播

升級成付費帳號時，要改的只有 entitlements，架構不動。

---

## 7. 安全

分兩階段，刻意不一步到位：

- **現在（M0a）**：單一 shared token（`SIGNAL_TOKEN`），常數時間比對。它的作用是讓
  部署出去的實例不是一個「猜到 deviceId 就能加入」的開放中繼。未設定時完全開放，
  僅適用於 localhost。
- **M2**：每裝置 pairing code + 每觀看者 token，這樣撤銷一個觀看端不必換掉攝影機。
- **M6（接數據時）**：升級為正式帳號體系，因為那時會碰到私人與公司資料。

WebRTC 的媒體本身強制 DTLS-SRTP 加密，這層不需額外處理。

---

## 8. DataHub（功能二）的唯一硬規則

需求是 Metabase 報表 + 外部 API 數字 + 工作／專案數據。三者指向同一個結論：

> **所有資料抓取一律在後端排程進行，iOS 與 Web 只讀自家 API。**

理由：API token 不落在手機上、換裝置不必重新授權、可以留下時序資料畫趨勢圖。

**開工前必須先確認的問題**：公司 Metabase 十之八九在 VPN 內，雲端排程打不到。
可能解法是 Metabase 的 public link，或在本機跑一支定時把結果推上來的 agent。
這個問題不解決，M6 沒辦法開始。

---

## 9. 為什麼有一個「瀏覽器測試攝影機」

`apps/web/app/petcam/dev-camera` 用電腦的鏡頭實作了與 iOS 端**完全相同**的
signaling 與控制協定。

這讓整條鏈路（signaling → ICE → 影像 → DataChannel 指令 → 狀態推送）在 Xcode 安裝
之前就能端到端驗證，M1 於是從「把所有東西一次點亮然後盲目除錯」變成「抽換掉節點的
實作」。

在瀏覽器做不到 AVFoundation 能做的事情時（真正的光學 zoom、對焦點、thermal state），
它**誠實回報能力旗標**而不是假裝成功 —— 順便讓 viewer 的 disabled 狀態處理也被測到。

---

## 決策待辦

- [ ] TURN 服務選型與設定（M2 前）
- [ ] `RedisBroker` 實作（首次部署前）
- [ ] 公司 Metabase 的連通方式（M6 前）
- [ ] 是否升級付費 Apple Developer 帳號（依實際使用體驗決定）
