import { useState, useRef, useEffect } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'

interface Message {
  role: 'user' | 'model'
  text: string
}

interface PdfData {
  base64: string
  mimeType: string
  name: string
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini-api-key') ?? '')
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('gemini-api-key') ?? '')
  const [pdfData, setPdfData] = useState<PdfData | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function saveApiKey() {
    const key = apiKeyInput.trim()
    if (!key) return
    localStorage.setItem('gemini-api-key', key)
    setApiKey(key)
    setError('')
  }

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const base64 = await readFileAsBase64(file)
      setPdfData({ base64, mimeType: 'application/pdf', name: file.name })
      setMessages([])
      setError('')
    } catch {
      setError('無法讀取 PDF 檔案')
    }
  }

  async function sendMessage() {
    if (!input.trim() || !pdfData || !apiKey || loading) return
    const userText = input.trim()
    setInput('')
    setError('')

    const newMessages: Message[] = [...messages, { role: 'user', text: userText }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

      const pdfPart = {
        inlineData: { data: pdfData.base64, mimeType: pdfData.mimeType },
      }

      const historyParts = messages.flatMap((m) => [
        { role: m.role, parts: [{ text: m.text }] },
      ])

      const chat = model.startChat({ history: historyParts })

      const result = await chat.sendMessage([pdfPart, { text: userText }])
      const responseText = result.response.text()

      setMessages([...newMessages, { role: 'model', text: responseText }])
    } catch (err) {
      setError(err instanceof Error ? err.message : '發生錯誤，請確認 API Key 是否正確')
      setMessages(newMessages)
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const ready = !!apiKey && !!pdfData

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
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
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
          {apiKey && (
            <p className="text-xs text-green-600">✓ API Key 已儲存於 localStorage</p>
          )}
        </div>

        {/* PDF Upload */}
        <div className="bg-white rounded-xl shadow p-4 flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">上傳 PDF</label>
          <input
            type="file"
            accept="application/pdf"
            onChange={handlePdfUpload}
            className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
          />
          {pdfData && (
            <p className="text-xs text-green-600">✓ 已載入：{pdfData.name}</p>
          )}
        </div>

        {/* Chat */}
        {ready && (
          <>
            <div className="bg-white rounded-xl shadow p-4 flex flex-col gap-3 min-h-[300px] max-h-[480px] overflow-y-auto">
              {messages.length === 0 && (
                <p className="text-gray-400 text-sm text-center mt-8">
                  請輸入問題，開始對 PDF 進行問答
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-blue-500 text-white rounded-br-sm'
                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-500 px-4 py-2 rounded-2xl rounded-bl-sm text-sm">
                    思考中…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {error && (
              <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="輸入問題（Enter 送出，Shift+Enter 換行）"
                rows={2}
                className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white px-4 py-2 rounded-xl transition-colors self-end"
              >
                送出
              </button>
            </div>
          </>
        )}

        {!apiKey && (
          <p className="text-center text-gray-400 text-sm">請先輸入並儲存 API Key</p>
        )}
        {apiKey && !pdfData && (
          <p className="text-center text-gray-400 text-sm">請上傳 PDF 檔案</p>
        )}
      </div>
    </div>
  )
}
