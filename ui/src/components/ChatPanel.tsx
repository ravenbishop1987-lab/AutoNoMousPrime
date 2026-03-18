import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bot, CheckCircle2, Download, Loader, Sparkles, Zap } from 'lucide-react'
import { sendUnifiedChat, pollChatTaskResult, type ChatOutputFile } from '../api'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  agent_name?: string
  executed?: boolean
  task_type?: string | null
  task_id?: string
  task_ids?: string[]
  output_files?: ChatOutputFile[]
  polling?: boolean
}

const SUGGESTIONS = [
  'Write a blog post about AI tools for freelancers',
  'Run the full pipeline for "passive income ideas 2026"',
  'Generate an image of a futuristic city skyline',
  'Do SEO research on email marketing automation',
]

function OutputPreview({ files }: { files: ChatOutputFile[] }) {
  if (!files.length) return null
  return (
    <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
      {files.map(f => (
        <div key={f.url} style={{
          background: 'rgba(255,255,255,.04)',
          border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          {f.type === 'image' && (
            <img src={f.url} alt={f.name} style={{ width: '100%', maxHeight: 300, objectFit: 'contain', display: 'block', background: '#000' }} />
          )}
          {f.type === 'audio' && (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>🎙️ {f.name}</div>
              <audio controls style={{ width: '100%' }} src={f.url} />
            </div>
          )}
          {f.type === 'video' && (
            <video controls style={{ width: '100%', maxHeight: 300, display: 'block' }} src={f.url} />
          )}
          {f.type === 'blog' && (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>📄 {f.name}</div>
            </div>
          )}
          <div style={{
            padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,.07)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{f.size_kb} KB</span>
            <a
              href={f.url}
              download={f.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 600, color: '#58a6ff',
                textDecoration: 'none',
              }}
            >
              <Download size={11} /> Download
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pollingRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Clean up all pollers on unmount
  useEffect(() => {
    return () => { Object.values(pollingRef.current).forEach(clearInterval) }
  }, [])

  const startPolling = (msgId: string, taskId: string) => {
    let attempts = 0
    const maxAttempts = 40 // 40 × 5s = ~3.3 min max
    const id = setInterval(async () => {
      attempts++
      try {
        const result = await pollChatTaskResult(taskId)
        if (result.status === 'done' || result.status === 'error' || attempts >= maxAttempts) {
          clearInterval(id)
          delete pollingRef.current[msgId]
          setMessages(prev => prev.map(m =>
            m.id === msgId
              ? { ...m, polling: false, output_files: result.files }
              : m
          ))
        }
      } catch { /* keep polling */ }
    }, 5000)
    pollingRef.current[msgId] = id
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [input])

  const send = async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || loading) return

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: msg,
      at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError('')

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, text: m.text }))
      const reply = await sendUnifiedChat(msg, history)
      const msgId = `a-${Date.now()}`
      const isFileTask = reply.executed && ['image_gen', 'tts', 'video_caption', 'blog_post'].includes(reply.task_type ?? '')
      setMessages(prev => [
        ...prev,
        {
          id: msgId,
          role: 'assistant',
          text: reply.reply,
          at: reply.timestamp,
          agent_name: reply.agent_name,
          executed: reply.executed,
          task_type: reply.task_type,
          task_id: reply.task_id,
          task_ids: reply.task_ids,
          polling: isFileTask,
          output_files: [],
        },
      ])
      // Start polling for output files
      const pollId = reply.task_id || (reply.task_ids?.[0])
      if (isFileTask && pollId) {
        startPolling(msgId, pollId)
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const empty = messages.length === 0

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 56px)',
      maxHeight: 'calc(100vh - 56px)',
      overflow: 'hidden',
    }}>
      {/* Messages area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
        {empty ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 24,
            padding: '40px 24px',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'rgba(88,166,255,.12)',
                border: '1px solid rgba(88,166,255,.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <Sparkles size={22} color="#58a6ff" />
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                What can I help you build?
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 420, lineHeight: 1.6 }}>
                Ask me to write content, generate images, run pipelines, do SEO research, or anything else. I'll route it to the right agent automatically.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%', maxWidth: 540 }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  className="btn-ghost"
                  onClick={() => send(s)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 14px',
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: 'var(--muted)',
                    whiteSpace: 'normal',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '24px 24px 8px' }}>
            {messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: 4,
                }}
              >
                {msg.role === 'assistant' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%',
                      background: 'rgba(88,166,255,.14)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Bot size={11} color="#58a6ff" />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                      {msg.agent_name || 'Autonomous Prime'}
                    </span>
                  </div>
                )}
                <div style={{
                  maxWidth: '72%',
                  background: msg.role === 'user'
                    ? 'rgba(88,166,255,.13)'
                    : 'var(--surface)',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(88,166,255,.25)' : 'var(--border)'}`,
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
                  padding: '10px 14px',
                }}>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
                    {msg.text}
                  </div>
                  {msg.executed && (
                    <div style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      color: '#3fb950',
                    }}>
                      <Zap size={11} />
                      {msg.task_ids && msg.task_ids.length > 0
                        ? `${msg.task_ids.length} tasks queued`
                        : `Task queued · ${msg.task_type || 'processing'}`}
                      {msg.polling
                        ? <Loader size={11} className="spin" style={{ marginLeft: 'auto' }} />
                        : <CheckCircle2 size={11} style={{ marginLeft: 'auto' }} />
                      }
                    </div>
                  )}
                  {msg.polling && (
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                      Generating — preview will appear when ready…
                    </div>
                  )}
                  {msg.output_files && msg.output_files.length > 0 && (
                    <OutputPreview files={msg.output_files} />
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4, paddingTop: 4 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'rgba(88,166,255,.14)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Bot size={11} color="#58a6ff" />
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: 'var(--muted)',
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '12px 24px 16px',
        background: 'var(--bg)',
        flexShrink: 0,
      }}>
        {error && (
          <div style={{ fontSize: 12, color: '#f85149', marginBottom: 8 }}>{error}</div>
        )}
        <div style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '8px 8px 8px 14px',
        }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Message Autonomous Prime..."
            rows={1}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            style={{
              flex: 1,
              resize: 'none',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 13.5,
              color: 'var(--text)',
              lineHeight: 1.5,
              padding: 0,
              minHeight: 22,
              maxHeight: 180,
              fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={!input.trim() || loading}
            style={{
              width: 32, height: 32,
              borderRadius: 8,
              border: 'none',
              background: input.trim() && !loading ? 'var(--accent)' : 'var(--surface2)',
              color: input.trim() && !loading ? '#fff' : 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: input.trim() && !loading ? 'pointer' : 'default',
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
          >
            {loading ? <Loader size={14} className="spin" /> : <ArrowUp size={14} />}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, textAlign: 'center' }}>
          Press Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  )
}
