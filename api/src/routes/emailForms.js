import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { requireAuth, attachOrg } from '../middleware/auth.js'
import { supabase } from '../db/supabase.js'

const router = Router()

// ── Helpers ────────────────────────────────────────────────────────────────────

const formSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 submits per IP per form per window
  keyGenerator: (req) => `${req.params.id}:${ipKeyGenerator(req)}`,
  message: { error: 'Too many submissions. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
})

function validateSubmission({ email, first_name, last_name } = {}, { requireFirstName = false } = {}) {
  const errors = {}
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!email || typeof email !== 'string' || !emailRe.test(email)) {
    errors.email = 'Valid email required'
  }

  if (requireFirstName) {
    if (typeof first_name !== 'string' || first_name.trim().length < 1) {
      errors.first_name = 'First name required'
    }
  } else if (first_name !== undefined && first_name !== null) {
    if (typeof first_name !== 'string') errors.first_name = 'First name must be a string'
  }

  if (typeof first_name === 'string') {
    if (first_name.length > 100) errors.first_name = 'First name too long'
    if (/<|>/.test(first_name)) errors.first_name = 'Invalid characters'
  }

  if (last_name !== undefined && last_name !== null && typeof last_name !== 'string') {
    errors.last_name = 'Last name must be a string'
  }
  if (typeof last_name === 'string' && last_name.length > 100) {
    errors.last_name = 'Last name too long'
  }

  return Object.keys(errors).length ? errors : null
}

function escHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildEmbedHtml(form, submitUrl) {
  const {
    headline       = 'Subscribe to our newsletter',
    description    = '',
    button_text    = 'Subscribe Now',
    success_message = "You're in! Check your inbox.",
    collect_name   = true,
    primary_color  = '#58a6ff',
    bg_color       = '#ffffff',
    text_color     = '#111827',
    border_radius  = 8,
    custom_css     = '',
    redirect_url   = '',
  } = form

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;padding:0}
.wrap{background:${bg_color};padding:28px 28px 24px;border-radius:${border_radius}px}
h2{color:${text_color};font-size:20px;font-weight:700;margin-bottom:6px;line-height:1.3}
.desc{color:${text_color};opacity:.6;font-size:14px;margin-bottom:20px;line-height:1.5}
.field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
label{font-size:12px;font-weight:600;color:${text_color};opacity:.7;letter-spacing:.04em}
input{width:100%;padding:10px 14px;border:1.5px solid rgba(0,0,0,.12);border-radius:6px;font-size:14px;color:${text_color};background:#fff;outline:none;transition:border-color .2s}
input:focus{border-color:${primary_color};box-shadow:0 0 0 3px ${primary_color}22}
button{width:100%;padding:12px 16px;background:${primary_color};color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px;transition:opacity .2s;letter-spacing:.01em}
button:hover{opacity:.88}
button:disabled{opacity:.5;cursor:default}
.success{text-align:center;padding:24px 0;font-size:16px;font-weight:600;color:${primary_color}}
.check{font-size:38px;display:block;margin-bottom:10px}
.err{color:#dc2626;font-size:12px;margin-top:6px;display:none}
${custom_css}
</style>
</head>
<body>
<div class="wrap">
  <h2>${escHtml(headline)}</h2>
  ${description ? `<div class="desc">${escHtml(description)}</div>` : ''}
  <form id="f">
    ${collect_name ? `<div class="field"><label>First Name</label><input type="text" name="first_name" placeholder="Your first name" autocomplete="given-name"/></div>` : ''}
    <div class="field"><label>Email Address</label><input type="email" name="email" placeholder="you@example.com" required autocomplete="email"/></div>
    <div id="err" class="err"></div>
    <button type="submit" id="btn">${escHtml(button_text)}</button>
  </form>
  <div id="ok" class="success" style="display:none">
    <span class="check">✓</span>${escHtml(success_message)}
  </div>
</div>
<script>
document.getElementById('f').onsubmit=async function(e){
  e.preventDefault();
  var btn=document.getElementById('btn'),err=document.getElementById('err');
  btn.disabled=true;btn.textContent='Sending…';err.style.display='none';
  var fd=new FormData(e.target);
  try{
    var r=await fetch(${JSON.stringify(submitUrl)},{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:fd.get('email'),first_name:fd.get('first_name')||''})
    });
    var j=await r.json();
    if(j.ok){
      document.getElementById('f').style.display='none';
      document.getElementById('ok').style.display='block';
      ${redirect_url ? `setTimeout(function(){window.parent.location.href=${JSON.stringify(redirect_url)};},1800);` : ''}
    }else{
      err.textContent=j.error||'Something went wrong. Please try again.';
      err.style.display='block';
      btn.disabled=false;btn.textContent=${JSON.stringify(button_text)};
    }
  }catch(ex){
    err.textContent='Connection error. Please try again.';
    err.style.display='block';
    btn.disabled=false;btn.textContent=${JSON.stringify(button_text)};
  }
};
</script>
</body>
</html>`
}

// ── Public routes (no auth) ────────────────────────────────────────────────────

// Serve embed as standalone iframe-able HTML page
router.get('/:id/embed', async (req, res) => {
  try {
    let form = null
    if (supabase) {
      const { data } = await supabase
        .from('email_forms')
        .select('*')
        .eq('id', req.params.id)
        .eq('is_active', true)
        .single()
      form = data
    }
    if (!form) return res.status(404).send('<p style="font-family:sans-serif;color:#666;padding:20px">Form not found or inactive.</p>')

    const base = `${req.protocol}://${req.get('host')}`
    const html = buildEmbedHtml(form, `${base}/saas/email-forms/${form.id}/submit`)

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Frame-Options', 'ALLOWALL')
    res.setHeader('Content-Security-Policy', "frame-ancestors *")
    res.send(html)
  } catch (err) {
    res.status(500).send('<p>Error loading form</p>')
  }
})

// Serve embed as JS snippet that auto-creates an iframe
router.get('/:id/embed.js', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`
  const embedUrl = `${base}/saas/email-forms/${req.params.id}/embed`
  const js = `(function(){var i=document.createElement('iframe');i.src=${JSON.stringify(embedUrl)};i.width='100%';i.height='460';i.frameBorder='0';i.style='border:none;max-width:600px;display:block;width:100%';document.currentScript.parentNode.insertBefore(i,document.currentScript);})()`
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.send(js)
})

// Handle form submission — wide CORS so external pages can POST
router.options('/:id/submit', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(204)
})

router.post('/:id/submit', formSubmitLimiter, async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    // Honeypot for basic bot filtering (silent accept).
    if (req.body?._hp_field) return res.status(200).json({ ok: true })

    if (!supabase) {
      // Dev mode — no DB, just acknowledge
      return res.json({ ok: true })
    }

    const { email, first_name, last_name } = req.body || {}

    const { data: form } = await supabase
      .from('email_forms')
      .select('*')
      .eq('id', req.params.id)
      .eq('is_active', true)
      .single()

    if (!form) return res.json({ ok: false, error: 'This form is no longer active.' })

    const errs = validateSubmission(
      { email, first_name, last_name },
      { requireFirstName: Boolean(form.collect_name) },
    )
    if (errs) return res.status(400).json({ errors: errs })

    // Upsert subscriber
    const { data: sub } = await supabase
      .from('email_subscribers')
      .upsert({
        org_id:     form.org_id,
        email:      email.toLowerCase().trim(),
        first_name: String(first_name || '').trim(),
        last_name:  String(last_name || '').trim(),
        status:     'active',
        source:     `form:${form.id}`,
      }, { onConflict: 'org_id,email' })
      .select()
      .single()

    // Enroll in sequence if one is set
    if (sub?.id && form.sequence_id) {
      try {
        const { enrollSubscriber } = await import('../services/emailScheduler.js')
        await enrollSubscriber({ orgId: form.org_id, subscriberId: sub.id, sequenceId: form.sequence_id })
      } catch { /* ignore duplicate enrollment errors */ }
    }

    // Increment counter
    await supabase
      .from('email_forms')
      .update({ submission_count: (form.submission_count || 0) + 1, updated_at: new Date() })
      .eq('id', form.id)

    res.json({ ok: true, redirect_url: form.redirect_url || null })
  } catch (err) {
    console.error('[emailForms submit]', err)
    res.json({ ok: false, error: 'Submission failed. Please try again.' })
  }
})

// ── Auth-required routes ───────────────────────────────────────────────────────

router.use(requireAuth, attachOrg)

// List forms
router.get('/', async (req, res) => {
  if (!supabase) return res.json({ ok: true, forms: [] })
  const { data } = await supabase
    .from('email_forms')
    .select('*, email_sequences(name)')
    .eq('org_id', req.org.id)
    .order('created_at', { ascending: false })
  res.json({ ok: true, forms: data || [] })
})

// Create form
router.post('/', async (req, res) => {
  if (!supabase) return res.json({ ok: true, form: { id: 'stub', ...req.body } })
  const { data, error } = await supabase
    .from('email_forms')
    .insert({ ...req.body, org_id: req.org.id, submission_count: 0 })
    .select()
    .single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true, form: data })
})

// Update form
router.patch('/:id', async (req, res) => {
  if (!supabase) return res.json({ ok: true, form: req.body })
  const { data, error } = await supabase
    .from('email_forms')
    .update({ ...req.body, updated_at: new Date() })
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .select()
    .single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true, form: data })
})

// Delete form
router.delete('/:id', async (req, res) => {
  if (!supabase) return res.json({ ok: true })
  await supabase.from('email_forms').delete().eq('id', req.params.id).eq('org_id', req.org.id)
  res.json({ ok: true })
})

export default router
