# PDF 問答

上傳 PDF，用中文對話提問，支援連續追問。API Key 存在瀏覽器的 localStorage，不經過任何後端。

**Live demo:** https://makodo123.github.io/pdf-chat/

## 功能

- 上傳多份 PDF，點選切換
- Streaming 逐字顯示 AI 回答
- Markdown 渲染（粗體、清單、表格）
- 對話歷史帶入每次請求，支援追問
- 對話記錄持久化（重新整理不消失）
- 一鍵快捷提示（摘要、重點、數據…）
- 匯出問答紀錄為 `.md` 檔
- PDF 大小限制提示（上限 15 MB）

## 技術

- React 18 + TypeScript + Vite
- `@google/generative-ai` — `gemini-3-flash-preview`，PDF 以 `inlineData` base64 傳送
- Tailwind CSS + `@tailwindcss/typography`
- `react-markdown` + `remark-gfm`
- 部署至 GitHub Pages（`gh-pages`）

## 本地開發

```bash
npm install
npm run dev
```

## 部署

```bash
npm run deploy
```
