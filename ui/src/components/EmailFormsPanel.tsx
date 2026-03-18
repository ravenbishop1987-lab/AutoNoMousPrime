import { useState, useEffect, useCallback } from 'react'
import { getEmailForms, createEmailForm, updateEmailForm, deleteEmailForm, type EmailForm } from '../api'
import { saas } from '../api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Sequence { id: string; name: string }

interface Draft {
  id?: string
  name: string
  headline: string
  description: string
  button_text: string
  success_message: string
  collect_name: boolean
  sequence_id: string
  redirect_url: string
  primary_color: string
  bg_color: string
  text_color: string
  border_radius: number
  custom_css: string
  is_active: boolean
}

const DEFAULT_DRAFT: Draft = {
  name:            'New Form',
  headline:        'Subscribe to our newsletter',
  description:     'Get the latest updates delivered straight to your inbox.',
  button_text:     'Subscribe Now',
  success_message: "You're in! Check your inbox for a confirmation.",
  collect_name:    true,
  sequence_id:     '',
  redirect_url:    '',
  primary_color:   '#58a6ff',
  bg_color:        '#ffffff',
  text_color:      '#111827',
  border_radius:   8,
  custom_css:      '',
  is_active:       true,
}

// ── Preview HTML builder (mirrors server-side buildEmbedHtml) ──────────────────

function buildPreviewHtml(d: Draft, isPreviewMode = true) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;padding:0}
.wrap{background:${d.bg_color};padding:28px 28px 24px;border-radius:${d.border_radius}px}
h2{color:${d.text_color};font-size:20px;font-weight:700;margin-bottom:6px;line-height:1.3}
.desc{color:${d.text_color};opacity:.6;font-size:14px;margin-bottom:20px;line-height:1.5}
.field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
label{font-size:12px;font-weight:600;color:${d.text_color};opacity:.7;letter-spacing:.04em}
input{width:100%;padding:10px 14px;border:1.5px solid rgba(0,0,0,.12);border-radius:6px;font-size:14px;color:${d.text_color};background:#fff;outline:none}
input:focus{border-color:${d.primary_color};box-shadow:0 0 0 3px ${d.primary_color}22}
button{width:100%;padding:12px 16px;background:${d.primary_color};color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:700;cursor:${isPreviewMode ? 'default' : 'pointer'};margin-top:4px;letter-spacing:.01em}
.preview-badge{position:fixed;bottom:8px;right:8px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;padding:3px 8px;border-radius:99px;font-family:sans-serif}
${d.custom_css}
</style></head>
<body>
<div class="wrap">
  <h2>${esc(d.headline)}</h2>
  ${d.description ? `<div class="desc">${esc(d.description)}</div>` : ''}
  <form onsubmit="return false">
    ${d.collect_name ? `<div class="field"><label>First Name</label><input type="text" placeholder="Your first name" /></div>` : ''}
    <div class="field"><label>Email Address</label><input type="email" placeholder="you@example.com" /></div>
    <button type="button">${esc(d.button_text)}</button>
  </form>
</div>
${isPreviewMode ? '<div class="preview-badge">Preview</div>' : ''}
</body></html>`
}

// ── Shared components ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>{label}</label>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder = '', type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', width: '100%' }}
    />
  )
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      style={{ padding: '5px 14px', fontSize: 11, fontWeight: 700, borderRadius: 7, border: '1px solid var(--border)', background: copied ? 'rgba(63,185,80,.12)' : 'transparent', color: copied ? '#3fb950' : 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 11, color: '#8b949e', overflowX: 'auto', lineHeight: 1.6, margin: 0 }}>
        <code>{code}</code>
      </pre>
      <div style={{ position: 'absolute', top: 8, right: 8 }}>
        <CopyButton text={code} />
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function EmailFormsPanel() {
  const [forms, setForms]         = useState<EmailForm[]>([])
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [view, setView]           = useState<'list' | 'editor'>('list')
  const [draft, setDraft]         = useState<Draft>(DEFAULT_DRAFT)
  const [saving, setSaving]       = useState(false)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [embedTab, setEmbedTab]   = useState<'iframe' | 'script'>('iframe')
  const [previewTab, setPreviewTab] = useState<'preview' | 'embed'>('preview')

  const loadForms = useCallback(async () => {
    try {
      const r = await getEmailForms()
      setForms(r.forms || [])
    } catch { /* no DB yet */ }
  }, [])

  useEffect(() => {
    loadForms()
    saas.get('/email-sequences').then((r: any) => setSequences(r.data?.sequences || [])).catch(() => {})
  }, [loadForms])

  const set = (key: keyof Draft) => (val: unknown) => setDraft(d => ({ ...d, [key]: val }))

  const openNew = () => {
    setDraft(DEFAULT_DRAFT)
    setView('editor')
  }

  const openEdit = (f: EmailForm) => {
    setDraft({
      id:              f.id,
      name:            f.name,
      headline:        f.headline,
      description:     f.description,
      button_text:     f.button_text,
      success_message: f.success_message,
      collect_name:    f.collect_name,
      sequence_id:     f.sequence_id || '',
      redirect_url:    f.redirect_url || '',
      primary_color:   f.primary_color,
      bg_color:        f.bg_color,
      text_color:      f.text_color,
      border_radius:   f.border_radius,
      custom_css:      f.custom_css || '',
      is_active:       f.is_active,
    })
    setView('editor')
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = { ...draft, sequence_id: draft.sequence_id || null }
      if (draft.id) {
        const r = await updateEmailForm(draft.id, payload)
        setForms(fs => fs.map(f => f.id === draft.id ? r.form : f))
        setDraft(d => ({ ...d, id: r.form.id }))
      } else {
        const r = await createEmailForm(payload)
        setForms(fs => [r.form, ...fs])
        setDraft(d => ({ ...d, id: r.form.id }))
      }
    } catch { /* show error */ }
    setSaving(false)
  }

  const del = async (id: string) => {
    if (!confirm('Delete this form? Embed codes using it will stop working.')) return
    setDeleting(id)
    await deleteEmailForm(id).catch(() => {})
    setForms(fs => fs.filter(f => f.id !== id))
    setDeleting(null)
  }

  // Embed code generation
  const embedBase = `${window.location.origin}/saas/email-forms`
  const iframeCode = draft.id
    ? `<iframe\n  src="${embedBase}/${draft.id}/embed"\n  width="100%"\n  height="460"\n  frameborder="0"\n  style="border:none;max-width:600px;display:block;"\n></iframe>`
    : ''
  const scriptCode = draft.id
    ? `<script src="${embedBase}/${draft.id}/embed.js"></script>`
    : ''

  // ── List view ────────────────────────────────────────────────────────────────

  if (view === 'list') {
    return (
      <div style={{ display: 'grid', gap: 20, maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Capture Forms</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>Embeddable forms for your landing pages, sales pages, and websites</div>
          </div>
          <button className="btn-primary" onClick={openNew} style={{ padding: '8px 18px', fontSize: 13 }}>+ New Form</button>
        </div>

        {forms.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14 }}>
            <div style={{ fontSize: 42, marginBottom: 14 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No capture forms yet</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 380, margin: '0 auto 20px' }}>
              Build an embeddable form in minutes. Drop it on any landing page, sales page, or website — subscribers go straight into your sequences.
            </div>
            <button className="btn-primary" onClick={openNew} style={{ padding: '9px 22px', fontSize: 13 }}>Create your first form</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {forms.map(f => (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center', padding: '16px 20px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{f.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: f.is_active ? 'rgba(63,185,80,.12)' : 'rgba(248,81,73,.12)', color: f.is_active ? '#3fb950' : '#f85149', letterSpacing: '.04em' }}>
                      {f.is_active ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {f.headline} &nbsp;·&nbsp; {f.submission_count} signups
                    {f.email_sequences?.name && ` · enrolled → ${f.email_sequences.name}`}
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                    <CopyButton text={`<iframe src="${embedBase}/${f.id}/embed" width="100%" height="460" frameborder="0" style="border:none;max-width:600px;display:block;"></iframe>`} label="Copy iframe" />
                    <CopyButton text={`<script src="${embedBase}/${f.id}/embed.js"></script>`} label="Copy script" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openEdit(f)} className="btn-ghost" style={{ padding: '7px 16px', fontSize: 12 }}>Edit</button>
                  <button onClick={() => del(f.id)} disabled={deleting === f.id} className="btn-ghost" style={{ padding: '7px 12px', fontSize: 12, color: '#f85149', borderColor: 'rgba(248,81,73,.3)' }}>
                    {deleting === f.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Editor view ──────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'grid', gap: 0, maxWidth: 1160 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => setView('list')} className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }}>← Back</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, flex: 1 }}>{draft.id ? `Edit: ${draft.name}` : 'New Capture Form'}</h2>
        <button onClick={save} disabled={saving} className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }}>
          {saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Create Form'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20, alignItems: 'start' }}>

        {/* ── Left: settings ── */}
        <div style={{ display: 'grid', gap: 16 }}>

          {/* Basic info */}
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '18px 20px', display: 'grid', gap: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>FORM SETTINGS</div>
            <Field label="INTERNAL NAME">
              <TextInput value={draft.name} onChange={set('name')} placeholder="e.g. Homepage Signup" />
            </Field>
            <Field label="HEADLINE">
              <TextInput value={draft.headline} onChange={set('headline')} placeholder="Subscribe to our newsletter" />
            </Field>
            <Field label="DESCRIPTION">
              <textarea
                value={draft.description}
                onChange={e => set('description')(e.target.value)}
                placeholder="Short tagline under the headline (optional)"
                rows={2}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', resize: 'vertical', width: '100%' }}
              />
            </Field>
            <Field label="BUTTON TEXT">
              <TextInput value={draft.button_text} onChange={set('button_text')} placeholder="Subscribe Now" />
            </Field>
            <Field label="SUCCESS MESSAGE">
              <TextInput value={draft.success_message} onChange={set('success_message')} placeholder="You're in!" />
            </Field>
            <Field label="REDIRECT AFTER SUBMIT (optional)">
              <TextInput value={draft.redirect_url} onChange={set('redirect_url')} placeholder="https://your-site.com/thank-you" type="url" />
            </Field>
          </div>

          {/* Fields */}
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '18px 20px', display: 'grid', gap: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>FORM FIELDS</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={draft.collect_name} onChange={e => set('collect_name')(e.target.checked)} />
              <span style={{ fontSize: 13 }}>Collect first name</span>
            </label>
          </div>

          {/* Enrollment */}
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '18px 20px', display: 'grid', gap: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>AUTO-ENROLL IN SEQUENCE</div>
            <Field label="SEQUENCE (optional)">
              <select
                value={draft.sequence_id}
                onChange={e => set('sequence_id')(e.target.value)}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', width: '100%' }}
              >
                <option value="">— None —</option>
                {sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              When someone submits this form, they'll be added as a subscriber and automatically enrolled in the selected sequence.
            </div>
          </div>

          {/* Appearance */}
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '18px 20px', display: 'grid', gap: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>APPEARANCE</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {[
                { label: 'Accent Color', key: 'primary_color' as keyof Draft },
                { label: 'Background',  key: 'bg_color'      as keyof Draft },
                { label: 'Text Color',  key: 'text_color'    as keyof Draft },
              ].map(c => (
                <Field key={c.key} label={c.label}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="color" value={draft[c.key] as string} onChange={e => set(c.key)(e.target.value)} style={{ width: 32, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 0 }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{draft[c.key] as string}</span>
                  </div>
                </Field>
              ))}
            </div>
            <Field label={`BORDER RADIUS — ${draft.border_radius}px`}>
              <input type="range" min={0} max={24} value={draft.border_radius} onChange={e => set('border_radius')(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </Field>
            <Field label="CUSTOM CSS (optional)">
              <textarea
                value={draft.custom_css}
                onChange={e => set('custom_css')(e.target.value)}
                placeholder=".wrap { box-shadow: 0 4px 24px rgba(0,0,0,.1); }"
                rows={3}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'var(--text)', resize: 'vertical', width: '100%', fontFamily: 'monospace' }}
              />
            </Field>
          </div>

          {/* Status */}
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '16px 20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div style={{ position: 'relative', width: 38, height: 20, flexShrink: 0 }}>
                <input type="checkbox" checked={draft.is_active} onChange={e => set('is_active')(e.target.checked)} style={{ opacity: 0, position: 'absolute', inset: 0, margin: 0, cursor: 'pointer', width: '100%', height: '100%', zIndex: 1 }} />
                <div style={{ position: 'absolute', inset: 0, borderRadius: 99, background: draft.is_active ? 'var(--accent)' : 'var(--border)', transition: 'background .2s' }} />
                <div style={{ position: 'absolute', top: 2, left: draft.is_active ? 20 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Form active</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Paused forms reject submissions</div>
              </div>
            </label>
          </div>
        </div>

        {/* ── Right: preview + embed codes ── */}
        <div style={{ display: 'grid', gap: 16, position: 'sticky', top: 20 }}>
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 4, padding: '4px', background: 'rgba(255,255,255,.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', width: 'fit-content' }}>
            {(['preview', 'embed'] as const).map(t => (
              <button key={t} onClick={() => setPreviewTab(t)} style={{ padding: '6px 18px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none', background: previewTab === t ? 'rgba(88,166,255,.15)' : 'transparent', color: previewTab === t ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', letterSpacing: '.04em', textTransform: 'capitalize' }}>
                {t === 'preview' ? 'Live Preview' : 'Embed Code'}
              </button>
            ))}
          </div>

          {previewTab === 'preview' && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, overflow: 'hidden' }}>
              {/* Mock browser chrome */}
              <div style={{ background: 'rgba(255,255,255,.04)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  {['#f85149', '#e3b341', '#3fb950'].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />)}
                </div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,.06)', borderRadius: 6, padding: '4px 12px', fontSize: 11, color: 'var(--muted)' }}>
                  {window.location.origin}/saas/email-forms/{draft.id || '‹form-id›'}/embed
                </div>
              </div>
              <div style={{ background: '#f3f4f6', padding: 24 }}>
                <iframe
                  key={JSON.stringify(draft)}
                  srcDoc={buildPreviewHtml(draft)}
                  style={{ width: '100%', height: 360, border: 'none', borderRadius: 8, display: 'block' }}
                  title="Form preview"
                  sandbox="allow-forms allow-scripts"
                />
              </div>
            </div>
          )}

          {previewTab === 'embed' && (
            <div style={{ display: 'grid', gap: 16 }}>
              {!draft.id && (
                <div style={{ padding: '14px 16px', background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.25)', borderRadius: 10, fontSize: 12, color: '#e3b341' }}>
                  Save the form first to generate your embed code.
                </div>
              )}

              {/* Embed type tabs */}
              <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.04)', borderRadius: 8, padding: 4, border: '1px solid rgba(255,255,255,.08)', width: 'fit-content' }}>
                {(['iframe', 'script'] as const).map(t => (
                  <button key={t} onClick={() => setEmbedTab(t)} style={{ padding: '5px 14px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: 'none', background: embedTab === t ? 'rgba(88,166,255,.15)' : 'transparent', color: embedTab === t ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer' }}>
                    {t === 'iframe' ? 'iframe embed' : '<script> tag'}
                  </button>
                ))}
              </div>

              {embedTab === 'iframe' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>iframe Embed</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Paste this anywhere in your HTML — landing pages, sales pages, Webflow, Squarespace, Notion, or any custom site.
                  </div>
                  <CodeBlock code={draft.id ? iframeCode : '<iframe src="…/embed" width="100%" height="460" frameborder="0" style="border:none;max-width:600px;display:block;"></iframe>'} />
                </div>
              )}

              {embedTab === 'script' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Script Tag Embed</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Drop this single line wherever you want the form to appear. It automatically creates a responsive iframe inline.
                  </div>
                  <CodeBlock code={draft.id ? scriptCode : '<script src="…/embed.js"></script>'} />
                </div>
              )}

              {/* Usage tips */}
              <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '16px 18px', display: 'grid', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>WHERE TO USE THIS FORM</div>
                {[
                  ['Landing pages', 'Paste iframe in your hero or below the fold'],
                  ['Sales pages', 'Add above your pricing section to capture interest'],
                  ['Blog posts', 'Drop at the bottom of any article for subscribers'],
                  ['Webflow / Framer', 'Use an Embed component and paste the iframe code'],
                  ['Squarespace / Wix', 'Use a Code Block and paste the iframe code'],
                  ['WordPress', 'Use an HTML block or a Custom HTML widget'],
                ].map(([place, tip]) => (
                  <div key={place} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>{place}</span>
                    <span style={{ color: 'var(--muted)' }}>{tip}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
