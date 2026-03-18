import { useState } from 'react'
import { Mic, Plus, Trash2, Play } from 'lucide-react'
import { submitTask } from '../api'

interface Speaker {
  id: string
  name: string
  voice: string
  role: 'host' | 'guest' | 'narrator'
  lines: string[]
}

const VOICE_OPTIONS = [
  { value: 'alloy', label: 'Alloy (Neutral)' },
  { value: 'echo', label: 'Echo (Male)' },
  { value: 'fable', label: 'Fable (British)' },
  { value: 'onyx', label: 'Onyx (Deep Male)' },
  { value: 'nova', label: 'Nova (Female)' },
  { value: 'shimmer', label: 'Shimmer (Soft Female)' },
]

function makeSpeaker(n: number): Speaker {
  return {
    id: crypto.randomUUID(),
    name: `Speaker ${n}`,
    voice: n === 1 ? 'nova' : 'echo',
    role: n === 1 ? 'host' : 'guest',
    lines: [],
  }
}

export default function PodcastPanel() {
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState('10')
  const [speakers, setSpeakers] = useState<Speaker[]>([makeSpeaker(1), makeSpeaker(2)])
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  function addSpeaker() {
    setSpeakers(s => [...s, makeSpeaker(s.length + 1)])
  }

  function removeSpeaker(id: string) {
    setSpeakers(s => s.filter(sp => sp.id !== id))
  }

  function updateSpeaker(id: string, field: keyof Speaker, value: string) {
    setSpeakers(s => s.map(sp => sp.id === id ? { ...sp, [field]: value } : sp))
  }

  async function generate() {
    if (!topic.trim()) return
    setStatus('running')
    setLog([])
    setResult(null)

    const push = (msg: string) => setLog(l => [...l, msg])
    push('Submitting podcast generation task...')

    try {
      const res = await submitTask('podcast_gen', {
        topic,
        description,
        duration_minutes: parseInt(duration),
        speakers: speakers.map(sp => ({
          name: sp.name,
          voice: sp.voice,
          role: sp.role,
        })),
      })
      push('Task submitted — generating script and audio...')
      setResult(res?.output_path || res?.filepath || JSON.stringify(res))
      setStatus('done')
      push('Done!')
    } catch (e: any) {
      push(`Error: ${e.message}`)
      setStatus('error')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Mic size={20} style={{ color: 'var(--accent)' }} />
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Create Podcast</h2>
      </div>

      {/* Topic & Settings */}
      <div className="card" style={{ display: 'grid', gap: 16, padding: 20 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>TOPIC</label>
          <input
            className="input"
            placeholder="e.g. The Future of AI in Marketing"
            value={topic}
            onChange={e => setTopic(e.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>DESCRIPTION (optional)</label>
          <textarea
            className="input"
            rows={3}
            placeholder="Key points to cover, tone, context..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>TARGET LENGTH</label>
          <select className="input" value={duration} onChange={e => setDuration(e.target.value)}>
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
            <option value="20">20 minutes</option>
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">60 minutes</option>
          </select>
        </div>
      </div>

      {/* Speakers */}
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>SPEAKERS</span>
          <button className="btn-ghost" onClick={addSpeaker} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '6px 12px' }}>
            <Plus size={14} /> Add Speaker
          </button>
        </div>

        {speakers.map((sp, i) => (
          <div key={sp.id} className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Speaker {i + 1}</span>
              {speakers.length > 1 && (
                <button className="btn-ghost" onClick={() => removeSpeaker(sp.id)} style={{ padding: '4px 8px', color: 'var(--muted)' }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>NAME</label>
                <input
                  className="input"
                  value={sp.name}
                  onChange={e => updateSpeaker(sp.id, 'name', e.target.value)}
                  placeholder="Speaker name"
                />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>VOICE</label>
                <select className="input" value={sp.voice} onChange={e => updateSpeaker(sp.id, 'voice', e.target.value)}>
                  {VOICE_OPTIONS.map(v => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ROLE</label>
                <select className="input" value={sp.role} onChange={e => updateSpeaker(sp.id, 'role', e.target.value as any)}>
                  <option value="host">Host</option>
                  <option value="guest">Guest</option>
                  <option value="narrator">Narrator</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Generate */}
      <button
        className="btn-primary"
        onClick={generate}
        disabled={status === 'running' || !topic.trim()}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 24px' }}
      >
        <Play size={16} />
        {status === 'running' ? 'Generating...' : 'Generate Podcast'}
      </button>

      {/* Log */}
      {log.length > 0 && (
        <div className="card" style={{ padding: 16, background: 'var(--surface)' }}>
          {log.map((line, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>{line}</div>
          ))}
        </div>
      )}

      {/* Result */}
      {status === 'done' && result && (
        <div className="card" style={{ padding: 16, borderColor: 'var(--accent2)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent2)', marginBottom: 6 }}>PODCAST GENERATED</div>
          <div style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-all' }}>{result}</div>
        </div>
      )}
    </div>
  )
}
