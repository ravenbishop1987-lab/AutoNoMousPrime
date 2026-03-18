import { useEffect, useState } from 'react'
import { getLatestOutput, getStatus, submitPipeline, submitSlidePipeline, submitTask, generateEbookOutline, submitEbook, exportEbookPdf, submitAudiobook, generateNewsletter, translateContent, pollChatTaskResult, type LatestOutput, type SlidePipelineItem, type EbookChapter, type EbookOutline, type NewsletterResult, type TranslationItem } from '../api'
import PodcastPanel from './PodcastPanel'

type Mode = 'blog' | 'video' | 'audio' | 'image' | 'ebook' | 'audiobook' | 'newsletter' | 'infographic' | 'translate' | 'podcast' | null

interface Slide {
  title: string
  image_prompt: string
  caption: string
  voiceover_text: string
}

const blankSlide = (): Slide => ({ title: '', image_prompt: '', caption: '', voiceover_text: '' })

const VIDEO_TYPES = [
  { id: 'youtube',  label: 'YouTube Video',    icon: '▶️',  aspect: '16:9', dur: '300', desc: 'Long-form · 16:9 horizontal' },
  { id: 'short',    label: 'YouTube Short',     icon: '📱',  aspect: '9:16', dur: '60',  desc: 'Vertical · under 60s' },
  { id: 'tiktok',   label: 'TikTok',            icon: '🎵',  aspect: '9:16', dur: '30',  desc: 'Vertical · 15–60s' },
  { id: 'reel',     label: 'Instagram Reel',    icon: '📸',  aspect: '9:16', dur: '30',  desc: 'Vertical · up to 90s' },
  { id: 'ig-post',  label: 'Instagram Post',    icon: '🟦',  aspect: '1:1',  dur: '60',  desc: 'Square · feed post' },
  { id: 'facebook', label: 'Facebook Video',    icon: '📘',  aspect: '16:9', dur: '120', desc: 'Horizontal · feed' },
] as const
type VideoType = typeof VIDEO_TYPES[number]['id']

const IMAGE_TYPES = [
  // Thumbnail
  { id: 'yt-thumbnail', label: 'YouTube Thumbnail', icon: '▶️', aspect: '16:9', w: 1280, h: 720,  desc: '1280×720',  group: 'Thumbnail' },
  // Social
  { id: 'ig-post',      label: 'Instagram Post',    icon: '📸', aspect: '1:1',  w: 1080, h: 1080, desc: '1080×1080', group: 'Social' },
  { id: 'ig-story',     label: 'Instagram Story',   icon: '📱', aspect: '9:16', w: 1080, h: 1920, desc: '1080×1920', group: 'Social' },
  { id: 'tiktok',       label: 'TikTok',            icon: '🎵', aspect: '9:16', w: 1080, h: 1920, desc: '1080×1920', group: 'Social' },
  { id: 'fb-post',      label: 'Facebook Post',     icon: '📘', aspect: '16:9', w: 1200, h: 630,  desc: '1200×630',  group: 'Social' },
  { id: 'twitter',      label: 'Twitter / X',       icon: '🐦', aspect: '16:9', w: 1200, h: 675,  desc: '1200×675',  group: 'Social' },
  { id: 'linkedin',     label: 'LinkedIn',          icon: '💼', aspect: '16:9', w: 1200, h: 627,  desc: '1200×627',  group: 'Social' },
  { id: 'pinterest',    label: 'Pinterest',         icon: '📌', aspect: '2:3',  w: 1000, h: 1500, desc: '1000×1500', group: 'Social' },
  // Banner
  { id: 'yt-banner',    label: 'YouTube Banner',    icon: '🎬', aspect: '16:9', w: 2560, h: 1440, desc: '2560×1440', group: 'Banner' },
  { id: 'web-hero',     label: 'Website Hero',      icon: '🌐', aspect: '16:9', w: 1920, h: 1080, desc: '1920×1080', group: 'Banner' },
  { id: 'email-header', label: 'Email Header',      icon: '✉️', aspect: '3:1',  w: 600,  h: 200,  desc: '600×200',   group: 'Banner' },
  { id: 'fb-cover',     label: 'Facebook Cover',    icon: '📘', aspect: '16:9', w: 820,  h: 312,  desc: '820×312',   group: 'Banner' },
  // Custom
  { id: 'custom',       label: 'Custom Size',       icon: '✏️', aspect: '1:1',  w: 1024, h: 1024, desc: 'Your dimensions', group: 'Custom' },
] as const
type ImageType = typeof IMAGE_TYPES[number]['id']
const IMAGE_GROUPS = ['Thumbnail', 'Social', 'Banner', 'Custom'] as const

function TagInput({ tags, setTags }: { tags: string[]; setTags: (t: string[]) => void }) {
  const [input, setInput] = useState('')
  const add = () => {
    const val = input.trim()
    if (val && !tags.includes(val)) setTags([...tags, val])
    setInput('')
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add keyword and press Enter"
          style={{ flex: 1, fontSize: 13 }}
        />
        <button className="btn-ghost" style={{ fontSize: 13, padding: '8px 14px' }} onClick={add}>Add</button>
      </div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(tag => (
            <span
              key={tag}
              style={{ fontSize: 12, padding: '3px 10px', background: 'rgba(88,166,255,.12)', border: '1px solid rgba(88,166,255,.3)', borderRadius: 20, color: 'var(--accent)', cursor: 'pointer' }}
              onClick={() => setTags(tags.filter(t => t !== tag))}
              title="Click to remove"
            >
              {tag} ×
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const EBOOK_STYLES = [
  { id: 'lead_magnet',    label: 'Lead Magnet',     desc: 'Short, punchy, high-value opt-in gift' },
  { id: 'how_to_guide',  label: 'How-To Guide',     desc: 'Step-by-step instructional content' },
  { id: 'ultimate_guide', label: 'Ultimate Guide',  desc: 'Comprehensive deep-dive reference' },
  { id: 'case_study',    label: 'Case Study',       desc: 'Story-driven results + insights' },
  { id: 'mini_course',   label: 'Mini Course',      desc: 'Structured lessons with exercises' },
] as const
type EbookStyle = typeof EBOOK_STYLES[number]['id']

const EBOOK_THEMES = [
  { id: 'dark',   label: 'Dark',   swatch: '#0d1117' },
  { id: 'light',  label: 'Light',  swatch: '#ffffff' },
  { id: 'warm',   label: 'Warm',   swatch: '#fdf6ee' },
  { id: 'purple', label: 'Purple', swatch: '#1a0a2e' },
  { id: 'green',  label: 'Green',  swatch: '#0a1f14' },
] as const
type EbookTheme = typeof EBOOK_THEMES[number]['id']

const blankChapter = (): EbookChapter => ({ title: '', description: '', image_prompt: '' })

function CreateCard({
  icon, title, description, onClick,
}: { icon: string; title: string; description: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 24,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'border-color .15s, background .15s',
        width: '100%',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(88,166,255,.5)'
        ;(e.currentTarget as HTMLElement).style.background = 'rgba(88,166,255,.06)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
        ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{description}</div>
    </button>
  )
}

function downloadFile(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function PreviewCard({ mode, preview, topic }: { mode: Mode; preview: LatestOutput; topic: string }) {
  if (!preview.found || !preview.url) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>
        Content generated — check the Pipeline tab to find your file.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {mode === 'blog' && (
        <>
          {preview.image_url && (
            <img
              src={preview.image_url}
              alt="Featured"
              style={{ width: '100%', borderRadius: 10, maxHeight: 260, objectFit: 'cover' }}
            />
          )}
          <div
            style={{
              background: 'var(--surface-2, var(--surface))',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 16,
              maxHeight: 320,
              overflowY: 'auto',
              fontSize: 13,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              color: 'var(--text)',
            }}
          >
            {preview.content || 'No preview available.'}
          </div>
        </>
      )}

      {mode === 'audio' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>AUDIO PREVIEW</div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls style={{ width: '100%' }} src={preview.url} />
        </div>
      )}

      {mode === 'video' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>VIDEO PREVIEW</div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video controls style={{ width: '100%', borderRadius: 8, maxHeight: 400 }} src={preview.url} />
        </div>
      )}

      {mode === 'image' && (
        <img
          src={preview.url}
          alt={topic}
          style={{ width: '100%', borderRadius: 10, objectFit: 'contain', maxHeight: 500 }}
        />
      )}

      <button
        className="btn-primary"
        onClick={() => downloadFile(preview.url!, preview.filename ?? 'download')}
        style={{ padding: '12px 24px', fontSize: 14 }}
      >
        Download {mode === 'blog' ? 'Blog Post' : mode === 'audio' ? 'Audio' : mode === 'video' ? 'Video' : mode === 'infographic' ? 'Infographic' : 'Image'}
      </button>
    </div>
  )
}

export default function CreatePanel() {
  const [mode, setMode] = useState<Mode>(null)
  const [videoType, setVideoType] = useState<VideoType | null>(null)
  const [topic, setTopic] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [secondaryKeywords, setSecondaryKeywords] = useState<string[]>([])
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [script, setScript] = useState('')
  const [duration, setDuration] = useState('60')
  const [blogWordCount, setBlogWordCount] = useState('1000')
  const [videoTab, setVideoTab] = useState<'simple' | 'advanced'>('simple')
  const [slides, setSlides] = useState<Slide[]>([blankSlide(), blankSlide(), blankSlide()])
  const [imageStyle, setImageStyle] = useState('photorealistic')
  const [imageType, setImageType] = useState<ImageType | null>(null)
  const [customWidth, setCustomWidth] = useState(1080)
  const [customHeight, setCustomHeight] = useState(1080)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [preview, setPreview] = useState<LatestOutput | null>(null)
  const [error, setError] = useState('')

  // Ebook state
  const [ebookStyle, setEbookStyle] = useState<EbookStyle>('how_to_guide')
  const [ebookTheme, setEbookTheme] = useState<EbookTheme>('dark')
  const [ebookChapterCount, setEbookChapterCount] = useState(5)
  const [ebookWordsPerChapter, setEbookWordsPerChapter] = useState(400)
  const [ebookCoverPrompt, setEbookCoverPrompt] = useState('')
  const [ebookAuthor, setEbookAuthor] = useState('')
  const [ebookCtaText, setEbookCtaText] = useState('')
  const [ebookCtaUrl, setEbookCtaUrl] = useState('')
  const [ebookCtaButton, setEbookCtaButton] = useState('')
  const [ebookChapterImages, setEbookChapterImages] = useState(false)
  const [ebookChapters, setEbookChapters] = useState<EbookChapter[]>([])
  const [ebookOutline, setEbookOutline] = useState<EbookOutline | null>(null)
  const [ebookGeneratingOutline, setEbookGeneratingOutline] = useState(false)
  const [ebookStep, setEbookStep] = useState<'config' | 'chapters' | 'finalize'>('config')
  const [ebookResult, setEbookResult] = useState<{ html_url?: string; html_path?: string; title?: string; pdf_url?: string } | null>(null)
  const [ebookExportingPdf, setEbookExportingPdf] = useState(false)

  // Newsletter state
  const [nlEmailType, setNlEmailType] = useState('newsletter')
  const [nlNiche, setNlNiche] = useState('')
  const [nlAudience, setNlAudience] = useState('')
  const [nlTopic, setNlTopic] = useState('')
  const [nlSenderName, setNlSenderName] = useState('')
  const [nlLength, setNlLength] = useState('medium')
  const [nlTones, setNlTones] = useState<string[]>(['conversational'])
  const [nlOptions, setNlOptions] = useState<string[]>(['generate_subject_lines', 'include_cta'])
  const [nlCtaText, setNlCtaText] = useState('')
  const [nlCtaUrl, setNlCtaUrl] = useState('')
  const [nlPsText, setNlPsText] = useState('')
  const [nlResult, setNlResult] = useState<NewsletterResult | null>(null)
  const [nlGenerating, setNlGenerating] = useState(false)
  const [nlError, setNlError] = useState('')
  const [nlPreviewTab, setNlPreviewTab] = useState<'email' | 'subjects' | 'plain'>('email')

  // Translate & Localize state
  const [tlInputMode,    setTlInputMode]    = useState<'text' | 'file'>('text')
  const [tlText,         setTlText]         = useState('')
  const [tlFile,         setTlFile]         = useState<File | null>(null)
  const [tlFileContent,  setTlFileContent]  = useState('')
  const [tlFileType,     setTlFileType]     = useState<'text' | 'html'>('text')
  const [tlLanguages,    setTlLanguages]    = useState<string[]>(['Spanish', 'French'])
  const [tlFormality,    setTlFormality]    = useState('neutral')
  const [tlAdaptTone,    setTlAdaptTone]    = useState(true)
  const [tlCustom,       setTlCustom]       = useState('')
  const [tlResults,      setTlResults]      = useState<TranslationItem[] | null>(null)
  const [tlLoading,      setTlLoading]      = useState(false)
  const [tlError,        setTlError]        = useState('')
  const [tlActiveTab,    setTlActiveTab]    = useState(0)
  const [tlDragging,     setTlDragging]     = useState(false)

  // Infographic state
  const [infType,     setInfType]     = useState('process')
  const [infStyle,    setInfStyle]    = useState('modern')
  const [infColors,   setInfColors]   = useState('blue')
  const [infSections, setInfSections] = useState('')
  const [infFormat,   setInfFormat]   = useState('tall')

  // Audiobook state
  const [audiobookFile, setAudiobookFile] = useState<File | null>(null)
  const [audiobookDragging, setAudiobookDragging] = useState(false)
  const [audiobookCharCount, setAudiobookCharCount] = useState(0)
  const [audiobookAudioUrl, setAudiobookAudioUrl] = useState<string | null>(null)

  const DURATION_OPTIONS = [
    { value: '30',  label: '30 sec',  slides: 3,  words: 75  },
    { value: '60',  label: '1 min',   slides: 5,  words: 150 },
    { value: '120', label: '2 min',   slides: 8,  words: 300 },
    { value: '300', label: '5 min',   slides: 15, words: 750 },
  ]

  const selectedDuration = DURATION_OPTIONS.find(d => d.value === duration) ?? DURATION_OPTIONS[1]

  // Poll for task completion after submit
  useEffect(() => {
    if (!processing || !taskId) return
    let cancelled = false
    let seenActive = false
    let pollCount = 0
    const maxPolls = 40 // ~2 min

    const poll = async () => {
      if (cancelled) return
      pollCount++
      if (pollCount > maxPolls) {
        if (!cancelled) setProcessing(false)
        return
      }
      try {
        const status = await getStatus()
        const isActive = status.active_tasks.some(t => t.task_id === taskId)
        if (isActive) seenActive = true
        const done = (seenActive && !isActive) || (!seenActive && pollCount > 5)
        if (done) {
          cancelled = true
          if (mode === 'audiobook' && taskId) {
            try {
              const res = await pollChatTaskResult(taskId)
              const audioFile = res.files?.find((f: { type: string }) => f.type === 'audio')
              if (audioFile) setAudiobookAudioUrl(audioFile.url)
            } catch { /* ignore */ }
          } else if (mode === 'ebook' && taskId) {
            try {
              const res = await pollChatTaskResult(taskId)
              const htmlFile = res.files?.find((f: { type: string; name: string }) => f.type === 'blog' && f.name.endsWith('.html'))
              setEbookResult({ html_url: htmlFile?.url, html_path: (res as { html_path?: string }).html_path })
            } catch { /* ignore */ }
          } else {
            const typeMap: Record<string, string> = { blog: 'blog', audio: 'audio', video: 'video', image: 'image' }
            const out = await getLatestOutput(typeMap[mode ?? 'blog'] ?? 'blog', topic.trim())
            setPreview(out)
          }
          setProcessing(false)
          setSubmitted(true)
        }
      } catch { /* ignore poll errors */ }
    }

    const timer = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [processing, taskId]) // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setMode(null)
    setVideoType(null)
    setTopic('')
    setKeywords([])
    setSecondaryKeywords([])
    setScript('')
    setDuration('60')
    setBlogWordCount('1000')
    setAspectRatio('16:9')
    setVideoTab('simple')
    setSlides([blankSlide(), blankSlide(), blankSlide()])
    setImageStyle('photorealistic')
    setImageType(null)
    setCustomWidth(1080)
    setCustomHeight(1080)
    setSubmitted(false)
    setProcessing(false)
    setTaskId(null)
    setPreview(null)
    setError('')
    setEbookStyle('how_to_guide')
    setEbookTheme('dark')
    setEbookChapterCount(5)
    setEbookWordsPerChapter(400)
    setEbookCoverPrompt('')
    setEbookAuthor('')
    setEbookCtaText('')
    setEbookCtaUrl('')
    setEbookCtaButton('')
    setEbookChapterImages(false)
    setEbookChapters([])
    setEbookOutline(null)
    setEbookStep('config')
    setEbookResult(null)
    setEbookExportingPdf(false)
    setAudiobookFile(null)
    setAudiobookDragging(false)
    setAudiobookCharCount(0)
    setAudiobookAudioUrl(null)
    setNlEmailType('newsletter')
    setNlNiche('')
    setNlTopic('')
    setNlTones(['conversational'])
    setNlOptions(['generate_subject_lines', 'include_cta'])
    setNlResult(null)
    setNlGenerating(false)
    setNlError('')
    setNlPreviewTab('email')
    setInfType('process')
    setInfStyle('modern')
    setInfColors('blue')
    setInfSections('')
    setInfFormat('tall')
    setTlInputMode('text')
    setTlText('')
    setTlFile(null)
    setTlFileContent('')
    setTlFileType('text')
    setTlLanguages(['Spanish', 'French'])
    setTlFormality('neutral')
    setTlAdaptTone(true)
    setTlCustom('')
    setTlResults(null)
    setTlLoading(false)
    setTlError('')
    setTlActiveTab(0)
    setTlDragging(false)
  }

  const submit = async () => {
    if (mode !== 'audiobook' && !topic.trim()) { setError(mode === 'image' ? 'Prompt is required' : 'Topic is required'); return }
    setError('')
    setSubmitting(true)
    try {
      let result: { task_id?: string; task_ids?: string[] } = {}
      if (mode === 'audiobook') {
        if (!audiobookFile) { setError('Upload an HTML or text file first'); setSubmitting(false); return }
        const res = await submitAudiobook(audiobookFile)
        setAudiobookCharCount(res.char_count)
        result = { task_id: res.task_id }
      } else if (mode === 'ebook') {
        const res = await submitEbook({
          topic: topic.trim(),
          style: ebookStyle,
          theme: ebookTheme,
          chapter_count: ebookChapterCount,
          words_per_chapter: ebookWordsPerChapter,
          keywords,
          cover_prompt: ebookCoverPrompt,
          author_name: ebookAuthor,
          cta_text: ebookCtaText,
          cta_url: ebookCtaUrl,
          cta_button: ebookCtaButton,
          chapter_images: ebookChapterImages,
          chapters: ebookChapters.filter(c => c.title.trim()),
        })
        result = { task_id: res.task_id }
      } else if (mode === 'infographic') {
        const formatMap: Record<string, { w: number; h: number; ar: string }> = {
          tall:   { w: 800,  h: 2000, ar: '2:5'  },
          wide:   { w: 1200, h: 1600, ar: '3:4'  },
          square: { w: 1080, h: 1080, ar: '1:1'  },
          story:  { w: 1080, h: 1920, ar: '9:16' },
        }
        const fmt = formatMap[infFormat] ?? formatMap.tall
        const sectionNote = infSections.trim() ? ` Key sections: ${infSections.trim().slice(0, 300)}.` : ''
        const colorNote = { blue: 'professional blue and white', purple: 'creative purple and violet', green: 'growth green and teal', orange: 'energetic orange and yellow', dark: 'dark background with neon accents', mono: 'clean black and white monochrome' }[infColors] || 'blue and white'
        const typeNote = { process: 'step-by-step process flow', stats: 'statistics and data visualization with bold numbers', timeline: 'timeline with milestones and dates', comparison: 'side-by-side comparison layout', tips: 'numbered tips and tricks list', howto: 'how-to guide with illustrated steps', hierarchy: 'hierarchy / organizational chart' }[infType] || 'informational'
        const prompt = `A professional high-quality ${typeNote} infographic titled "${topic.trim()}".${sectionNote} Visual style: ${infStyle}. Color scheme: ${colorNote}. Include bold section headers, icons, clear typography, data callouts, and plenty of white space. Polished, print-ready, shareable on social media. No blurry text, crisp vector-style design.`
        result = await submitTask('image_gen', {
          topic: topic.trim(),
          prompt,
          style: `infographic_${infStyle}`,
          aspect_ratio: fmt.ar,
          image_type: 'infographic',
          width: fmt.w,
          height: fmt.h,
          size: `${fmt.w}x${fmt.h}`,
        }, 'image_agent')
      } else if (mode === 'image') {
        const selectedImgType = IMAGE_TYPES.find(t => t.id === imageType)
        const imgW = imageType === 'custom' ? customWidth : (selectedImgType?.w ?? 1080)
        const imgH = imageType === 'custom' ? customHeight : (selectedImgType?.h ?? 1080)
        result = await submitTask('image_gen', {
          topic: topic.trim(),
          prompt: topic.trim(),
          style: imageStyle,
          aspect_ratio: aspectRatio,
          image_type: imageType,
          width: imgW,
          height: imgH,
          size: `${imgW}x${imgH}`,
        }, 'image_agent')
      } else if (mode === 'audio') {
        result = await submitTask('tts', {
          topic: topic.trim(),
          text: script.trim() || '',
          target_words: selectedDuration.words,
          duration_seconds: Number(duration),
        }, 'voice_agent')
      } else if (mode === 'video' && videoTab === 'advanced') {
        const filledSlides: SlidePipelineItem[] = slides
          .filter(s => s.title.trim() || s.voiceover_text.trim())
          .map(s => ({
            title: s.title,
            image_prompt: s.image_prompt,
            negative_prompt: '',
            image_path: '',
            voiceover_text: s.voiceover_text,
            audio_path: '',
            caption: s.caption,
            pause_after_s: 0.5,
          }))
        if (!filledSlides.length) { setError('Add at least one slide with a title or voiceover'); setSubmitting(false); return }
        result = await submitSlidePipeline(topic.trim(), filledSlides, aspectRatio)
      } else {
        result = await submitPipeline(topic.trim(), keywords, aspectRatio, {
          input_payload: {
            generate_video: mode === 'video',
            content_type: mode === 'video' ? 'video' : 'blog',
            target_duration_seconds: Number(duration),
            target_slide_count: selectedDuration.slides,
            target_words: mode === 'blog' ? Number(blogWordCount) : selectedDuration.words,
            secondary_keywords: secondaryKeywords,
          },
        })
      }
      const id = result?.task_id ?? result?.task_ids?.[0] ?? null
      setTaskId(id)
      setProcessing(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Processing / polling screen ──────────────────────────────────────────
  if (processing) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>⚙️</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
          {mode === 'video' ? 'Building your video…' : mode === 'audio' ? 'Synthesizing audio…' : mode === 'image' ? 'Generating image…' : mode === 'ebook' ? 'Writing your ebook…' : mode === 'audiobook' ? 'Converting to audio…' : mode === 'infographic' ? 'Generating infographic…' : 'Writing blog post…'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>
          This may take a minute. We'll show a preview when it's ready.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('ap:navigate', { detail: { tab: 'pipeline' } }))}>
            View Pipeline
          </button>
          <button className="btn-ghost" onClick={reset}>Cancel</button>
        </div>
      </div>
    )
  }

  // ── Submitted / preview screen ───────────────────────────────────────────
  // Audiobook handles its own result UI inside the audiobook mode block above
  if (submitted && mode === 'audiobook') {
    // Re-enter audiobook mode so the result renders there
    // (fall through to audiobook block below)
  }

  if (submitted && mode !== 'audiobook') {
    return (
      <div className="card" style={{ padding: 32, display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {mode === 'video' ? '🎬 Video Ready' : mode === 'audio' ? '🎙️ Audio Ready' : mode === 'image' ? '🖼️ Image Ready' : mode === 'ebook' ? '📖 Ebook Ready' : mode === 'audiobook' ? '🎧 Audiobook Ready' : mode === 'infographic' ? '📊 Infographic Ready' : '✍️ Blog Post Ready'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{topic}</div>
          </div>
          <button className="btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }} onClick={reset}>
            Create Another
          </button>
        </div>

        {mode === 'ebook' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {/* Primary — open in browser */}
            {ebookResult?.html_url ? (
              <a
                href={ebookResult.html_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  background: 'rgba(88,166,255,.10)', border: '1px solid rgba(88,166,255,.35)',
                  borderRadius: 12, padding: '16px 20px', textDecoration: 'none',
                }}
              >
                <span style={{ fontSize: 26 }}>📖</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>Open Ebook in Browser</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>Full styled ebook — infinite scroll, no page cuts</div>
                </div>
                <span style={{ fontSize: 18, color: 'var(--accent)' }}>→</span>
              </a>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Ebook ready — check the Pipeline tab for the file.</div>
            )}

            {/* Secondary — export PDF on demand */}
            {ebookResult?.pdf_url ? (
              <a
                href={ebookResult.pdf_url}
                download
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: '14px 20px', textDecoration: 'none', color: 'var(--text)',
                }}
              >
                <span style={{ fontSize: 22 }}>📄</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Download PDF</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Print-ready version</div>
                </div>
              </a>
            ) : (
              <button
                className="btn-ghost"
                disabled={ebookExportingPdf || !ebookResult?.html_path}
                onClick={async () => {
                  if (!ebookResult?.html_path) return
                  setEbookExportingPdf(true)
                  try {
                    const res = await exportEbookPdf(ebookResult.html_path)
                    if (res.ok && res.pdf_url) setEbookResult(prev => prev ? { ...prev, pdf_url: res.pdf_url } : prev)
                  } catch { /* ignore */ } finally {
                    setEbookExportingPdf(false)
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', fontSize: 13, justifyContent: 'flex-start' }}
              >
                <span style={{ fontSize: 18 }}>📄</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 700 }}>{ebookExportingPdf ? 'Generating PDF…' : 'Export as PDF'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>For printing or download</div>
                </div>
              </button>
            )}
          </div>
        ) : preview ? (
          <PreviewCard mode={mode} preview={preview} topic={topic} />
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Content generated — check the Pipeline tab to find your file.
          </div>
        )}

        <button
          className="btn-ghost"
          style={{ fontSize: 12 }}
          onClick={() => window.dispatchEvent(new CustomEvent('ap:navigate', { detail: { tab: 'pipeline' } }))}
        >
          View Pipeline →
        </button>
      </div>
    )
  }

  // ── Mode select (home) ────────────────────────────────────────────────────
  if (!mode) {
    return (
      <div style={{ display: 'grid', gap: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Create Content</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>What do you want to create?</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <CreateCard
            icon="✍️"
            title="Write Blog Post"
            description="Generate a full SEO-optimized blog post with images and publish it to WordPress."
            onClick={() => setMode('blog')}
          />
          <CreateCard
            icon="🎬"
            title="Create a Video"
            description="Generate a narrated video with slides, voiceover, and captions ready to publish."
            onClick={() => setMode('video')}
          />
          <CreateCard
            icon="🎙️"
            title="Generate Audio"
            description="Synthesize a standalone narration, podcast intro, or spoken clip via Edge TTS."
            onClick={() => setMode('audio')}
          />
          <CreateCard
            icon="🖼️"
            title="Create an Image"
            description="Generate social media graphics, YouTube thumbnails, banners, or custom visuals with AI."
            onClick={() => setMode('image')}
          />
          <CreateCard
            icon="📖"
            title="Create an Ebook"
            description="Generate a full styled ebook with chapters, cover image, and PDF export — ready to publish or use as a lead magnet."
            onClick={() => setMode('ebook')}
          />
          <CreateCard
            icon="🎧"
            title="Create Audiobook"
            description="Upload an HTML ebook or text file and the voice agent will convert it into a full narrated audio file."
            onClick={() => setMode('audiobook')}
          />
          <CreateCard
            icon="📬"
            title="Email Sequences"
            description="Build automated multi-step email sequences with custom delays, triggers, and subscriber management."
            onClick={() => { window.dispatchEvent(new CustomEvent('ap:navigate', { detail: { tab: 'email-sequences' } })) }}
          />
          <CreateCard
            icon="✉️"
            title="Write Email Newsletter"
            description="Generate high-converting email newsletters, promos, welcome sequences and more with live preview."
            onClick={() => setMode('newsletter')}
          />
          <CreateCard
            icon="📊"
            title="Create Infographic"
            description="Generate shareable infographics — process flows, stats, timelines, comparisons, how-to guides — ready for social, web, or print."
            onClick={() => setMode('infographic')}
          />
          <CreateCard
            icon="🌍"
            title="Translate & Localize"
            description="Translate any content into multiple languages with tone adaptation. Paste text, upload HTML, TXT, or Markdown files and get localized versions instantly."
            onClick={() => setMode('translate')}
          />
          <CreateCard
            icon="🎙️"
            title="Create Podcast"
            description="Generate a multi-speaker podcast with AI voices, custom roles, and a fully scripted conversation."
            onClick={() => setMode('podcast')}
          />
        </div>
      </div>
    )
  }

  // ── Translate & Localize ─────────────────────────────────────────────────
  if (mode === 'translate') {
    const LANGUAGES = [
      'Spanish', 'French', 'German', 'Portuguese (Brazil)', 'Portuguese (Portugal)',
      'Italian', 'Dutch', 'Polish', 'Swedish', 'Norwegian', 'Danish', 'Russian',
      'Japanese', 'Korean', 'Chinese (Simplified)', 'Chinese (Traditional)',
      'Arabic', 'Hindi', 'Turkish', 'Thai', 'Vietnamese', 'Indonesian',
      'Greek', 'Czech', 'Romanian', 'Ukrainian', 'Hebrew', 'Malay',
    ]

    const toggleLang = (lang: string) =>
      setTlLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang])

    const handleFile = (file: File) => {
      setTlFile(file)
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      const isHtml = ext === 'html' || ext === 'htm'
      setTlFileType(isHtml ? 'html' : 'text')
      const reader = new FileReader()
      reader.onload = e => setTlFileContent(String(e.target?.result ?? ''))
      reader.readAsText(file)
    }

    const sourceContent = tlInputMode === 'file' ? tlFileContent : tlText
    const sourceType: 'text' | 'html' = tlInputMode === 'file' ? tlFileType : 'text'

    const translate = async () => {
      if (!sourceContent.trim()) { setTlError('Add some content to translate'); return }
      if (!tlLanguages.length) { setTlError('Select at least one language'); return }
      setTlError('')
      setTlLoading(true)
      setTlResults(null)
      setTlActiveTab(0)
      try {
        const res = await translateContent({
          content: sourceContent,
          content_type: sourceType,
          target_languages: tlLanguages,
          formality: tlFormality,
          adapt_tone: tlAdaptTone,
          custom_instructions: tlCustom,
        })
        setTlResults(res.translations || [])
      } catch (e: unknown) {
        setTlError(e instanceof Error ? e.message : 'Translation failed')
      } finally {
        setTlLoading(false)
      }
    }

    const copyText = (text: string) => navigator.clipboard.writeText(text)

    const downloadFile = (content: string, lang: string, type: 'text' | 'html') => {
      const ext = type === 'html' ? 'html' : 'txt'
      const blob = new Blob([content], { type: type === 'html' ? 'text/html' : 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `translation_${lang.replace(/\s+/g, '_').toLowerCase()}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    }

    const activeResult = tlResults?.[tlActiveTab]

    return (
      <div style={{ display: 'grid', gap: 20, maxWidth: 1100 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={reset}>← Back</button>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🌍 Translate & Localize</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Translate any content into multiple languages with tone adaptation</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: tlResults ? '1fr 1fr' : '1fr', gap: 20 }}>

          {/* ── Left: form ── */}
          <div style={{ display: 'grid', gap: 18 }}>

            {/* Input mode tabs */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>CONTENT SOURCE</label>
              <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.04)', borderRadius: 10, padding: 4, border: '1px solid var(--border)', width: 'fit-content', marginBottom: 12 }}>
                {(['text', 'file'] as const).map(m => (
                  <button key={m} onClick={() => setTlInputMode(m)} style={{ padding: '6px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none', background: tlInputMode === m ? 'rgba(88,166,255,.15)' : 'transparent', color: tlInputMode === m ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer' }}>
                    {m === 'text' ? '✏️ Paste Text' : '📎 Upload File'}
                  </button>
                ))}
              </div>

              {tlInputMode === 'text' ? (
                <textarea
                  value={tlText}
                  onChange={e => setTlText(e.target.value)}
                  placeholder="Paste your text, HTML, blog post, email, product description, or any other content here…"
                  rows={8}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }}
                />
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); setTlDragging(true) }}
                  onDragLeave={() => setTlDragging(false)}
                  onDrop={e => { e.preventDefault(); setTlDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                  style={{ border: `2px dashed ${tlDragging ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '28px 20px', textAlign: 'center', background: tlDragging ? 'rgba(88,166,255,.06)' : 'rgba(255,255,255,.02)', cursor: 'pointer', transition: 'all .2s' }}
                  onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,.html,.htm,.md,.csv'; inp.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFile(f) }; inp.click() }}
                >
                  {tlFile ? (
                    <div>
                      <div style={{ fontSize: 24, marginBottom: 8 }}>{tlFileType === 'html' ? '🌐' : '📄'}</div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{tlFile.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{tlFileContent.length.toLocaleString()} characters · {tlFileType.toUpperCase()}</div>
                      <button onClick={e => { e.stopPropagation(); setTlFile(null); setTlFileContent('') }} style={{ marginTop: 10, fontSize: 11, color: '#f85149', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>Drop file here or click to browse</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Supports .txt · .html · .htm · .md · .csv</div>
                    </div>
                  )}
                </div>
              )}
              {sourceContent && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                  {sourceContent.length.toLocaleString()} chars · {sourceContent.split(/\s+/).filter(Boolean).length.toLocaleString()} words
                  {sourceType === 'html' && <span style={{ color: 'var(--accent)', marginLeft: 8 }}>· HTML — tags will be preserved</span>}
                </div>
              )}
            </div>

            {/* Target languages */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>TARGET LANGUAGES ({tlLanguages.length} selected)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setTlLanguages(LANGUAGES.slice(0, 5))} style={{ fontSize: 10, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Top 5</button>
                  <button onClick={() => setTlLanguages([])} style={{ fontSize: 10, color: '#f85149', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {LANGUAGES.map(lang => {
                  const active = tlLanguages.includes(lang)
                  return (
                    <button
                      key={lang}
                      onClick={() => toggleLang(lang)}
                      style={{
                        padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        background: active ? 'rgba(88,166,255,.12)' : 'transparent',
                        color: active ? 'var(--accent)' : 'var(--muted)',
                        transition: 'all .15s',
                      }}
                    >{lang}</button>
                  )
                })}
              </div>
            </div>

            {/* Options */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>FORMALITY</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['formal', 'Formal'], ['neutral', 'Neutral'], ['informal', 'Casual']].map(([id, label]) => (
                    <button key={id} onClick={() => setTlFormality(id)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${tlFormality === id ? 'var(--accent)' : 'var(--border)'}`, background: tlFormality === id ? 'rgba(88,166,255,.1)' : 'transparent', color: tlFormality === id ? 'var(--accent)' : 'var(--muted)' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 22 }}>
                  <div style={{ position: 'relative', width: 36, height: 20, flexShrink: 0 }}>
                    <input type="checkbox" checked={tlAdaptTone} onChange={e => setTlAdaptTone(e.target.checked)} style={{ opacity: 0, position: 'absolute', inset: 0, margin: 0, cursor: 'pointer', width: '100%', height: '100%', zIndex: 1 }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 99, background: tlAdaptTone ? 'var(--accent)' : 'var(--border)', transition: 'background .2s' }} />
                    <div style={{ position: 'absolute', top: 2, left: tlAdaptTone ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Adapt tone per locale</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Idioms + cultural references</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Custom instructions */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>CUSTOM INSTRUCTIONS <span style={{ fontWeight: 400 }}>(optional)</span></label>
              <input
                value={tlCustom}
                onChange={e => setTlCustom(e.target.value)}
                placeholder="e.g. Keep brand name 'Acme' untranslated · Use tu (informal you) in Spanish · Avoid formal honorifics in Korean"
                style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--text)' }}
              />
            </div>

            {tlError && <div style={{ fontSize: 12, color: '#f85149' }}>{tlError}</div>}

            <button
              className="btn-primary"
              onClick={translate}
              disabled={tlLoading || !sourceContent.trim() || !tlLanguages.length}
              style={{ padding: '12px 24px', fontSize: 14 }}
            >
              {tlLoading ? `Translating into ${tlLanguages.length} language${tlLanguages.length > 1 ? 's' : ''}…` : `🌍 Translate into ${tlLanguages.length} Language${tlLanguages.length !== 1 ? 's' : ''}`}
            </button>
          </div>

          {/* ── Right: results ── */}
          {tlResults && tlResults.length > 0 && (
            <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                Translations <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({tlResults.length})</span>
              </div>

              {/* Language tabs */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tlResults.map((r, i) => (
                  <button
                    key={r.language}
                    onClick={() => setTlActiveTab(i)}
                    style={{
                      padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1.5px solid ${tlActiveTab === i ? (r.error ? '#f85149' : 'var(--accent)') : 'var(--border)'}`,
                      background: tlActiveTab === i ? (r.error ? 'rgba(248,81,73,.1)' : 'rgba(88,166,255,.12)') : 'transparent',
                      color: tlActiveTab === i ? (r.error ? '#f85149' : 'var(--accent)') : 'var(--muted)',
                    }}
                  >
                    {r.error ? '⚠ ' : ''}{r.language}
                  </button>
                ))}
              </div>

              {/* Active result */}
              {activeResult && (
                <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, overflow: 'hidden' }}>
                  {/* Result header */}
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{activeResult.language}</span>
                      {!activeResult.error && (
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 10 }}>
                          {activeResult.word_count.toLocaleString()} words · {activeResult.char_count.toLocaleString()} chars
                        </span>
                      )}
                    </div>
                    {!activeResult.error && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => copyText(activeResult.content)}
                          style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => downloadFile(activeResult.content, activeResult.language, sourceType)}
                          style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}
                        >
                          ↓ Download
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  {activeResult.error ? (
                    <div style={{ padding: 16, color: '#f85149', fontSize: 13 }}>
                      Translation failed: {activeResult.error}
                    </div>
                  ) : sourceType === 'html' ? (
                    <div style={{ padding: 0 }}>
                      <div style={{ padding: '8px 16px', background: 'rgba(255,255,255,.02)', borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', gap: 8 }}>
                        {['html', 'preview'].map(t => (
                          <button key={t} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}
                            onClick={() => {
                              const el = document.getElementById(`tl-view-${tlActiveTab}`)
                              if (el) el.dataset.view = t
                            }}>
                            {t === 'html' ? 'Source' : 'Preview'}
                          </button>
                        ))}
                      </div>
                      <pre id={`tl-view-${tlActiveTab}`} data-view="html" style={{ margin: 0, padding: '14px 16px', fontSize: 11, color: '#8b949e', overflowX: 'auto', maxHeight: 420, overflowY: 'auto', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {activeResult.content}
                      </pre>
                    </div>
                  ) : (
                    <pre style={{ margin: 0, padding: '14px 16px', fontSize: 13, color: 'var(--text)', maxHeight: 460, overflowY: 'auto', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>
                      {activeResult.content}
                    </pre>
                  )}
                </div>
              )}

              {/* Download all */}
              {tlResults.filter(r => !r.error).length > 1 && (
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: '8px 16px' }}
                  onClick={() => tlResults.filter(r => !r.error).forEach(r => downloadFile(r.content, r.language, sourceType))}
                >
                  ↓ Download All Translations
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Podcast builder ───────────────────────────────────────────────────────
  if (mode === 'podcast') {
    return (
      <div>
        <button className="btn-ghost" onClick={() => setMode(null)} style={{ fontSize: 12, padding: '4px 10px', marginBottom: 20 }}>← Back</button>
        <PodcastPanel />
      </div>
    )
  }

  // ── Infographic builder ───────────────────────────────────────────────────
  if (mode === 'infographic') {
    const INF_TYPES = [
      { id: 'process',    label: 'Process Flow',  icon: '🔄' },
      { id: 'stats',      label: 'Stats & Data',  icon: '📈' },
      { id: 'timeline',   label: 'Timeline',      icon: '📅' },
      { id: 'comparison', label: 'Comparison',    icon: '⚖️' },
      { id: 'tips',       label: 'Tips & List',   icon: '💡' },
      { id: 'howto',      label: 'How-To Guide',  icon: '🛠' },
      { id: 'hierarchy',  label: 'Hierarchy',     icon: '🏗' },
    ]
    const STYLES = [
      { id: 'modern',    label: 'Modern' },
      { id: 'minimal',   label: 'Minimal' },
      { id: 'bold',      label: 'Bold' },
      { id: 'corporate', label: 'Corporate' },
      { id: 'playful',   label: 'Playful' },
    ]
    const COLOR_SCHEMES = [
      { id: 'blue',   label: 'Blue',     swatch: '#58a6ff' },
      { id: 'purple', label: 'Purple',   swatch: '#a78bfa' },
      { id: 'green',  label: 'Green',    swatch: '#3fb950' },
      { id: 'orange', label: 'Orange',   swatch: '#f0883e' },
      { id: 'dark',   label: 'Dark',     swatch: '#161b22' },
      { id: 'mono',   label: 'Mono',     swatch: '#8b949e' },
    ]
    const FORMATS = [
      { id: 'tall',   label: 'Tall Portrait', desc: '800×2000 — Pinterest / blog', icon: '📄' },
      { id: 'wide',   label: 'Wide',          desc: '1200×1600 — presentation',     icon: '🖥' },
      { id: 'square', label: 'Square',        desc: '1080×1080 — Instagram',        icon: '🟦' },
      { id: 'story',  label: 'Story',         desc: '1080×1920 — IG / TikTok',     icon: '📱' },
    ]

    const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
      <button
        onClick={onClick}
        style={{
          padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
          background: active ? 'rgba(88,166,255,.12)' : 'transparent',
          color: active ? 'var(--accent)' : 'var(--muted)',
        }}
      >{children}</button>
    )

    return (
      <div style={{ display: 'grid', gap: 20, maxWidth: 760 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={reset}>← Back</button>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📊 Create Infographic</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>AI-generated shareable infographics</div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 18 }}>
          {/* Topic */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>TITLE / TOPIC</label>
            <input
              className="input"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. 10 Steps to Launch a SaaS Product, The Buyer's Journey, 2024 Social Media Stats"
              style={{ fontSize: 14, width: '100%' }}
            />
          </div>

          {/* Infographic type */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 10, letterSpacing: '.06em' }}>TYPE</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
              {INF_TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setInfType(t.id)}
                  style={{
                    padding: '10px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `2px solid ${infType === t.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: infType === t.id ? 'rgba(88,166,255,.1)' : 'var(--surface)',
                    color: infType === t.id ? 'var(--accent)' : 'var(--text)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                  }}
                >
                  <span style={{ fontSize: 20 }}>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Key content */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>
              KEY SECTIONS / DATA POINTS <span style={{ fontWeight: 400 }}>(optional — one per line)</span>
            </label>
            <textarea
              className="input"
              value={infSections}
              onChange={e => setInfSections(e.target.value)}
              placeholder={infType === 'stats'
                ? 'e.g.\n73% of marketers use AI\n3x higher engagement with video\n$4.6B AI market by 2025'
                : infType === 'timeline'
                  ? 'e.g.\n2020 — Company founded\n2021 — First 1,000 customers\n2022 — Series A raised'
                  : 'e.g.\nStep 1: Research your market\nStep 2: Validate the idea\nStep 3: Build MVP'}
              rows={6}
              style={{ fontSize: 13, width: '100%', fontFamily: 'monospace' }}
            />
          </div>

          {/* Style + colors side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 10, letterSpacing: '.06em' }}>VISUAL STYLE</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STYLES.map(s => (
                  <Pill key={s.id} active={infStyle === s.id} onClick={() => setInfStyle(s.id)}>{s.label}</Pill>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 10, letterSpacing: '.06em' }}>COLOR SCHEME</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {COLOR_SCHEMES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setInfColors(c.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1.5px solid ${infColors === c.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: infColors === c.id ? 'rgba(88,166,255,.1)' : 'transparent',
                      color: infColors === c.id ? 'var(--accent)' : 'var(--muted)',
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.swatch, display: 'inline-block', flexShrink: 0, border: '1px solid rgba(255,255,255,.2)' }} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Format */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 10, letterSpacing: '.06em' }}>OUTPUT FORMAT</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {FORMATS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setInfFormat(f.id)}
                  style={{
                    padding: '10px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `2px solid ${infFormat === f.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: infFormat === f.id ? 'rgba(88,166,255,.1)' : 'var(--surface)',
                    color: infFormat === f.id ? 'var(--accent)' : 'var(--text)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{f.icon}</span>
                  <span>{f.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

          <button
            className="btn-primary"
            onClick={submit}
            disabled={submitting || !topic.trim()}
            style={{ padding: '12px 24px', fontSize: 14 }}
          >
            {submitting ? 'Generating…' : '📊 Generate Infographic'}
          </button>
        </div>
      </div>
    )
  }

  // ── Email Newsletter builder ──────────────────────────────────────────────
  if (mode === 'newsletter') {
    const EMAIL_TYPES = [
      { id: 'newsletter',    label: 'Newsletter',    icon: '📰' },
      { id: 'promotional',   label: 'Promotional',   icon: '🔥' },
      { id: 'welcome',       label: 'Welcome',       icon: '👋' },
      { id: 'reengagement',  label: 'Re-engagement', icon: '💌' },
      { id: 'abandoned_cart',label: 'Abandoned Cart',icon: '🛒' },
      { id: 'event_invite',  label: 'Event Invite',  icon: '🎟️' },
    ]
    const TONES = ['conversational', 'professional', 'witty', 'urgent', 'inspirational']
    const OPTIONS = [
      { id: 'generate_subject_lines', label: 'Generate subject lines' },
      { id: 'include_cta',            label: 'Include CTA button' },
      { id: 'add_ps',                 label: 'Add PS line' },
      { id: 'plain_text',             label: 'Plain text version' },
    ]
    const toggleArr = (arr: string[], val: string) =>
      arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]

    const generate = async () => {
      if (!nlTopic.trim()) { setNlError('Topic or goal is required'); return }
      setNlError('')
      setNlGenerating(true)
      try {
        const res = await generateNewsletter({
          email_type: nlEmailType, niche: nlNiche, audience: nlAudience,
          topic: nlTopic, tones: nlTones, options: nlOptions,
          length: nlLength, sender_name: nlSenderName,
          cta_text: nlCtaText, cta_url: nlCtaUrl, ps_text: nlPsText,
        })
        setNlResult(res)
        setNlPreviewTab('email')
      } catch (e: unknown) {
        setNlError(e instanceof Error ? e.message : 'Generation failed')
      } finally {
        setNlGenerating(false)
      }
    }

    const copyText = (text: string) => navigator.clipboard.writeText(text)

    return (
      <div style={{ display: 'grid', gap: 20 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={reset}>← Back</button>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>✉️ Email Newsletter</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>AI-written emails with live preview</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: nlResult ? '1fr 1fr' : '1fr', gap: 20 }}>
          {/* ── Left: Form ── */}
          <div style={{ display: 'grid', gap: 18 }}>
            {/* Email type */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>EMAIL TYPE</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {EMAIL_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setNlEmailType(t.id)}
                    style={{
                      padding: '10px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                      border: `2px solid ${nlEmailType === t.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: nlEmailType === t.id ? 'rgba(88,166,255,.1)' : 'var(--surface)',
                      color: nlEmailType === t.id ? 'var(--accent)' : 'var(--text)',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Audience */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>ABOUT YOUR AUDIENCE</label>
              <div style={{ display: 'grid', gap: 8 }}>
                <input
                  className="input"
                  value={nlNiche}
                  onChange={e => setNlNiche(e.target.value)}
                  placeholder="Niche / industry — e.g. SaaS founders, fitness coaches..."
                  style={{ fontSize: 13 }}
                />
                <input
                  className="input"
                  value={nlAudience}
                  onChange={e => setNlAudience(e.target.value)}
                  placeholder="Target audience — e.g. Busy parents aged 30–45 who want to save time..."
                  style={{ fontSize: 13 }}
                />
                <textarea
                  className="input"
                  value={nlTopic}
                  onChange={e => setNlTopic(e.target.value)}
                  placeholder="Topic or goal — e.g. Drive signups for our new AI tool launch this month."
                  rows={3}
                  style={{ fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
            </div>

            {/* Sender + Length */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>SENDER NAME</label>
                <input
                  className="input"
                  value={nlSenderName}
                  onChange={e => setNlSenderName(e.target.value)}
                  placeholder="e.g. Mark from AP"
                  style={{ fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>EMAIL LENGTH</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['short', 'medium', 'long'] as const).map(l => (
                    <button
                      key={l}
                      onClick={() => setNlLength(l)}
                      style={{
                        flex: 1, padding: '7px 4px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        border: `1.5px solid ${nlLength === l ? 'var(--accent)' : 'var(--border)'}`,
                        background: nlLength === l ? 'rgba(88,166,255,.12)' : 'transparent',
                        color: nlLength === l ? 'var(--accent)' : 'var(--text)',
                      }}
                    >
                      {l.charAt(0).toUpperCase() + l.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Tone */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>TONE</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {TONES.map(t => (
                  <button
                    key={t}
                    onClick={() => setNlTones(prev => toggleArr(prev, t))}
                    style={{
                      padding: '6px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1.5px solid ${nlTones.includes(t) ? 'var(--accent)' : 'var(--border)'}`,
                      background: nlTones.includes(t) ? 'rgba(88,166,255,.12)' : 'transparent',
                      color: nlTones.includes(t) ? 'var(--accent)' : 'var(--text)',
                    }}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Options */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8, letterSpacing: '.06em' }}>OPTIONS</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {OPTIONS.map(o => (
                  <button
                    key={o.id}
                    onClick={() => setNlOptions(prev => toggleArr(prev, o.id))}
                    style={{
                      padding: '6px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1.5px solid ${nlOptions.includes(o.id) ? 'rgba(88,166,255,.5)' : 'var(--border)'}`,
                      background: nlOptions.includes(o.id) ? 'rgba(88,166,255,.12)' : 'transparent',
                      color: nlOptions.includes(o.id) ? 'var(--accent)' : 'var(--text)',
                    }}
                  >
                    {nlOptions.includes(o.id) ? '✓ ' : '+ '}{o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Conditional CTA fields */}
            {nlOptions.includes('include_cta') && (
              <div style={{ display: 'grid', gap: 8, padding: '14px', background: 'rgba(88,166,255,.05)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '.06em' }}>CALL TO ACTION</label>
                <input
                  className="input"
                  value={nlCtaText}
                  onChange={e => setNlCtaText(e.target.value)}
                  placeholder="Button text — e.g. Get started free, Book a call, Download now"
                  style={{ fontSize: 13 }}
                />
                <input
                  className="input"
                  value={nlCtaUrl}
                  onChange={e => setNlCtaUrl(e.target.value)}
                  placeholder="CTA URL — e.g. https://yoursite.com/signup"
                  style={{ fontSize: 13 }}
                />
              </div>
            )}

            {/* Conditional PS field */}
            {nlOptions.includes('add_ps') && (
              <div style={{ display: 'grid', gap: 8, padding: '14px', background: 'rgba(88,166,255,.05)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '.06em' }}>P.S. LINE</label>
                <input
                  className="input"
                  value={nlPsText}
                  onChange={e => setNlPsText(e.target.value)}
                  placeholder="Custom P.S. text — leave blank to let AI write it"
                  style={{ fontSize: 13 }}
                />
              </div>
            )}

            {nlError && <div style={{ fontSize: 12, color: '#f85149' }}>{nlError}</div>}

            <button
              className="btn-primary"
              onClick={generate}
              disabled={nlGenerating || !nlTopic.trim()}
              style={{ padding: '12px 24px', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {nlGenerating ? (
                <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙️</span> Generating…</>
              ) : (
                <>✉️ {nlResult ? 'Regenerate Email' : 'Generate Email'} ↗</>
              )}
            </button>
          </div>

          {/* ── Right: Preview ── */}
          {nlResult && (
            <div style={{ display: 'grid', gap: 0, alignContent: 'start' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em' }}>PREVIEW</label>
                <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  {(['email', 'subjects', 'plain'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setNlPreviewTab(tab)}
                      style={{
                        padding: '5px 12px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                        background: nlPreviewTab === tab ? 'var(--accent)' : 'var(--surface)',
                        color: nlPreviewTab === tab ? '#fff' : 'var(--muted)',
                      }}
                    >
                      {tab === 'email' ? 'Email' : tab === 'subjects' ? 'Subject lines' : 'Plain text'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Email preview */}
              {nlPreviewTab === 'email' && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
                  {/* Email client chrome */}
                  <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '10px 14px', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {['#f85149','#e3b341','#3fb950'].map(c => (
                      <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block' }} />
                    ))}
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--muted)', textAlign: 'center', letterSpacing: '.03em' }}>
                      {nlResult.subject}
                    </span>
                  </div>
                  {/* Envelope meta */}
                  <div style={{ background: 'rgba(0,0,0,.15)', padding: '8px 14px', fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 16 }}>
                    <span><strong style={{ color: 'var(--text)' }}>From:</strong> {nlSenderName || 'Autonomous Prime'} &lt;hello@autonomousprime.io&gt;</span>
                    {nlResult.preview_text && <span style={{ opacity: .7 }}>{nlResult.preview_text}</span>}
                  </div>
                  {/* iframe — isolated rendering with full email CSS */}
                  <iframe
                    srcDoc={(() => {
                      const doc = new DOMParser().parseFromString(nlResult.body_html, 'text/html')
                      doc.querySelectorAll('li div.cta-block').forEach(el => {
                        const list = el.closest('ul, ol')
                        if (list?.parentNode) list.parentNode.insertBefore(el, list.nextSibling)
                      })
                      const body = doc.body.innerHTML
                      const sender = nlSenderName || 'Autonomous Prime'
                      return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:20px 0 32px}
.wrap{max-width:580px;margin:0 auto}
.card{background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)}
.brand{background:linear-gradient(135deg,#0d1117 0%,#161b22 100%);padding:22px 32px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #30363d}
.brand-name{color:#58a6ff;font-size:15px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.brand-dot{width:8px;height:8px;border-radius:50%;background:#58a6ff;opacity:.6}
.content{padding:32px 36px;color:#1c1c1e;font-size:15px;line-height:1.75}
.content p{margin-bottom:16px;color:#3a3a4c}
.content h2{font-size:22px;font-weight:800;color:#0d0d1a;margin:28px 0 12px;letter-spacing:-.02em}
.content h3{font-size:17px;font-weight:700;color:#0d0d1a;margin:22px 0 8px}
.content ul,.content ol{padding-left:22px;margin-bottom:16px}
.content li{margin-bottom:8px;color:#3a3a4c}
.content strong{color:#0d0d1a;font-weight:700}
.content em{color:#555;font-style:italic}
.content blockquote{border-left:4px solid #58a6ff;padding:14px 20px;margin:20px 0;color:#555;font-style:italic;background:#f6f8ff;border-radius:0 8px 8px 0}
.cta-block{text-align:center;margin:32px 0 8px}
.cta-block a{display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#58a6ff,#3b82f6);color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.01em;box-shadow:0 4px 18px rgba(88,166,255,.35)}
.ps{padding:0 36px 24px;font-size:13px;color:#666;font-style:italic;border-top:1px dashed #e5e7eb;padding-top:20px;margin-top:4px}
.footer{background:#f8f9fb;border-top:1px solid #e8eaed;padding:16px 32px;text-align:center;font-size:11px;color:#999;line-height:1.8}
.footer a{color:#aaa;text-decoration:none}
.footer a:hover{text-decoration:underline}
</style></head><body>
<div class="wrap"><div class="card">
<div class="brand"><div class="brand-name">${sender}</div><div class="brand-dot"></div></div>
<div class="content">${body}</div>
<div class="footer">
  <a href="#">Unsubscribe</a> &nbsp;·&nbsp; <a href="#">Update preferences</a> &nbsp;·&nbsp; <a href="#">View in browser</a><br/>
  © ${new Date().getFullYear()} ${sender}. All rights reserved.
</div>
</div></div>
</body></html>`
                    })()}
                    style={{ width: '100%', height: 480, border: 'none', display: 'block' }}
                    title="Email preview"
                  />
                </div>
              )}

              {/* Subject lines */}
              {nlPreviewTab === 'subjects' && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {[nlResult.subject, ...(nlResult.subject_lines || [])].filter(Boolean).map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                      {i === 0 && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'rgba(88,166,255,.12)', padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>PRIMARY</span>}
                      <span style={{ flex: 1, fontSize: 13 }}>{s}</span>
                      <button onClick={() => copyText(s)} style={{ fontSize: 11, padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Copy</button>
                    </div>
                  ))}
                  {nlResult.ps_line && (
                    <div style={{ background: 'rgba(88,166,255,.06)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 10, padding: '12px 14px', fontSize: 13 }}>
                      <span style={{ fontWeight: 700, color: 'var(--accent)' }}>P.S. </span>{nlResult.ps_line}
                    </div>
                  )}
                </div>
              )}

              {/* Plain text */}
              {nlPreviewTab === 'plain' && (
                <div style={{ position: 'relative' }}>
                  <textarea
                    readOnly
                    value={nlResult.body_plain}
                    style={{ width: '100%', minHeight: 320, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, fontSize: 12, color: 'var(--text)', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                  <button onClick={() => copyText(nlResult.body_plain)} style={{ position: 'absolute', top: 10, right: 10, fontSize: 11, padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer' }}>Copy</button>
                </div>
              )}

              {/* Stats bar */}
              <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--border)', marginTop: 12 }}>
                {[
                  { label: 'Readability', value: nlResult.stats.readability.toString() },
                  { label: 'Subject grade', value: nlResult.stats.subject_grade },
                  { label: `~${nlResult.stats.read_time} min`, value: 'Read time' },
                ].map((s, i) => (
                  <div key={i} style={{ flex: 1, textAlign: 'center', padding: '10px 8px', borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)' }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Copy full email */}
              <button
                className="btn-ghost"
                style={{ marginTop: 10, fontSize: 12 }}
                onClick={() => copyText(`Subject: ${nlResult.subject}\n\n${nlResult.body_plain}`)}
              >
                Copy full email
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Audiobook converter ───────────────────────────────────────────────────
  if (mode === 'audiobook') {
    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      setAudiobookDragging(false)
      const f = e.dataTransfer.files[0]
      if (f) setAudiobookFile(f)
    }

    return (
      <div style={{ display: 'grid', gap: 20 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={reset}>← Back</button>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🎧 Create Audiobook</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Upload an HTML ebook or plain text file — the voice agent narrates it</div>
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setAudiobookDragging(true) }}
          onDragLeave={() => setAudiobookDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('audiobook-file-input')?.click()}
          style={{
            border: `2px dashed ${audiobookDragging ? 'var(--accent)' : audiobookFile ? 'rgba(88,166,255,.5)' : 'var(--border)'}`,
            borderRadius: 14,
            padding: '40px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: audiobookDragging ? 'rgba(88,166,255,.06)' : audiobookFile ? 'rgba(88,166,255,.04)' : 'var(--surface)',
            transition: 'all .15s',
          }}
        >
          <input
            id="audiobook-file-input"
            type="file"
            accept=".html,.htm,.txt,.md"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) setAudiobookFile(f) }}
          />
          {audiobookFile ? (
            <>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>{audiobookFile.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(audiobookFile.size / 1024).toFixed(1)} KB · Click to change file</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎧</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Drop your HTML or text file here</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Supports .html · .htm · .txt · .md</div>
              <div style={{ display: 'inline-block', fontSize: 12, padding: '6px 18px', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--muted)' }}>
                Browse files
              </div>
            </>
          )}
        </div>

        {/* Info box */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', fontSize: 12, color: 'var(--muted)', display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>How it works</div>
          <div>• HTML tags are stripped — only the readable text is narrated</div>
          <div>• The voice agent uses ElevenLabs or Edge TTS (configured in Settings)</div>
          <div>• Output is an MP3 audio file you can download and share</div>
          <div>• Large ebooks may take a few minutes — you can check the Pipeline tab for progress</div>
        </div>

        {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

        {/* Audiobook result */}
        {submitted && audiobookAudioUrl && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>AUDIOBOOK PREVIEW</div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls style={{ width: '100%' }} src={audiobookAudioUrl} />
            </div>
            <a
              href={audiobookAudioUrl}
              download
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'rgba(88,166,255,.08)', border: '1px solid rgba(88,166,255,.25)',
                borderRadius: 10, padding: '14px 18px', textDecoration: 'none', color: 'var(--accent)',
              }}
            >
              <span style={{ fontSize: 22 }}>⬇️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Download Audiobook</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>MP3 audio file</div>
              </div>
            </a>
            <button className="btn-ghost" style={{ fontSize: 13 }} onClick={reset}>Convert Another</button>
          </div>
        )}

        {!submitted && (
          <button
            className="btn-primary"
            onClick={submit}
            disabled={submitting || !audiobookFile}
            style={{ padding: '12px 28px', fontSize: 14 }}
          >
            {submitting ? 'Starting…' : 'Convert to Audio'}
          </button>
        )}
      </div>
    )
  }

  // ── Ebook page builder ────────────────────────────────────────────────────
  if (mode === 'ebook') {
    const generateOutline = async () => {
      if (!topic.trim()) { setError('Topic is required'); return }
      setError('')
      setEbookGeneratingOutline(true)
      try {
        const res = await generateEbookOutline({ topic: topic.trim(), style: ebookStyle, chapter_count: ebookChapterCount, keywords })
        setEbookOutline(res.outline)
        const chapters = (res.outline.chapters || []).slice(0, ebookChapterCount).map((ch: { title: string; description?: string }) => ({
          title: ch.title,
          description: ch.description || '',
          image_prompt: '',
        }))
        while (chapters.length < ebookChapterCount) chapters.push(blankChapter())
        setEbookChapters(chapters)
        setEbookStep('chapters')
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Outline generation failed')
      } finally {
        setEbookGeneratingOutline(false)
      }
    }

    return (
      <div style={{ display: 'grid', gap: 20 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={reset}>← Back</button>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📖 Create an Ebook</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {ebookStep === 'config' ? 'Step 1 — Configure your ebook' : ebookStep === 'chapters' ? 'Step 2 — Review & edit chapters' : 'Step 3 — Finalize & generate'}
            </div>
          </div>
          {/* Step pills */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(['config', 'chapters', 'finalize'] as const).map((s, i) => (
              <div key={s} style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                background: ebookStep === s ? 'var(--accent)' : 'var(--surface)',
                color: ebookStep === s ? '#fff' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}>{i + 1}</div>
            ))}
          </div>
        </div>

        {/* Step 1 — Config */}
        {ebookStep === 'config' && (
          <div style={{ display: 'grid', gap: 18 }}>
            {/* Topic */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>TOPIC / TITLE IDEA</label>
              <input
                className="input"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="e.g. How to Build a 6-Figure Content Business"
                style={{ width: '100%', fontSize: 14 }}
              />
            </div>

            {/* Style */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>EBOOK STYLE</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                {EBOOK_STYLES.map(s => (
                  <button
                    key={s.id}
                    className="btn-ghost"
                    onClick={() => setEbookStyle(s.id)}
                    style={{
                      textAlign: 'left', padding: '10px 14px',
                      background: ebookStyle === s.id ? 'rgba(88,166,255,.12)' : 'transparent',
                      borderColor: ebookStyle === s.id ? 'rgba(88,166,255,.5)' : 'var(--border)',
                      color: ebookStyle === s.id ? 'var(--accent)' : 'var(--text)',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{s.label}</div>
                    <div style={{ fontSize: 11, opacity: .7, marginTop: 2 }}>{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Theme */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>THEME</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {EBOOK_THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setEbookTheme(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      border: `2px solid ${ebookTheme === t.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: ebookTheme === t.id ? 'rgba(88,166,255,.08)' : 'var(--surface)',
                      color: 'var(--text)', cursor: 'pointer',
                    }}
                  >
                    <div style={{ width: 14, height: 14, borderRadius: 3, background: t.swatch, border: '1px solid rgba(255,255,255,.15)' }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chapter count + words per chapter */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>CHAPTERS</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[3, 5, 7, 10].map(n => (
                    <button
                      key={n}
                      className="btn-ghost"
                      onClick={() => setEbookChapterCount(n)}
                      style={{
                        fontSize: 13, padding: '6px 14px',
                        background: ebookChapterCount === n ? 'rgba(88,166,255,.15)' : 'transparent',
                        borderColor: ebookChapterCount === n ? 'rgba(88,166,255,.5)' : 'var(--border)',
                        color: ebookChapterCount === n ? 'var(--accent)' : 'var(--text)',
                      }}
                    >{n}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>WORDS / CHAPTER</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[200, 400, 600, 1000].map(n => (
                    <button
                      key={n}
                      className="btn-ghost"
                      onClick={() => setEbookWordsPerChapter(n)}
                      style={{
                        fontSize: 13, padding: '6px 12px',
                        background: ebookWordsPerChapter === n ? 'rgba(88,166,255,.15)' : 'transparent',
                        borderColor: ebookWordsPerChapter === n ? 'rgba(88,166,255,.5)' : 'var(--border)',
                        color: ebookWordsPerChapter === n ? 'var(--accent)' : 'var(--text)',
                      }}
                    >{n}</button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  ~{Math.round(ebookChapterCount * ebookWordsPerChapter / 200)} min read total
                </div>
              </div>
            </div>

            {/* Author + Cover prompt */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>AUTHOR NAME</label>
                <input
                  className="input"
                  value={ebookAuthor}
                  onChange={e => setEbookAuthor(e.target.value)}
                  placeholder="Your name or brand"
                  style={{ width: '100%', fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>COVER IMAGE PROMPT</label>
                <input
                  className="input"
                  value={ebookCoverPrompt}
                  onChange={e => setEbookCoverPrompt(e.target.value)}
                  placeholder="Describe the cover (optional)"
                  style={{ width: '100%', fontSize: 13 }}
                />
              </div>
            </div>

            {/* CTA */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>CALL TO ACTION <span style={{ fontWeight: 400, opacity: .6 }}>(optional — shown at the end of the ebook)</span></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px', gap: 10 }}>
                <input
                  className="input"
                  value={ebookCtaText}
                  onChange={e => setEbookCtaText(e.target.value)}
                  placeholder="CTA headline, e.g. Ready to go deeper?"
                  style={{ fontSize: 13 }}
                />
                <input
                  className="input"
                  value={ebookCtaUrl}
                  onChange={e => setEbookCtaUrl(e.target.value)}
                  placeholder="Link URL"
                  style={{ fontSize: 13 }}
                />
                <input
                  className="input"
                  value={ebookCtaButton}
                  onChange={e => setEbookCtaButton(e.target.value)}
                  placeholder="Button label"
                  style={{ fontSize: 13 }}
                />
              </div>
            </div>

            {/* Keywords */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>KEYWORDS (OPTIONAL)</label>
              <TagInput tags={keywords} setTags={setKeywords} />
            </div>

            {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

            <button
              className="btn-primary"
              onClick={generateOutline}
              disabled={ebookGeneratingOutline || !topic.trim()}
              style={{ padding: '12px 24px', fontSize: 14 }}
            >
              {ebookGeneratingOutline ? 'Generating outline…' : 'Generate Outline →'}
            </button>
          </div>
        )}

        {/* Step 2 — Chapters */}
        {ebookStep === 'chapters' && (
          <div style={{ display: 'grid', gap: 16 }}>
            {ebookOutline && (
              <div style={{ background: 'rgba(88,166,255,.06)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{ebookOutline.title}</div>
                {ebookOutline.subtitle && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{ebookOutline.subtitle}</div>}
              </div>
            )}

            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>CHAPTERS — edit titles, descriptions, and optional image prompts</div>

            {ebookChapters.map((ch, i) => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    minWidth: 28, height: 28, borderRadius: '50%',
                    background: 'rgba(88,166,255,.15)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700,
                  }}>{i + 1}</div>
                  <input
                    className="input"
                    value={ch.title}
                    onChange={e => setEbookChapters(prev => prev.map((c, j) => j === i ? { ...c, title: e.target.value } : c))}
                    placeholder={`Chapter ${i + 1} title`}
                    style={{ flex: 1, fontSize: 14, fontWeight: 600 }}
                  />
                </div>
                <textarea
                  className="input"
                  value={ch.description}
                  onChange={e => setEbookChapters(prev => prev.map((c, j) => j === i ? { ...c, description: e.target.value } : c))}
                  placeholder="What this chapter covers (optional — helps guide the AI)"
                  rows={2}
                  style={{ fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }}
                />
                <input
                  className="input"
                  value={ch.image_prompt}
                  onChange={e => setEbookChapters(prev => prev.map((c, j) => j === i ? { ...c, image_prompt: e.target.value } : c))}
                  placeholder="Image prompt for this chapter (optional)"
                  style={{ fontSize: 12 }}
                />
              </div>
            ))}

            <button
              className="btn-ghost"
              style={{ fontSize: 12, padding: '6px 14px', width: 'fit-content' }}
              onClick={() => setEbookChapters(prev => [...prev, blankChapter()])}
            >
              + Add Chapter
            </button>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button className="btn-ghost" style={{ fontSize: 13, padding: '10px 20px' }} onClick={() => setEbookStep('config')}>← Back</button>
              <button className="btn-primary" style={{ fontSize: 13, padding: '10px 20px' }} onClick={() => setEbookStep('finalize')}>Review & Finalize →</button>
            </div>
          </div>
        )}

        {/* Step 3 — Finalize */}
        {ebookStep === 'finalize' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => setEbookChapterImages(!ebookChapterImages)}
                style={{
                  width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: ebookChapterImages ? 'var(--accent)' : 'var(--border)',
                  position: 'relative', transition: 'background .2s',
                }}
              >
                <div style={{
                  position: 'absolute', top: 3, left: ebookChapterImages ? 18 : 3,
                  width: 14, height: 14, borderRadius: '50%', background: '#fff',
                  transition: 'left .2s',
                }} />
              </button>
              <span style={{ fontSize: 13 }}>Generate an image for each chapter</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>(slower, uses more credits)</span>
            </div>

            {/* Summary */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                <div>Topic: <span style={{ color: 'var(--text)' }}>{topic}</span></div>
                <div>Style: <span style={{ color: 'var(--text)' }}>{EBOOK_STYLES.find(s => s.id === ebookStyle)?.label}</span></div>
                <div>Theme: <span style={{ color: 'var(--text)' }}>{EBOOK_THEMES.find(t => t.id === ebookTheme)?.label}</span></div>
                <div>Chapters: <span style={{ color: 'var(--text)' }}>{ebookChapters.filter(c => c.title.trim()).length}</span></div>
                <div>Words/chapter: <span style={{ color: 'var(--text)' }}>{ebookWordsPerChapter}</span></div>
                <div>Est. words: <span style={{ color: 'var(--text)' }}>~{ebookChapters.filter(c => c.title.trim()).length * ebookWordsPerChapter}</span></div>
                {ebookAuthor && <div>Author: <span style={{ color: 'var(--text)' }}>{ebookAuthor}</span></div>}
                {ebookCtaUrl && <div>CTA: <span style={{ color: 'var(--text)' }}>{ebookCtaUrl}</span></div>}
              </div>
            </div>

            {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-ghost" style={{ fontSize: 13, padding: '10px 20px' }} onClick={() => setEbookStep('chapters')}>← Back</button>
              <button
                className="btn-primary"
                onClick={submit}
                disabled={submitting || !topic.trim() || ebookChapters.filter(c => c.title.trim()).length === 0}
                style={{ padding: '12px 28px', fontSize: 14 }}
              >
                {submitting ? 'Starting…' : 'Generate Ebook'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Video type picker (sub-step before form) ─────────────────────────────
  if (mode === 'video' && !videoType) {
    return (
      <div style={{ display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={reset}>← Back</button>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🎬 What are you making?</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Pick a format to pre-configure aspect ratio and duration</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {VIDEO_TYPES.map(vt => (
            <button
              key={vt.id}
              onClick={() => {
                setVideoType(vt.id)
                setAspectRatio(vt.aspect)
                setDuration(vt.dur)
              }}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '18px 20px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'border-color .15s, background .15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(88,166,255,.5)'
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(88,166,255,.06)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 8 }}>{vt.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{vt.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{vt.desc}</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Image type picker ────────────────────────────────────────────────────
  if (mode === 'image' && !imageType) {
    return (
      <div style={{ display: 'grid', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={reset}>← Back</button>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🖼️ What are you making?</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Pick a format to set the correct size</div>
          </div>
        </div>
        {IMAGE_GROUPS.map(group => (
          <div key={group}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 10 }}>{group.toUpperCase()}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
              {IMAGE_TYPES.filter(t => t.group === group).map(it => (
                <button
                  key={it.id}
                  onClick={() => {
                    setImageType(it.id)
                    setAspectRatio(it.aspect)
                    if (it.id !== 'custom') {
                      setCustomWidth(it.w)
                      setCustomHeight(it.h)
                    }
                  }}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '14px 16px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'border-color .15s, background .15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(88,166,255,.5)'
                    ;(e.currentTarget as HTMLElement).style.background = 'rgba(88,166,255,.06)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                    ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{it.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{it.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{it.desc}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Main form ────────────────────────────────────────────────────────────
  const selectedVideoType = VIDEO_TYPES.find(vt => vt.id === videoType)
  const selectedImageType = IMAGE_TYPES.find(it => it.id === imageType)

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          className="btn-ghost"
          style={{ padding: '6px 12px', fontSize: 12 }}
          onClick={() => mode === 'video' ? setVideoType(null) : mode === 'image' ? setImageType(null) : reset()}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {mode === 'video' ? '🎬 Create a Video' : mode === 'audio' ? '🎙️ Generate Audio' : mode === 'image' ? '🖼️ Create an Image' : '✍️ Write Blog Post'}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {mode === 'video' && selectedVideoType
              ? `${selectedVideoType.label} · ${selectedVideoType.aspect} · ${selectedVideoType.desc}`
              : mode === 'image' && selectedImageType
              ? `${selectedImageType.label} · ${imageType === 'custom' ? `${customWidth}×${customHeight}` : selectedImageType.desc}`
              : mode === 'audio' ? 'Synthesizes spoken audio via Edge TTS'
              : 'Generates SEO blog post + images + WordPress publish'}
          </div>
        </div>
      </div>

      {mode === 'video' && (
        <div style={{ display: 'flex', gap: 8 }}>
          {(['simple', 'advanced'] as const).map(t => (
            <button
              key={t}
              className="btn-ghost"
              onClick={() => setVideoTab(t)}
              style={{
                fontSize: 12, padding: '6px 18px', textTransform: 'capitalize',
                background: videoTab === t ? 'rgba(88,166,255,.15)' : 'transparent',
                borderColor: videoTab === t ? 'rgba(88,166,255,.5)' : 'var(--border)',
                color: videoTab === t ? 'var(--accent)' : 'var(--text)',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {mode === 'video' && videoTab === 'advanced' ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>VIDEO TITLE / TOPIC *</label>
              <input className="input" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Morning Routine for ADHD" style={{ width: '100%', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['16:9', '9:16', '1:1'] as const).map(ratio => (
                <button key={ratio} className="btn-ghost" onClick={() => setAspectRatio(ratio)}
                  style={{ fontSize: 12, padding: '6px 14px', background: aspectRatio === ratio ? 'rgba(88,166,255,.15)' : 'transparent', borderColor: aspectRatio === ratio ? 'rgba(88,166,255,.5)' : 'var(--border)', color: aspectRatio === ratio ? 'var(--accent)' : 'var(--text)' }}>
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {slides.map((slide, i) => (
            <div key={i} className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Slide {i + 1}</span>
                {slides.length > 1 && (
                  <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', color: '#f85149', borderColor: 'rgba(248,81,73,.3)' }}
                    onClick={() => setSlides(prev => prev.filter((_, idx) => idx !== i))}>
                    Remove
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>TITLE</span>
                  <input className="input" value={slide.title} onChange={e => setSlides(prev => prev.map((s, idx) => idx === i ? { ...s, title: e.target.value } : s))} placeholder="Slide title" style={{ fontSize: 13 }} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>CAPTION</span>
                  <input className="input" value={slide.caption} onChange={e => setSlides(prev => prev.map((s, idx) => idx === i ? { ...s, caption: e.target.value } : s))} placeholder="On-screen caption text" style={{ fontSize: 13 }} />
                </label>
              </div>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>IMAGE PROMPT</span>
                <input className="input" value={slide.image_prompt} onChange={e => setSlides(prev => prev.map((s, idx) => idx === i ? { ...s, image_prompt: e.target.value } : s))} placeholder="Describe the image to generate for this slide..." style={{ fontSize: 13, width: '100%' }} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>VOICEOVER TEXT</span>
                <textarea className="input" value={slide.voiceover_text} onChange={e => setSlides(prev => prev.map((s, idx) => idx === i ? { ...s, voiceover_text: e.target.value } : s))} placeholder="What should be spoken aloud for this slide..." rows={3} style={{ fontSize: 13, resize: 'vertical', width: '100%' }} />
              </label>
            </div>
          ))}

          <button className="btn-ghost" style={{ fontSize: 13, padding: '10px 0', borderStyle: 'dashed' }}
            onClick={() => setSlides(prev => [...prev, blankSlide()])}>
            + Add Slide
          </button>

          {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}
          <button className="btn-primary" onClick={submit} disabled={submitting || !topic.trim()} style={{ padding: '12px 24px', fontSize: 14 }}>
            {submitting ? 'Starting…' : `Generate Video · ${slides.length} slides`}
          </button>
        </div>
      ) : (

      <div className="card" style={{ padding: 24, display: 'grid', gap: 20 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
            {mode === 'image' ? 'PROMPT *' : 'TOPIC *'}
          </label>
          {mode === 'image' ? (
            <textarea
              className="input"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. A futuristic cityscape at sunset with neon lights, ultra detailed, cinematic"
              rows={4}
              style={{ width: '100%', fontSize: 14, resize: 'vertical' }}
            />
          ) : (
            <input
              className="input"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder={mode === 'video' ? `e.g. ${selectedVideoType?.label ?? 'Video'} about morning routines` : mode === 'audio' ? 'e.g. Intro for my ADHD podcast' : 'e.g. How to manage ADHD at work'}
              style={{ width: '100%', fontSize: 14 }}
            />
          )}
        </div>

        {mode === 'image' && imageType === 'custom' && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>
              CUSTOM SIZE (px)
            </label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ display: 'grid', gap: 4, flex: 1 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>WIDTH</span>
                <input
                  className="input"
                  type="number"
                  min={64} max={4096} step={64}
                  value={customWidth}
                  onChange={e => setCustomWidth(Number(e.target.value))}
                  style={{ fontSize: 14 }}
                />
              </label>
              <span style={{ fontSize: 16, color: 'var(--muted)', paddingTop: 18 }}>×</span>
              <label style={{ display: 'grid', gap: 4, flex: 1 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>HEIGHT</span>
                <input
                  className="input"
                  type="number"
                  min={64} max={4096} step={64}
                  value={customHeight}
                  onChange={e => setCustomHeight(Number(e.target.value))}
                  style={{ fontSize: 14 }}
                />
              </label>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              {customWidth}×{customHeight} px &nbsp;·&nbsp; {(customWidth / customHeight).toFixed(2)} ratio
            </div>
          </div>
        )}

        {mode === 'image' && imageType && imageType !== 'custom' && selectedImageType && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(88,166,255,.06)', border: '1px solid rgba(88,166,255,.2)',
            borderRadius: 8, padding: '10px 14px',
          }}>
            <span style={{ fontSize: 18 }}>{selectedImageType.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedImageType.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{selectedImageType.w}×{selectedImageType.h} px · {selectedImageType.aspect}</div>
            </div>
            <button
              className="btn-ghost"
              style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 10px' }}
              onClick={() => setImageType(null)}
            >
              Change
            </button>
          </div>
        )}

        {mode === 'image' && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              STYLE
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['photorealistic', 'illustration', 'cinematic', 'digital-art'] as const).map(s => (
                <button
                  key={s}
                  className="btn-ghost"
                  onClick={() => setImageStyle(s)}
                  style={{
                    fontSize: 12, padding: '6px 16px',
                    background: imageStyle === s ? 'rgba(88,166,255,.15)' : 'transparent',
                    borderColor: imageStyle === s ? 'rgba(88,166,255,.5)' : 'var(--border)',
                    color: imageStyle === s ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  {s === 'digital-art' ? 'Digital Art' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'audio' && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              SCRIPT <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional — leave blank to auto-generate)</span>
            </label>
            <textarea
              className="input"
              value={script}
              onChange={e => setScript(e.target.value)}
              placeholder="Paste your script here, or leave blank and the AI will write one based on the topic..."
              rows={6}
              style={{ width: '100%', fontSize: 13, resize: 'vertical' }}
            />
          </div>
        )}

        {mode !== 'audio' && mode !== 'image' && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              PRIMARY KEYWORDS
            </label>
            <TagInput tags={keywords} setTags={setKeywords} />
          </div>
        )}

        {mode !== 'audio' && mode !== 'image' && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
              SECONDARY KEYWORDS <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span>
            </label>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
              Supporting terms, LSI keywords, and related phrases
            </div>
            <TagInput tags={secondaryKeywords} setTags={setSecondaryKeywords} />
          </div>
        )}

        {mode === 'blog' && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              WORD COUNT
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {([
                { value: '500',  label: '500',  desc: 'Short' },
                { value: '750',  label: '750',  desc: 'Brief' },
                { value: '1000', label: '1,000', desc: 'Standard' },
                { value: '1500', label: '1,500', desc: 'Long' },
                { value: '2000', label: '2,000', desc: 'Deep dive' },
                { value: '3000', label: '3,000', desc: 'Pillar' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  className="btn-ghost"
                  onClick={() => setBlogWordCount(opt.value)}
                  style={{
                    fontSize: 12, padding: '6px 14px',
                    background: blogWordCount === opt.value ? 'rgba(88,166,255,.15)' : 'transparent',
                    borderColor: blogWordCount === opt.value ? 'rgba(88,166,255,.5)' : 'var(--border)',
                    color: blogWordCount === opt.value ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  {opt.label} <span style={{ opacity: .6, fontSize: 11 }}>{opt.desc}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              ~{Math.round(Number(blogWordCount) / 200)} min read
            </div>
          </div>
        )}

        {(mode === 'video' || mode === 'audio') && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              DURATION
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {DURATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className="btn-ghost"
                  onClick={() => setDuration(opt.value)}
                  style={{
                    fontSize: 12,
                    padding: '6px 16px',
                    background: duration === opt.value ? 'rgba(88,166,255,.15)' : 'transparent',
                    borderColor: duration === opt.value ? 'rgba(88,166,255,.5)' : 'var(--border)',
                    color: duration === opt.value ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              {mode === 'video'
                ? `~${selectedDuration.slides} slides · ~${selectedDuration.words} words of narration`
                : `~${selectedDuration.words} words · ~${Math.round(selectedDuration.words / 150)} min read`}
            </div>
          </div>
        )}

        {mode === 'video' && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              ASPECT RATIO
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['16:9', '9:16', '1:1'] as const).map(ratio => (
                <button
                  key={ratio}
                  className="btn-ghost"
                  onClick={() => setAspectRatio(ratio)}
                  style={{
                    fontSize: 12,
                    padding: '6px 16px',
                    background: aspectRatio === ratio ? 'rgba(88,166,255,.15)' : 'transparent',
                    borderColor: aspectRatio === ratio ? 'rgba(88,166,255,.5)' : 'var(--border)',
                    color: aspectRatio === ratio ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

        <button
          className="btn-primary"
          onClick={submit}
          disabled={submitting || !topic.trim()}
          style={{ padding: '12px 24px', fontSize: 14 }}
        >
          {submitting ? 'Starting…' : mode === 'video' ? 'Generate Video' : mode === 'audio' ? 'Generate Audio' : mode === 'image' ? 'Generate Image' : mode === 'ebook' ? 'Generate Ebook' : mode === 'infographic' ? 'Generate Infographic' : 'Generate Blog Post'}
        </button>
      </div>
      )}
    </div>
  )
}
