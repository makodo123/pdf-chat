# PDF Chat

> 上傳 PDF，直接用 Gemini AI 問問題 — 支援多檔上傳、連續追問與對話紀錄。

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://makodo123.github.io/pdf-chat/)

---

## 為什麼做這個

閱讀合約、論文、說明書時，要找到特定資訊需要反覆翻頁。這個工具讓你直接用自然語言問 PDF 裡的問題，Gemini 根據文件內容回答，省去手動搜尋的時間。

---

## 功能

- **多檔上傳** — 支援同時上傳多份 PDF（上限 15 MB／份），拖放或點擊選擇
- **連續追問** — 對話歷史帶入每次請求，可針對同一文件深入追問
- **角色設定** — 可自訂系統提示，例如「請用條列式回答」
- **本機儲存 API Key** — Key 存在 localStorage，不傳送到任何後端
- **純前端** — 不需後端伺服器，PDF 不會上傳到任何雲端儲存

---

## 技術架構

| 分類 | 技術 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 建置工具 | Vite |
| 樣式 | Tailwind CSS |
| AI 模型 | Gemini 2.5 Flash Preview（gemini-2.5-flash-preview） |
| PDF 傳送 | FileReader → base64 → Gemini inlineData |
| 部署 | GitHub Pages |

---

## 本機執行

```bash
git clone https://github.com/makodo123/pdf-chat.git
cd pdf-chat
npm install
npm run dev
```

開啟 http://localhost:5173/pdf-chat/，輸入 Gemini API Key 即可使用。

---

## License

MIT
