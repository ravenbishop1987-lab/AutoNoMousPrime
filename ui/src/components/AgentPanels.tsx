import { useState } from 'react'

import AgentWorkbench from './AgentWorkbench'
import { submitSlidePipeline, submitTask, uploadSlideMedia } from '../api'

function ResultCard({ result }: { result: string | null }) {
  if (!result) return null
  return (
    <div
      className="card"
      style={{ background: result.toLowerCase().includes('error') ? 'rgba(248,81,73,.08)' : 'rgba(63,185,80,.08)' }}
    >
      {result}
    </div>
  )
}

export function ContentAgentPanel() {
  const [topic, setTopic] = useState('')
  const [keywords, setKeywords] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const queue = async (type: 'blog_post' | 'seo_research') => {
    if (!topic.trim()) return
    try {
      const payload = {
        topic: topic.trim(),
        keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
      }
      await submitTask(type, payload, 'content_agent')
      setResult(`${type} queued for "${topic.trim()}"`)
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    }
  }

  return (
    <AgentWorkbench
      agentId="content_agent"
      title="Content Agent"
      description="Write blog posts and run SEO research from a dedicated content workspace."
    >
      <div className="card">
        <label>Topic</label>
        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="ADHD burnout in adults" style={{ marginBottom: 10 }} />
        <label>Keywords</label>
        <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="adhd burnout, adult adhd, recovery" style={{ marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-primary" onClick={() => queue('blog_post')} disabled={!topic.trim()}>Generate Blog Post</button>
          <button className="btn-ghost" onClick={() => queue('seo_research')} disabled={!topic.trim()}>Run SEO Research</button>
        </div>
      </div>
      <ResultCard result={result} />
    </AgentWorkbench>
  )
}

export function ImageAgentPanel() {
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState('professional editorial')
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [result, setResult] = useState<string | null>(null)

  const queue = async () => {
    if (!prompt.trim()) return
    try {
      await submitTask('image_gen', { topic: prompt.trim(), prompt: prompt.trim(), style, aspect_ratio: aspectRatio }, 'image_agent')
      setResult(`image_gen queued for "${prompt.trim()}"`)
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    }
  }

  return (
    <AgentWorkbench
      agentId="image_agent"
      title="Image Agent"
      description="Generate standalone images with a full visual prompt, style, and aspect ratio."
    >
      <div className="card">
        <label>Visual Prompt</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={5} placeholder="A dog sitting on a chair in a cozy living room" style={{ marginBottom: 10 }} />
        <div className="two-col-grid">
          <div>
            <label>Style</label>
            <input value={style} onChange={e => setStyle(e.target.value)} placeholder="professional editorial" />
          </div>
          <div>
            <label>Aspect Ratio</label>
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </div>
        </div>
        <button className="btn-primary" onClick={queue} disabled={!prompt.trim()} style={{ marginTop: 14 }}>Generate Image</button>
      </div>
      <ResultCard result={result} />
    </AgentWorkbench>
  )
}

export function VoiceAgentPanel() {
  const [topic, setTopic] = useState('')
  const [text, setText] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const queue = async () => {
    if (!topic.trim() && !text.trim()) return
    try {
      await submitTask('tts', { topic: topic.trim() || 'custom-audio', text: text.trim() }, 'voice_agent')
      setResult(`tts queued for "${topic.trim() || 'custom-audio'}"`)
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    }
  }

  return (
    <AgentWorkbench
      agentId="voice_agent"
      title="Voice Agent"
      description="Create narrated audio from a topic or from custom pasted text."
    >
      <div className="card">
        <label>Topic</label>
        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="ADHD motivation tips" style={{ marginBottom: 10 }} />
        <label>Text To Narrate</label>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={8} placeholder="Paste the full narration here..." />
        <button className="btn-primary" onClick={queue} disabled={!topic.trim() && !text.trim()} style={{ marginTop: 14 }}>Generate Audio</button>
      </div>
      <ResultCard result={result} />
    </AgentWorkbench>
  )
}

export function VideoAgentPanel() {
  const [topic, setTopic] = useState('Custom slide video')
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [slides, setSlides] = useState([
    { title: 'Slide 1', image_prompt: '', negative_prompt: '', image_path: '', voiceover_text: '', audio_path: '', caption: '', pause_after_s: 1 },
  ])
  const [result, setResult] = useState<string | null>(null)
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)

  const updateSlide = (index: number, key: string, value: string | number) => {
    setSlides(current => current.map((slide, slideIndex) => (
      slideIndex === index ? { ...slide, [key]: value } : slide
    )))
  }

  const addSlide = () => {
    setSlides(current => [
      ...current,
      { title: `Slide ${current.length + 1}`, image_prompt: '', negative_prompt: '', image_path: '', voiceover_text: '', audio_path: '', caption: '', pause_after_s: 1 },
    ])
  }

  const removeSlide = (index: number) => {
    setSlides(current => current.length === 1 ? current : current.filter((_, slideIndex) => slideIndex !== index))
  }

  const queue = async () => {
    const cleanSlides = slides.map((slide, index) => ({
      title: slide.title.trim() || `Slide ${index + 1}`,
      image_prompt: slide.image_prompt.trim(),
      negative_prompt: slide.negative_prompt.trim(),
      image_path: slide.image_path.trim(),
      voiceover_text: slide.voiceover_text.trim(),
      audio_path: slide.audio_path.trim(),
      caption: slide.caption.trim(),
      pause_after_s: Number(slide.pause_after_s) || 0,
    }))

    if (!cleanSlides.every(slide => (slide.image_prompt || slide.image_path) && (slide.voiceover_text || slide.audio_path))) {
      setResult('Error: each slide needs an image prompt or image file, and either voiceover text or an audio file.')
      return
    }

    try {
      await submitSlidePipeline(topic.trim() || 'Custom slide video', cleanSlides, aspectRatio)
      setResult(`Slide video queued with ${cleanSlides.length} slide${cleanSlides.length === 1 ? '' : 's'}.`)
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    }
  }

  const attachFile = async (index: number, mediaKind: 'image' | 'audio', file: File | null) => {
    if (!file) return
    const key = `${mediaKind}-${index}`
    setUploadingKey(key)
    try {
      const uploaded = await uploadSlideMedia(file, index + 1, mediaKind)
      updateSlide(index, mediaKind === 'image' ? 'image_path' : 'audio_path', uploaded.path)
      setResult(`${uploaded.filename} attached to slide ${index + 1}.`)
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    } finally {
      setUploadingKey(null)
    }
  }

  return (
    <AgentWorkbench
      agentId="video_agent"
      title="Slide Editor"
      description="Build a synced slide video by defining each slide's image prompt and voiceover source."
    >
      <div className="card">
        <label>Video Title</label>
        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="The Man Who Collected Storms" style={{ marginBottom: 10 }} />
        <label>Aspect Ratio</label>
        <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} style={{ marginBottom: 16 }}>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
        </select>

        <div style={{ display: 'grid', gap: 14 }}>
          {slides.map((slide, index) => (
            <div key={`${index}-${slide.title}`} className="card" style={{ background: 'rgba(255,255,255,.02)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong>{`Slide ${index + 1}`}</strong>
                <button className="btn-ghost" onClick={() => removeSlide(index)} disabled={slides.length === 1}>Remove</button>
              </div>
              <label>Slide Title</label>
              <input value={slide.title} onChange={e => updateSlide(index, 'title', e.target.value)} placeholder={`Slide ${index + 1}`} style={{ marginBottom: 10 }} />
              <label>Image Prompt</label>
              <textarea value={slide.image_prompt} onChange={e => updateSlide(index, 'image_prompt', e.target.value)} rows={4} placeholder="Describe the exact image to generate for this slide..." style={{ marginBottom: 10 }} />
              <label>Negative Prompt</label>
              <textarea value={slide.negative_prompt} onChange={e => updateSlide(index, 'negative_prompt', e.target.value)} rows={3} placeholder="Optional things to avoid, like blurry, extra fingers, text, watermark..." style={{ marginBottom: 10 }} />
              <label>Image File</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={e => attachFile(index, 'image', e.target.files?.[0] || null)} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{slide.image_path || 'No image file attached'}</span>
              </div>
              <label>Voiceover File</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <input type="file" accept=".wav,.mp3,.m4a" onChange={e => attachFile(index, 'audio', e.target.files?.[0] || null)} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{slide.audio_path || 'No audio file attached'}</span>
              </div>
              <label>Voiceover Text</label>
              <textarea value={slide.voiceover_text} onChange={e => updateSlide(index, 'voiceover_text', e.target.value)} rows={4} placeholder="Optional fallback if you want the system to generate narration audio..." style={{ marginBottom: 10 }} />
              <label>Caption</label>
              <input value={slide.caption} onChange={e => updateSlide(index, 'caption', e.target.value)} placeholder="Optional caption/metadata text" style={{ marginBottom: 10 }} />
              <label>Pause After Slide (seconds)</label>
              <input type="number" min="0" step="1" value={slide.pause_after_s} onChange={e => updateSlide(index, 'pause_after_s', Number(e.target.value))} />
              {uploadingKey && uploadingKey.endsWith(`-${index}`) && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>Uploading...</div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn-ghost" onClick={addSlide}>Add Slide</button>
          <button className="btn-primary" onClick={queue} disabled={!slides.length}>Build Slide Video</button>
        </div>
      </div>
      <ResultCard result={result} />
    </AgentWorkbench>
  )
}

export function DistributionAgentPanel() {
  const [platform, setPlatform] = useState('x')
  const [text, setText] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const queueSocial = async () => {
    if (!text.trim()) return
    try {
      await submitTask('social_post', { platform, text: text.trim(), topic: text.trim().slice(0, 80) }, 'distribution_agent')
      setResult(`social_post queued for ${platform}`)
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    }
  }

  const queueReport = async () => {
    try {
      await submitTask('financial_report', {}, 'distribution_agent')
      setResult('financial_report queued')
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    }
  }

  return (
    <AgentWorkbench
      agentId="distribution_agent"
      title="Distribution Agent"
      description="Queue publishing, social posting, and reporting work from the distribution workspace."
    >
      <div className="card">
        <div className="two-col-grid">
          <div>
            <label>Platform</label>
            <select value={platform} onChange={e => setPlatform(e.target.value)}>
              <option value="x">X</option>
              <option value="facebook">Facebook</option>
              <option value="facebook_groups">Facebook Groups</option>
              <option value="linkedin">LinkedIn</option>
              <option value="instagram_posts">Instagram Post</option>
            </select>
          </div>
        </div>
        <label style={{ marginTop: 10 }}>Post Text</label>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={6} placeholder="Write the post text here..." />
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn-primary" onClick={queueSocial} disabled={!text.trim()}>Queue Social Post</button>
          <button className="btn-ghost" onClick={queueReport}>Generate Financial Report</button>
        </div>
      </div>
      <ResultCard result={result} />
    </AgentWorkbench>
  )
}

export function GenerateAudioPanel() {
  const [topic, setTopic] = useState('')
  const [text, setText] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const generate = async () => {
    if (!text.trim()) return
    try {
      await submitTask('tts', { topic: topic.trim() || 'generated-audio', text: text.trim() }, 'voice_agent')
      setResult(`Audio generation queued for "${topic.trim() || 'generated-audio'}"`)
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    }
  }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <div className="card">
        <div className="section-title">Generate Audio</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Paste any text below and send it directly to the voice agent to create a narration file.
        </div>
        <label>Title / Topic</label>
        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Custom narration" style={{ marginBottom: 10 }} />
        <label>Text</label>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={12} placeholder="Paste text to turn into audio..." />
        <button className="btn-primary" onClick={generate} disabled={!text.trim()} style={{ marginTop: 14 }}>Create Audio</button>
      </div>
      <ResultCard result={result} />
    </div>
  )
}
