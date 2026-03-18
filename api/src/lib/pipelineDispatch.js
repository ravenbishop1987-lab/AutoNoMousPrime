const normalizeBaseUrl = (value, fallback) => {
  const raw = String(value || fallback || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  return raw.includes('://') ? raw : `http://${raw}`
}

export const PYTHON_API = normalizeBaseUrl(process.env.PYTHON_API_URL, 'http://localhost:8000')
export const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN || 'autonomous-prime-internal'

export async function dispatchRun({ job, run, topic, keywords, aspect_ratio, workspace_id, brand_id, input_payload = {} }) {
  const payload = {
    topic,
    keywords,
    aspect_ratio,
    job_id: job.id,
    job_run_id: run.id,
    workspace_id,
    input_payload,
  }

  if (brand_id) {
    payload.brand_id = brand_id
  }

  const response = await fetch(`${PYTHON_API}/api/internal/pipeline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': INTERNAL_TOKEN,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Python dispatch failed: ${response.status}`)
  }

  return response.json()
}

export async function cancelRun(job) {
  if (!job?.id) return { ok: false, detail: 'Missing job id' }
  try {
    const response = await fetch(`${PYTHON_API}/api/internal/jobs/${job.id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        job_id: job.id,
        workspace_id: job.org_id,
        brand_id: job.brand_id,
      }),
    })
    return response.ok ? response.json() : { ok: false, detail: await response.text() }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Cancel request failed' }
  }
}

export async function dispatchTask({ type, payload, agent_hint = null }) {
  const response = await fetch(`${PYTHON_API}/api/internal/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': INTERNAL_TOKEN,
    },
    body: JSON.stringify({
      type,
      payload,
      priority: 2,
      agent_hint,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Python task dispatch failed: ${response.status}`)
  }

  return response.json()
}
