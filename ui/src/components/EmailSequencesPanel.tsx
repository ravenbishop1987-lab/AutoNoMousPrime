import { useEffect, useState } from 'react'
import { api, saas, generateNewsletter } from '../api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmailStep {
  id?: string
  step_number: number
  subject: string
  body_html: string
  body_plain?: string
  delay_days: number
  is_active: boolean
}

interface EmailSequence {
  id: string
  name: string
  description?: string
  trigger_type: string
  trigger_tag?: string
  status: string
  steps?: EmailStep[]
  created_at: string
  _backend?: 'local' | 'saas'
}

type View = 'list' | 'editor' | 'new'

const TRIGGER_TYPES = [
  { id: 'manual',           label: 'Manual enroll',     icon: '👆' },
  { id: 'new_subscriber',   label: 'New subscriber',    icon: '🙋' },
  { id: 'form_submission',  label: 'Form submission',   icon: '📋' },
  { id: 'tag_applied',      label: 'Tag applied',       icon: '🏷️' },
  { id: 'webhook',          label: 'Webhook event',     icon: '🔗' },
]

const STATUS_COLORS: Record<string, string> = {
  active: '#3fb950', paused: '#e3b341', archived: '#8b949e', completed: '#58a6ff',
}

// ── Step Editor Modal ─────────────────────────────────────────────────────────

const EMAIL_TYPES_AI = [
  { id: 'newsletter',    label: 'Newsletter' },
  { id: 'promotional',  label: 'Promotional' },
  { id: 'welcome',      label: 'Welcome' },
  { id: 'reengagement', label: 'Re-engagement' },
  { id: 'event_invite', label: 'Event Invite' },
]

function StepEditor({
  step, stepIndex, onSave, onClose, generating,
}: {
  step: Partial<EmailStep>
  stepIndex: number
  onSave: (s: Partial<EmailStep>) => void
  onClose: () => void
  generating: boolean
}) {
  const [subject, setSubject] = useState(step.subject || '')
  const [bodyHtml, setBodyHtml] = useState(step.body_html || '')
  const [delayDays, setDelayDays] = useState(step.delay_days ?? (stepIndex === 0 ? 0 : 3))
  const [isActive, setIsActive] = useState(step.is_active !== false)
  const [bodyTab, setBodyTab] = useState<'code' | 'preview'>('code')

  // AI generation state
  const [aiOpen, setAiOpen] = useState(!step.subject)
  const [aiTopic, setAiTopic] = useState('')
  const [aiNiche, setAiNiche] = useState('')
  const [aiType, setAiType] = useState('newsletter')
  const [aiTone, setAiTone] = useState('conversational')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState('')

  const generateWithAI = async () => {
    if (!aiTopic.trim()) { setAiError('Topic is required'); return }
    setAiError('')
    setAiGenerating(true)
    try {
      const res = await generateNewsletter({
        email_type: aiType,
        niche: aiNiche,
        audience: '',
        topic: aiTopic,
        tones: [aiTone],
        options: ['include_cta'],
        length: 'medium',
      })
      setSubject(res.subject)
      setBodyHtml(res.body_html)
      setAiOpen(false)
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setAiGenerating(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Step {stepIndex + 1} — {delayDays === 0 ? 'Day 0 (sends immediately)' : `Day +${delayDays}`}
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {/* Day picker — shown for all steps */}
          <div style={{ background: 'rgba(88,166,255,.04)', border: '1px solid rgba(88,166,255,.15)', borderRadius: 12, padding: '14px 16px' }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', display: 'block', marginBottom: 10, letterSpacing: '.06em' }}>
              {stepIndex === 0 ? 'SEND ON DAY (from enrollment)' : 'SEND DELAY (days after previous step)'}
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {(stepIndex === 0 ? [0, 1, 2, 3] : [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90]).map(d => (
                <button key={d} onClick={() => setDelayDays(d)} style={{
                  padding: '6px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: `2px solid ${delayDays === d ? 'var(--accent)' : 'var(--border)'}`,
                  background: delayDays === d ? 'rgba(88,166,255,.15)' : 'transparent',
                  color: delayDays === d ? 'var(--accent)' : 'var(--text)',
                }}>Day {d}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Custom:</span>
              <input
                type="number"
                min={stepIndex === 0 ? 0 : 1}
                value={delayDays}
                onChange={e => setDelayDays(Math.max(stepIndex === 0 ? 0 : 1, parseInt(e.target.value) || 0))}
                style={{ width: 72, padding: '5px 10px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', textAlign: 'center' }}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>days</span>
              {delayDays === 0 && stepIndex === 0 && <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 700 }}>sends immediately on enrollment</span>}
            </div>
          </div>

          {/* ── AI Generator ── */}
          <div style={{ border: `1px solid ${aiOpen ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, overflow: 'hidden' }}>
            <button
              onClick={() => setAiOpen(o => !o)}
              style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: aiOpen ? 'rgba(88,166,255,.08)' : 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>✨</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Generate with AI</span>
                {subject && <span style={{ fontSize: 10, color: '#3fb950', fontWeight: 700 }}>CONTENT READY</span>}
              </div>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{aiOpen ? '▲' : '▼'}</span>
            </button>

            {aiOpen && (
              <div style={{ padding: '0 16px 16px', display: 'grid', gap: 12, borderTop: '1px solid var(--border)' }}>
                <div style={{ paddingTop: 12 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, letterSpacing: '.06em' }}>EMAIL TYPE</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {EMAIL_TYPES_AI.map(t => (
                      <button key={t.id} onClick={() => setAiType(t.id)} style={{
                        padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        border: `1.5px solid ${aiType === t.id ? 'var(--accent)' : 'var(--border)'}`,
                        background: aiType === t.id ? 'rgba(88,166,255,.12)' : 'transparent',
                        color: aiType === t.id ? 'var(--accent)' : 'var(--text)',
                      }}>{t.label}</button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, letterSpacing: '.06em' }}>NICHE / INDUSTRY</label>
                    <input className="input" value={aiNiche} onChange={e => setAiNiche(e.target.value)} placeholder="e.g. fitness coaches, SaaS founders" style={{ fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, letterSpacing: '.06em' }}>TONE</label>
                    <select className="input" value={aiTone} onChange={e => setAiTone(e.target.value)} style={{ fontSize: 12, padding: '8px 10px' }}>
                      {['conversational','professional','witty','urgent','inspirational'].map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, letterSpacing: '.06em' }}>TOPIC / GOAL *</label>
                  <textarea className="input" value={aiTopic} onChange={e => setAiTopic(e.target.value)}
                    placeholder={`e.g. ${stepIndex === 0 ? 'Welcome new subscribers and introduce the product' : stepIndex === 1 ? 'Share a quick win tip to build trust' : 'Drive subscribers to book a call or start a trial'}`}
                    rows={2} style={{ fontSize: 13, resize: 'none', fontFamily: 'inherit' }} />
                </div>

                {aiError && <div style={{ fontSize: 12, color: '#f85149' }}>{aiError}</div>}

                <button
                  className="btn-primary"
                  onClick={generateWithAI}
                  disabled={aiGenerating || !aiTopic.trim()}
                  style={{ padding: '10px 18px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {aiGenerating
                    ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙️</span> Generating…</>
                    : <>✨ Generate Email</>}
                </button>
              </div>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>SUBJECT LINE</label>
            </div>
            <input className="input" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="e.g. {{first_name}}, here's what you need to know..." style={{ fontSize: 14 }} />
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
              Personalization: {'{{first_name}}'} · {'{{last_name}}'} · {'{{email}}'}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>EMAIL BODY</label>
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {(['code', 'preview'] as const).map(t => (
                  <button key={t} onClick={() => setBodyTab(t)} style={{
                    padding: '4px 12px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: bodyTab === t ? 'var(--accent)' : 'transparent',
                    color: bodyTab === t ? '#fff' : 'var(--muted)',
                  }}>{t === 'code' ? '{ } HTML' : '👁 Preview'}</button>
                ))}
              </div>
            </div>
            {bodyTab === 'code' ? (
              <textarea
                className="input"
                value={bodyHtml}
                onChange={e => setBodyHtml(e.target.value)}
                placeholder="<p>Hey {{first_name}},</p><p>Your email content here...</p>"
                rows={12}
                style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
              />
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#f4f4f5' }}>
                {/* Email client chrome */}
                <div style={{ background: '#1c1c1e', padding: '8px 14px', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {['#f85149','#e3b341','#3fb950'].map(c => <span key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c, display: 'inline-block' }} />)}
                  <span style={{ flex: 1, fontSize: 10, color: '#666', textAlign: 'center' }}>{subject || '(no subject)'}</span>
                </div>
                {bodyHtml ? (
                  <iframe
                    srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:16px 0}
.wrap{max-width:560px;margin:0 auto}
.card{background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.brand{background:linear-gradient(135deg,#0d1117,#161b22);padding:18px 28px}
.brand-name{color:#58a6ff;font-size:14px;font-weight:800;letter-spacing:.05em}
.content{padding:28px;color:#1c1c1e;font-size:14px;line-height:1.7}
.content p{margin-bottom:14px;color:#3a3a4c}
.content h2{font-size:20px;font-weight:800;color:#0d0d1a;margin:22px 0 10px}
.content h3{font-size:16px;font-weight:700;color:#0d0d1a;margin:18px 0 7px}
.content ul,.content ol{padding-left:20px;margin-bottom:14px}
.content li{margin-bottom:7px;color:#3a3a4c}
.content strong{color:#0d0d1a}
.content blockquote{border-left:4px solid #58a6ff;padding:12px 18px;margin:18px 0;color:#555;font-style:italic;background:#f6f8ff;border-radius:0 8px 8px 0}
.cta-block{text-align:center;margin:28px 0}
.cta-block a{display:inline-block;padding:13px 36px;background:linear-gradient(135deg,#58a6ff,#3b82f6);color:#fff;border-radius:9px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 4px 14px rgba(88,166,255,.3)}
.footer{background:#f8f9fb;border-top:1px solid #eee;padding:14px 28px;text-align:center;font-size:10px;color:#aaa}
</style></head><body>
<div class="wrap"><div class="card">
<div class="brand"><div class="brand-name">Preview</div></div>
<div class="content">${bodyHtml}</div>
<div class="footer">Unsubscribe · Update preferences</div>
</div></div></body></html>`}
                    style={{ width: '100%', height: 380, border: 'none', display: 'block' }}
                    title="Email preview"
                  />
                ) : (
                  <div style={{ padding: 40, textAlign: 'center', color: '#aaa', fontSize: 13 }}>No content yet — write HTML or generate with AI</div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="step-active" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
            <label htmlFor="step-active" style={{ fontSize: 13, cursor: 'pointer' }}>Step is active</label>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            <button className="btn-ghost" onClick={onClose} style={{ padding: '8px 18px' }}>Cancel</button>
            <button className="btn-primary" onClick={() => onSave({ subject, body_html: bodyHtml, delay_days: delayDays, is_active: isActive })}
              disabled={!subject.trim() || generating} style={{ padding: '8px 20px' }}>
              {generating ? 'Saving…' : 'Save Step'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function EmailSequencesPanel() {
  const [view, setView] = useState<View>('list')
  const [sequences, setSequences] = useState<EmailSequence[]>([])
  const [selectedSeq, setSelectedSeq] = useState<EmailSequence | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingStep, setEditingStep] = useState<{ step: Partial<EmailStep>; index: number } | null>(null)

  // New/edit sequence form
  const [seqName, setSeqName] = useState('')
  const [seqDesc, setSeqDesc] = useState('')
  const [seqTrigger, setSeqTrigger] = useState('manual')
  const [seqTriggerTag, setSeqTriggerTag] = useState('')
  const [seqStatus, setSeqStatus] = useState('active')

  // SMTP settings view
  const [showSmtp, setShowSmtp] = useState(false)
  const [smtpConfig, setSmtpConfig] = useState<Record<string, string>>({})
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpTestEmail, setSmtpTestEmail] = useState('')
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpMsg, setSmtpMsg] = useState('')

  const loadSequences = async () => {
    setLoading(true)
    setError('')
    try {
      const [localRes, saasRes] = await Promise.allSettled([
        api.get('/email-sequences'),
        saas.get('/email-sequences'),
      ])
      const localSeqs: EmailSequence[] = localRes.status === 'fulfilled'
        ? (localRes.value.data.sequences || []).map((s: EmailSequence) => ({ ...s, _backend: 'local' as const }))
        : []
      const saasSeqs: EmailSequence[] = saasRes.status === 'fulfilled'
        ? (saasRes.value.data.sequences || []).map((s: EmailSequence) => ({ ...s, _backend: 'saas' as const }))
        : []
      const seenIds = new Set(localSeqs.map(s => s.id))
      setSequences([...localSeqs, ...saasSeqs.filter(s => !seenIds.has(s.id))])
    } catch { setError('Failed to load sequences') }
    finally { setLoading(false) }
  }

  const loadSmtpConfig = async () => {
    try {
      const r = await saas.get('/email-smtp/config')
      if (r.data.config) setSmtpConfig(r.data.config)
    } catch { /* no config yet */ }
  }

  useEffect(() => { loadSequences() }, [])

  const openSequence = async (seq: EmailSequence) => {
    try {
      const client = seq._backend === 'saas' ? saas : api
      const r = await client.get(`/email-sequences/${seq.id}`)
      const loaded = { ...r.data.sequence, _backend: seq._backend }
      setSelectedSeq(loaded)
      setSeqName(loaded.name)
      setSeqDesc(loaded.description || '')
      setSeqTrigger(loaded.trigger_type)
      setSeqTriggerTag(loaded.trigger_tag || '')
      setSeqStatus(loaded.status)
      setView('editor')
    } catch { setError('Failed to load sequence') }
  }

  const createSequence = async () => {
    if (!seqName.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      const r = await api.post('/email-sequences', { name: seqName, description: seqDesc, trigger_type: seqTrigger, trigger_tag: seqTriggerTag, status: seqStatus })
      await loadSequences()
      setSelectedSeq({ ...r.data.sequence, _backend: 'local' as const })
      setView('editor')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create')
    } finally { setSaving(false) }
  }

  const saveSequenceMeta = async () => {
    if (!selectedSeq) return
    setSaving(true)
    try {
      const client = selectedSeq._backend === 'saas' ? saas : api
      await client.patch(`/email-sequences/${selectedSeq.id}`, { name: seqName, description: seqDesc, trigger_type: seqTrigger, trigger_tag: seqTriggerTag, status: seqStatus })
      await loadSequences()
    } catch { setError('Failed to save') }
    finally { setSaving(false) }
  }

  const deleteSequence = async (id: string) => {
    if (!confirm('Delete this sequence and all its steps?')) return
    const seq = sequences.find(s => s.id === id)
    const client = seq?._backend === 'saas' ? saas : api
    await client.delete(`/email-sequences/${id}`)
    await loadSequences()
  }

  const saveStep = async (stepData: Partial<EmailStep>) => {
    if (!selectedSeq || !editingStep) return
    setSaving(true)
    const client = selectedSeq._backend === 'saas' ? saas : api
    try {
      const existing = editingStep.step.id
      if (existing) {
        await client.patch(`/email-sequences/${selectedSeq.id}/steps/${existing}`, stepData)
      } else {
        await client.post(`/email-sequences/${selectedSeq.id}/steps`, stepData)
      }
      const r = await client.get(`/email-sequences/${selectedSeq.id}`)
      setSelectedSeq({ ...r.data.sequence, _backend: selectedSeq._backend })
      setEditingStep(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save step')
    } finally { setSaving(false) }
  }

  const deleteStep = async (stepId: string) => {
    if (!selectedSeq) return
    const client = selectedSeq._backend === 'saas' ? saas : api
    await client.delete(`/email-sequences/${selectedSeq.id}/steps/${stepId}`)
    const r = await client.get(`/email-sequences/${selectedSeq.id}`)
    setSelectedSeq({ ...r.data.sequence, _backend: selectedSeq._backend })
  }

  const saveSmtp = async () => {
    setSmtpSaving(true)
    setSmtpMsg('')
    try {
      await saas.post('/email-smtp/config', { ...smtpConfig, gmail_app_password: smtpPassword || undefined })
      setSmtpMsg('✓ Saved')
    } catch { setSmtpMsg('✗ Failed to save') }
    finally { setSmtpSaving(false) }
  }

  const testSmtp = async () => {
    if (!smtpTestEmail.trim()) return
    setSmtpSaving(true)
    setSmtpMsg('')
    try {
      await saas.post('/email-smtp/test', { to_email: smtpTestEmail })
      setSmtpMsg(`✓ Test email sent to ${smtpTestEmail}`)
    } catch (e: unknown) {
      setSmtpMsg(`✗ ${e instanceof Error ? e.message : 'Send failed'}`)
    } finally { setSmtpSaving(false) }
  }

  const steps = (selectedSeq?.steps || []).sort((a, b) => a.step_number - b.step_number)

  // ── SMTP Settings ─────────────────────────────────────────────────────────
  if (showSmtp) {
    return (
      <div style={{ maxWidth: 600, display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => { setShowSmtp(false); loadSequences() }}>← Back</button>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Gmail SMTP Settings</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Configure your Gmail app password for sending sequences</div>
          </div>
        </div>

        <div style={{ background: 'rgba(88,166,255,.06)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 10, padding: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--accent)' }}>How to get a Gmail App Password:</strong><br />
          1. Go to Google Account → Security → 2-Step Verification (must be enabled)<br />
          2. Scroll down to "App passwords" → Select app: Mail, device: Other<br />
          3. Copy the 16-character password and paste below
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {[
            { key: 'from_name', label: 'FROM NAME', placeholder: 'e.g. Mark from FocusLab' },
            { key: 'gmail_user', label: 'GMAIL ADDRESS', placeholder: 'you@gmail.com' },
            { key: 'base_url', label: 'BASE URL (for tracking links)', placeholder: 'https://yourdomain.com' },
          ].map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, letterSpacing: '.06em' }}>{f.label}</label>
              <input className="input" value={smtpConfig[f.key] || ''} onChange={e => setSmtpConfig(c => ({ ...c, [f.key]: e.target.value }))} placeholder={f.placeholder} style={{ fontSize: 13 }} />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, letterSpacing: '.06em' }}>APP PASSWORD (16 chars)</label>
            <input className="input" type="password" value={smtpPassword} onChange={e => setSmtpPassword(e.target.value)} placeholder="Leave blank to keep existing password" style={{ fontSize: 13 }} />
          </div>
        </div>

        <button className="btn-primary" onClick={saveSmtp} disabled={smtpSaving} style={{ padding: '11px 20px' }}>
          {smtpSaving ? 'Saving…' : 'Save SMTP Config'}
        </button>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'grid', gap: 10 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>TEST SEND</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={smtpTestEmail} onChange={e => setSmtpTestEmail(e.target.value)} placeholder="Send test to..." style={{ fontSize: 13, flex: 1 }} />
            <button className="btn-ghost" onClick={testSmtp} disabled={smtpSaving || !smtpTestEmail.trim()} style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}>Send Test</button>
          </div>
        </div>

        {smtpMsg && <div style={{ fontSize: 13, color: smtpMsg.startsWith('✓') ? '#3fb950' : '#f85149' }}>{smtpMsg}</div>}
      </div>
    )
  }

  // ── List View ─────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📧 Email Sequences</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Automated multi-step email campaigns</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={() => { loadSmtpConfig(); setShowSmtp(true) }} style={{ padding: '8px 14px', fontSize: 12 }}>⚙️ SMTP Settings</button>
            <button className="btn-primary" onClick={() => { setSeqName(''); setSeqDesc(''); setSeqTrigger('manual'); setView('new') }} style={{ padding: '8px 16px', fontSize: 13 }}>+ New Sequence</button>
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : sequences.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', border: '2px dashed var(--border)', borderRadius: 12 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No sequences yet</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Create your first automated email sequence</div>
            <button className="btn-primary" onClick={() => setView('new')} style={{ padding: '10px 20px' }}>+ Create Sequence</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {sequences.map(seq => (
              <div key={seq.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{seq.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: `${STATUS_COLORS[seq.status]}22`, color: STATUS_COLORS[seq.status] }}>
                      {seq.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16 }}>
                    <span>{TRIGGER_TYPES.find(t => t.id === seq.trigger_type)?.icon} {TRIGGER_TYPES.find(t => t.id === seq.trigger_type)?.label}</span>
                    <span>{(seq.steps?.length || 0)} step{(seq.steps?.length || 0) !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost" onClick={() => openSequence(seq)} style={{ padding: '6px 14px', fontSize: 12 }}>Edit</button>
                  <button onClick={() => deleteSequence(seq.id)} style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: '#f85149', cursor: 'pointer' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── New Sequence Form ─────────────────────────────────────────────────────
  if (view === 'new') {
    return (
      <div style={{ maxWidth: 560, display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setView('list')}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>New Email Sequence</h2>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, letterSpacing: '.06em' }}>SEQUENCE NAME</label>
            <input className="input" value={seqName} onChange={e => setSeqName(e.target.value)} placeholder="e.g. Welcome Series, Product Launch, 7-Day Course" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, letterSpacing: '.06em' }}>DESCRIPTION (optional)</label>
            <input className="input" value={seqDesc} onChange={e => setSeqDesc(e.target.value)} placeholder="Internal note about this sequence" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>TRIGGER</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {TRIGGER_TYPES.map(t => (
                <button key={t.id} onClick={() => setSeqTrigger(t.id)} style={{
                  padding: '10px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, cursor: 'pointer', textAlign: 'center',
                  border: `2px solid ${seqTrigger === t.id ? 'var(--accent)' : 'var(--border)'}`,
                  background: seqTrigger === t.id ? 'rgba(88,166,255,.1)' : 'var(--surface)',
                  color: seqTrigger === t.id ? 'var(--accent)' : 'var(--text)',
                }}>
                  <div style={{ fontSize: 16, marginBottom: 3 }}>{t.icon}</div>{t.label}
                </button>
              ))}
            </div>
          </div>
          {seqTrigger === 'tag_applied' && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6, letterSpacing: '.06em' }}>TRIGGER TAG</label>
              <input className="input" value={seqTriggerTag} onChange={e => setSeqTriggerTag(e.target.value)} placeholder="e.g. customer, lead, webinar-attendee" />
            </div>
          )}
        </div>

        {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

        <button className="btn-primary" onClick={createSequence} disabled={saving || !seqName.trim()} style={{ padding: '12px 20px' }}>
          {saving ? 'Creating…' : 'Create Sequence →'}
        </button>
      </div>
    )
  }

  // ── Sequence Editor ───────────────────────────────────────────────────────
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => { setView('list'); setSelectedSeq(null); loadSequences() }}>← Back</button>
        <div style={{ flex: 1 }}>
          <input value={seqName} onChange={e => setSeqName(e.target.value)}
            style={{ fontSize: 18, fontWeight: 700, background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none', width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={seqStatus} onChange={e => setSeqStatus(e.target.value)} className="input" style={{ padding: '6px 10px', fontSize: 12, width: 'auto' }}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
          <button className="btn-primary" onClick={saveSequenceMeta} disabled={saving} style={{ padding: '7px 16px', fontSize: 12 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Trigger info */}
      <div style={{ background: 'rgba(88,166,255,.06)', border: '1px solid rgba(88,166,255,.15)', borderRadius: 10, padding: '10px 16px', fontSize: 12, color: 'var(--muted)' }}>
        Trigger: <strong style={{ color: 'var(--text)' }}>{TRIGGER_TYPES.find(t => t.id === seqTrigger)?.label}</strong>
        {seqTriggerTag && <> · Tag: <strong style={{ color: 'var(--text)' }}>{seqTriggerTag}</strong></>}
      </div>

      {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

      {/* Steps timeline */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>STEPS ({steps.length})</label>
          <button className="btn-ghost" onClick={() => setEditingStep({ step: { step_number: steps.length + 1 }, index: steps.length })} style={{ padding: '5px 12px', fontSize: 12 }}>+ Add Step</button>
        </div>

        <div style={{ display: 'grid', gap: 0 }}>
          {steps.map((step, i) => (
            <div key={step.id || i} style={{ display: 'flex', gap: 0 }}>
              {/* Timeline connector */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginRight: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: step.is_active ? 'var(--accent)' : 'var(--border)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                {i < steps.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--border)', minHeight: 24, margin: '4px 0' }} />}
              </div>
              {/* Step card */}
              <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 8, opacity: step.is_active ? 1 : .5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', marginRight: 8 }}>
                      {i === 0 ? 'DAY 0 — SENDS IMMEDIATELY' : `DAY +${step.delay_days}`}
                    </span>
                    {!step.is_active && <span style={{ fontSize: 10, color: '#e3b341', fontWeight: 700 }}>INACTIVE</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-ghost" onClick={() => setEditingStep({ step, index: i })} style={{ padding: '3px 10px', fontSize: 11 }}>Edit</button>
                    <button onClick={() => step.id && deleteStep(step.id)} style={{ padding: '3px 8px', fontSize: 11, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: '#f85149', cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{step.subject || '(no subject)'}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {step.body_html ? `${step.body_html.replace(/<[^>]+>/g, '').slice(0, 80)}…` : 'No content yet — click Edit'}
                </div>
              </div>
            </div>
          ))}

          {steps.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', border: '2px dashed var(--border)', borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>No steps yet. Add your first email.</div>
              <button className="btn-ghost" onClick={() => setEditingStep({ step: { step_number: 1 }, index: 0 })} style={{ padding: '8px 16px', fontSize: 12 }}>+ Add First Step</button>
            </div>
          )}

          {steps.length > 0 && (
            <button onClick={() => setEditingStep({ step: { step_number: steps.length + 1 }, index: steps.length })}
              style={{ marginLeft: 48, padding: '8px 16px', fontSize: 12, background: 'transparent', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer' }}>
              + Add Next Step
            </button>
          )}
        </div>
      </div>

      {editingStep && (
        <StepEditor
          step={editingStep.step}
          stepIndex={editingStep.index}
          onSave={saveStep}
          onClose={() => setEditingStep(null)}
          generating={saving}
        />
      )}
    </div>
  )
}
