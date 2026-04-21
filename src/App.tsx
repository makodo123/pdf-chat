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
  } catch {
    return []
  }
}

function persistConv(id: string, msgs: Message[]) {
  try {
    localStorage.setItem(`conv-${id}`, JSON.stringify(msgs))
  } catch { /* localStorage full */ }
}

function exportMd(pdfName: string, msgs: Message[]) {
  const lines = [`# ${pdfName} — 問答紀錄\n`]
  for (const m of msgs) {
    lines.push(m.role === 'user' ? `**我：** ${m.text}\n` : `**AI：**\n\n${m.text}\n`)
  }
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

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini-api-key') ?? '')
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('gemini-api-key') ?? '')
  const [pdfs, setPdfs] = useState<PdfData[]>([])
  const [activePdfId, setActivePdfId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Record<string, Message[]>>({})
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

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
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
      added.push({ id, base64, mimeType: 'application/pdf', name: file.name, size: file.size })
      const saved = loadConv(id)
      if (saved.length) setConversations(prev => ({ ...prev, [id]: saved }))
    }

    if (added.length) {
      setPdfs(prev => {
        const existing = new Set(prev.map(p => p.id))
        return [...prev, ...added.filter(p => !existing.has(p.id))]
      })
      setActivePdfId(added[0].id)
    }
    e.target.value = ''
  }

  async function send(text?: string) {
    const userText = (text ?? input).trim()
    if (!userText || !activePdf || !apiKey || loading) return
    if (!text) setInput('')
    setError('')

    const pdfId = activePdf.id
    const prevMsgs = messages
    const newMsgs: Message[] = [...prevMsgs, { role: 'user', text: userText }]

    // Add streaming placeholder
    setConversations(prev => ({
      ...prev,
      [pdfId]: [...newMsgs, { role: 'model', text: '' }],
    }))
    setLoading(true)

    try {
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' })

      const history = prevMsgs.map(m => ({ role: m.role, parts: [{ text: m.text }] }))
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

      const final: Message[] = [...newMsgs, { role: 'model', text: full }]
      persistConv(pdfId, final)
    } catch (err) {
      setError(err instanceof Error ? err.message : '發生錯誤，請確認 API Key 是否正確')
      setConversations(prev => ({ ...prev, [pdfId]: newMsgs }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-2xl flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-gray-800 text-center">PDF 問答</h1>

        {/* API Key */}
        <div className="bg-white rounded-xl shadow p-4 flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Gemini API Key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveApiKey()}
              placeholder="貼上你的 API Key"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={saveApiKey}
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              儲存
            </button>
          </div>
          {apiKey && <p className="text-xs text-green-600">✓ API Key 已儲存於 localStorage</p>}
        </div>

        {/* PDF Upload */}
        <div className="bg-white rounded-xl shadow p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">上傳 PDF（可多選）</label>
            <span className="text-xs text-gray-400">上限 15 MB / 份</span>
          </div>
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={handleUpload}
            className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
          />
          {pdfs.length > 0 && (
            <div className="flex flex-col gap-1">
              {pdfs.map(pdf => (
                <button
                  key={pdf.id}
                  onClick={() => setActivePdfId(pdf.id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    pdf.id === activePdfId
                      ? 'bg-blue-50 border border-blue-300 text-blue-700'
                      : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="truncate">{pdf.name}</span>
                  <span className="text-xs text-gray-400 ml-2 shrink-0">{fmtSize(pdf.size)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Chat */}
        {activePdf && apiKey && (
          <>
            <div className="bg-white rounded-xl shadow flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-600 truncate">{activePdf.name}</span>
                {messages.length > 0 && (
                  <div className="flex gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => exportMd(activePdf.name, messages)}
                      className="text-xs text-gray-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
                    >
                      匯出 .md
                    </button>
                    <button
                      onClick={() => setMsgs(activePdf.id, [])}
                      className="text-xs text-gray-500 hover:text-red-500 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
                    >
                      清除
                    </button>
                  </div>
                )}
              </div>

              <div className="p-4 flex flex-col gap-3 min-h-[300px] max-h-[480px] overflow-y-auto">
                {messages.length === 0 && (
                  <p className="text-gray-400 text-sm text-center mt-8">
                    請輸入問題，開始對 PDF 進行問答
                  </p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm ${
                        m.role === 'user'
                          ? 'bg-blue-500 text-white rounded-br-sm'
                          : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                      }`}
                    >
                      {m.role === 'user' ? (
                        <span className="whitespace-pre-wrap">{m.text}</span>
                      ) : m.text === '' && loading && i === messages.length - 1 ? (
                        <span className="text-gray-400">思考中…</span>
                      ) : (
                        <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            {error && (
              <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {PRESET_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  disabled={loading}
                  className="text-xs bg-white border border-gray-200 hover:border-blue-300 hover:text-blue-600 text-gray-600 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                }}
                placeholder="輸入問題（Enter 送出，Shift+Enter 換行）"
                rows={2}
                className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white px-4 py-2 rounded-xl transition-colors self-end"
              >
                送出
              </button>
            </div>
          </>
        )}

        {!apiKey && <p className="text-center text-gray-400 text-sm">請先輸入並儲存 API Key</p>}
        {apiKey && !activePdf && <p className="text-center text-gray-400 text-sm">請上傳 PDF 檔案</p>}
      </div>
    </div>
  )
}
