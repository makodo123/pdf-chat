import { useState, useRef, useEffect } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const MAX_PDF_BYTES = 15 * 1024 * 1024

const PRESET_PROMPTS = [
  '請幫我摘要這份文件的重點',
  '列出文件中所有重要數字或數據',
  '這份文件的主要結論是什麼？',
  '條列式整理文件架構',
]

interface Message {
  role: 'user' | 'model'
  text: string
}

interface PdfData {
  id: string
  base64: string
  mimeType: 'application/pdf'
  name: string
  size: number
  objectUrl: string
}

interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadConv(id: string): Message[] {
  try {
    const s = localStorage.getItem(`conv-${id}`)
    return s ? (JSON.parse(s) as Message[]) : []
  } catch { return [] }
}

function persistConv(id: string, msgs: Message[]) {
  try { localStorage.setItem(`conv-${id}`, JSON.stringify(msgs)) } catch { /* full */ }
}

function exportMd(pdfName: string, msgs: Message[]) {
  const lines = [`# ${pdfName} — 問答紀錄\n`]
  for (const m of msgs)
    lines.push(m.role === 'user' ? `**我：** ${m.text}\n` : `**AI：**\n\n${m.text}\n`)
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }))
  Object.assign(document.createElement('a'), {
    href: url,
    download: `${pdfName.replace(/\.pdf$/i, '')}-問答.md`,
  }).click()
  URL.revokeObjectURL(url)
}

function fmtSize(n: number) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      title="複製"
      className="opacity-0 group-hover:opacity-100 absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-gray-600 shadow text-gray-400 hover:text-blue-500 dark:text-gray-300 dark:hover:text-blue-400 text-xs transition-opacity"
    >
      {copied ? '✓' : '⎘'}
    </button>
  )
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini-api-key') ?? '')
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('gemini-api-key') ?? '')
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem('system-prompt') ?? '')
  const [showSysPrompt, setShowSysPrompt] = useState(false)
  const [pdfs, setPdfs] = useState<PdfData[]>([])
  const [activePdfId, setActivePdfId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Record<string, Message[]>>({})
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const activePdf = pdfs.find(p => p.id === activePdfId) ?? null
  const messages: Message[] = activePdfId ? (conversations[activePdfId] ?? []) : []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversations, activePdfId, loading])

  function setMsgs(id: string, msgs: Message[]) {
    setConversations(prev => ({ ...prev, [id]: msgs }))
    persistConv(id, msgs)
  }

  function saveApiKey() {
    const key = apiKeyInput.trim()
    if (!key) return
    localStorage.setItem('gemini-api-key', key)
    setApiKey(key)
    setError('')
  }

  function saveSystemPrompt(val: string) {
    setSystemPrompt(val)
    localStorage.setItem('system-prompt', val)
  }

  async function processFiles(files: File[]) {
    setError('')
    const added: PdfData[] = []
    for (const file of files) {
      if (file.size > MAX_PDF_BYTES) {
        setError(`「${file.name}」超過 15 MB，Gemini 無法處理`)
        continue
      }
      const base64 = await readFileAsBase64(file).catch(() => null)
      if (!base64) { setError(`無法讀取「${file.name}」`); continue }
      const id = `${file.name}-${file.size}`
      added.push({
        id, base64, mimeType: 'application/pdf',
        name: file.name, size: file.size,
        objectUrl: URL.createObjectURL(file),
      })
      const saved = loadConv(id)
      if (saved.length) setConversations(prev => ({ ...prev, [id]: saved }))
    }
    if (added.length) {
      setPdfs(prev => {
        const existing = new Set(prev.map(p => p.id))
        return [...prev, ...added.filter(p => !existing.has(p.id))]
      })
      setActivePdfId(added[0].id)
      setLastTokenUsage(null)
    }
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) processFiles(files)
    e.target.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf')
    if (files.length) processFiles(files)
  }

  async function sendRequest(userText: string, baseMessages: Message[]) {
    if (!activePdf || !apiKey || loading) return
    const pdfId = activePdf.id

    const newMsgs: Message[] = [...baseMessages, { role: 'user', text: userText }]
    setConversations(prev => ({ ...prev, [pdfId]: [...newMsgs, { role: 'model', text: '' }] }))
    setLoading(true)
    setLastTokenUsage(null)

    try {
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        systemInstruction: systemPrompt.trim() || undefined,
      })

      const history = baseMessages.map(m => ({ role: m.role, parts: [{ text: m.text }] }))
      const chat = model.startChat({ history })
      const result = await chat.sendMessageStream([
        { inlineData: { data: activePdf.base64, mimeType: activePdf.mimeType } },
        { text: userText },
      ])

      let full = ''
      for await (const chunk of result.stream) {
        full += chunk.text()
        setConversations(prev => {
          const cur = [...(prev[pdfId] ?? [])]
          cur[cur.length - 1] = { role: 'model', text: full }
          return { ...prev, [pdfId]: cur }
        })
      }

      const usage = (await result.response).usageMetadata
      if (usage) {
        setLastTokenUsage({
          prompt: usage.promptTokenCount ?? 0,
          completion: usage.candidatesTokenCount ?? 0,
          total: usage.totalTokenCount ?? 0,
        })
      }

      persistConv(pdfId, [...newMsgs, { role: 'model', text: full }])
    } catch (err) {
      setError(err instanceof Error ? err.message : '發生錯誤，請確認 API Key 是否正確')
      setConversations(prev => ({ ...prev, [pdfId]: newMsgs }))
    } finally {
      setLoading(false)
    }
  }

  function send(text?: string) {
    const userText = (text ?? input).trim()
    if (!userText || !activePdf || !apiKey || loading) return
    if (!text) setInput('')
    setError('')
    sendRequest(userText, messages)
  }

  function regenerate() {
    if (!activePdf || messages.length < 2 || loading) return
    const lastUser = messages[messages.length - 2]
    if (lastUser.role !== 'user') return
    setError('')
    sendRequest(lastUser.text, messages.slice(0, -2))
  }

  const isLastModelMsg = (i: number) =>
    i === messages.length - 1 && messages[i].role === 'model' && !loading && messages[i].text !== ''

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center py-8 px-4 transition-colors">
      <div className={`w-full flex flex-col gap-4 transition-all duration-300 ${showPreview && activePdf ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 text-center">PDF 問答</h1>

        {/* API Key + System Prompt */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Gemini API Key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveApiKey()}
              placeholder="貼上你的 API Key"
              className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={saveApiKey}
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              儲存
            </button>
          </div>
          {apiKey && <p className="text-xs text-green-600 dark:text-green-400">✓ API Key 已儲存於 localStorage</p>}

          <button
            onClick={() => setShowSysPrompt(v => !v)}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 text-left mt-1 transition-colors w-fit"
          >
            {showSysPrompt ? '▾' : '▸'} 自訂系統提示（角色設定）
          </button>
          {showSysPrompt && (
            <textarea
              value={systemPrompt}
              onChange={e => saveSystemPrompt(e.target.value)}
              placeholder="例：你是一位法律顧問，請以專業但易懂的語言回答問題。"
              rows={3}
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          )}
        </div>

        {/* PDF Upload */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`bg-white dark:bg-gray-800 rounded-xl shadow p-4 flex flex-col gap-3 transition-all ${
            isDragging ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''
          }`}
        >
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">上傳 PDF（可多選或拖放）</label>
            <span className="text-xs text-gray-400 dark:text-gray-500">上限 15 MB / 份</span>
          </div>
          {isDragging ? (
            <div className="border-2 border-dashed border-blue-400 rounded-lg py-8 text-center text-blue-500 dark:text-blue-400 text-sm pointer-events-none">
              放開以上傳 PDF
            </div>
          ) : (
            <input
              type="file"
              accept="application/pdf"
              multiple
              onChange={handleUpload}
              className="text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 dark:file:bg-blue-900/40 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100 cursor-pointer"
            />
          )}
          {pdfs.length > 0 && (
            <div className="flex flex-col gap-1">
              {pdfs.map(pdf => (
                <button
                  key={pdf.id}
                  onClick={() => { setActivePdfId(pdf.id); setLastTokenUsage(null) }}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    pdf.id === activePdfId
                      ? 'bg-blue-50 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                      : 'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  <span className="truncate">{pdf.name}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 shrink-0">{fmtSize(pdf.size)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main Content */}
        {activePdf && apiKey && (
          <div className={`flex gap-4 ${showPreview ? 'items-start' : 'flex-col'}`}>

            {/* Chat Column */}
            <div className={`flex flex-col gap-3 ${showPreview ? 'flex-1 min-w-0' : ''}`}>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow flex flex-col">
                {/* Chat header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300 truncate">{activePdf.name}</span>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => setShowPreview(v => !v)}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        showPreview
                          ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                          : 'text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      預覽
                    </button>
                    {messages.length > 0 && (
                      <>
                        <button
                          onClick={() => exportMd(activePdf.name, messages)}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          匯出 .md
                        </button>
                        <button
                          onClick={() => setMsgs(activePdf.id, [])}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          清除
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Messages */}
                <div className="p-4 flex flex-col gap-3 min-h-[300px] max-h-[480px] overflow-y-auto">
                  {messages.length === 0 && (
                    <p className="text-gray-400 dark:text-gray-500 text-sm text-center mt-8">
                      請輸入問題，開始對 PDF 進行問答
                    </p>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className="relative group max-w-[85%]">
                        <div
                          className={`px-4 py-2 rounded-2xl text-sm ${
                            m.role === 'user'
                              ? 'bg-blue-500 text-white rounded-br-sm'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-sm'
                          }`}
                        >
                          {m.role === 'user' ? (
                            <span className="whitespace-pre-wrap">{m.text}</span>
                          ) : m.text === '' && loading && i === messages.length - 1 ? (
                            <span className="text-gray-400 dark:text-gray-500">思考中…</span>
                          ) : (
                            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                            </div>
                          )}
                        </div>
                        {m.role === 'model' && m.text && <CopyButton text={m.text} />}
                        {isLastModelMsg(i) && (
                          <button
                            onClick={regenerate}
                            className="mt-1 text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                          >
                            ↺ 重試
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              </div>

              {/* Token usage */}
              {lastTokenUsage && (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-right">
                  本次：提示 {lastTokenUsage.prompt.toLocaleString()} + 回答 {lastTokenUsage.completion.toLocaleString()} = {lastTokenUsage.total.toLocaleString()} tokens
                </p>
              )}

              {error && (
                <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              {/* Preset prompts */}
              <div className="flex flex-wrap gap-2">
                {PRESET_PROMPTS.map(p => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    disabled={loading}
                    className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 text-gray-600 dark:text-gray-400 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                  }}
                  placeholder="輸入問題（Enter 送出，Shift+Enter 換行）"
                  rows={2}
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-500 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                  onClick={() => send()}
                  disabled={!input.trim() || loading}
                  className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white px-4 py-2 rounded-xl transition-colors self-end"
                >
                  送出
                </button>
              </div>
            </div>

            {/* PDF Preview Column */}
            {showPreview && (
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden flex flex-col" style={{ height: 620 }}>
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-300">PDF 預覽</span>
                  </div>
                  <iframe
                    src={activePdf.objectUrl}
                    className="flex-1 w-full"
                    title="PDF preview"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {!apiKey && <p className="text-center text-gray-400 dark:text-gray-500 text-sm">請先輸入並儲存 API Key</p>}
        {apiKey && !activePdf && <p className="text-center text-gray-400 dark:text-gray-500 text-sm">請上傳 PDF 檔案</p>}
      </div>
    </div>
  )
}
