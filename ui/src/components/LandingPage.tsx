import { useEffect, useMemo, useState } from 'react'
import { createPublicLandingCheckout, getPublicLandingPage, trackCommerceClick, type PublicLandingPage } from '../api'
import './landing-page.css'
import StudioLandingPage from './landing-templates/StudioLandingPage'

const DEFAULT_HOW_STEPS = [
  { title: 'Step one', description: 'Explain the first part of your process.' },
  { title: 'Step two', description: 'Explain the next stage clearly.' },
  { title: 'Step three', description: 'Explain the result or activation point.' },
]

function getQueryValue(key: string) {
  return new URLSearchParams(window.location.search).get(key) || ''
}

function pageTheme(theme: Record<string, string>) {
  return {
    ['--lp-accent' as string]: theme.accent || '#5c7a5c',
    ['--lp-accent-light' as string]: theme.accent_light || '#eef3ee',
    ['--lp-accent-dark' as string]: theme.accent_dark || '#3a5c3a',
    ['--lp-bg' as string]: theme.surface || '#f7f4ef',
    ['--lp-surface' as string]: theme.card || '#ffffff',
    ['--lp-surface-2' as string]: theme.surface_2 || '#eff0eb',
    ['--lp-text' as string]: theme.ink || '#1a2310',
    ['--lp-text-2' as string]: theme.text_2 || '#4a5840',
    ['--lp-text-muted' as string]: theme.muted || '#8a9a80',
    ['--lp-border' as string]: theme.card_border || '#e0e5da',
  } as React.CSSProperties
}

export default function LandingPage({ slug }: { slug: string }) {
  const [page, setPage] = useState<PublicLandingPage | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [email, setEmail] = useState('')
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    getPublicLandingPage(slug).then(data => {
      if (!active) return
      if (data.item) {
        setPage(data.item)
        setError('')
      } else {
        setPage(null)
        setError(data.error || 'Landing page not found.')
      }
    }).catch((exc: any) => {
      if (!active) return
      setPage(null)
      setError(exc?.message || 'Could not load landing page.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [slug])

  const attribution = useMemo(() => ({
    post_id: getQueryValue('post_id'),
    platform: getQueryValue('platform'),
    cta_id: getQueryValue('cta_id'),
    offer_id: getQueryValue('offer_id') || page?.offer.id || '',
    success_url: `${window.location.origin}/lp/${slug}?checkout=success`,
    cancel_url: `${window.location.origin}/lp/${slug}?checkout=cancel`,
  }), [page?.offer.id, slug])

  const safeFallbackLink = useMemo(() => {
    const link = String(page?.cta_link || '').trim()
    if (!link) return ''
    try {
      const target = new URL(link, window.location.origin)
      const current = new URL(window.location.href)
      if (target.origin === current.origin && target.pathname === current.pathname) {
        return ''
      }
      return target.toString()
    } catch {
      return link
    }
  }, [page?.cta_link])

  const openFallbackLink = (message: string) => {
    if (safeFallbackLink) {
      setStatus(message)
      window.open(safeFallbackLink, '_blank', 'noopener,noreferrer')
      return true
    }
    return false
  }

  const launchCheckout = async (ctaId = `${slug}:primary`) => {
    void trackCommerceClick({
      cta_id: ctaId,
      landing_page_id: page?.id || '',
      offer_id: page?.offer.id || '',
      platform: 'landing_page',
    })
    if (!page?.offer.stripe_price_id) {
      if (openFallbackLink('No Stripe price is linked yet. Opening the CTA link instead.')) {
        return
      }
      setStatus('No Stripe price is linked to this page yet. Add an offer with a Stripe Price ID in the Commerce tab.')
      return
    }

    setStatus('Preparing secure checkout...')
    try {
      const data = await createPublicLandingCheckout(slug, attribution)
      if (data.url) {
        window.location.href = data.url
        return
      }
      if ((data.error || '').toLowerCase().includes('no stripe price') && openFallbackLink('Checkout is not linked yet. Opening the CTA link instead.')) {
        return
      }
      setStatus(data.error || 'Checkout is unavailable for this landing page.')
    } catch (exc: any) {
      const apiError = exc?.response?.data?.error
      const message = apiError || exc?.message || 'Checkout failed.'
      if (String(message).toLowerCase().includes('no stripe price') && openFallbackLink('Checkout is not linked yet. Opening the CTA link instead.')) {
        return
      }
      setStatus(message)
    }
  }

  const handlePlanAction = (plan: Record<string, any>) => {
    const ctaId = `${slug}:${String(plan.name || 'plan').toLowerCase().replace(/\s+/g, '-')}`
    const directLink = String(plan.link || plan.cta_link || '').trim()
    if (directLink) {
      void trackCommerceClick({
        cta_id: ctaId,
        landing_page_id: page?.id || '',
        offer_id: page?.offer.id || '',
        platform: 'landing_page',
      })
      window.open(directLink, '_blank', 'noopener,noreferrer')
      return
    }
    void launchCheckout(ctaId)
  }

  const submitEmail = (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim()) return
    window.open(page?.cta_link || 'https://focusstepadhd.com/', '_blank', 'noopener,noreferrer')
  }

  if (loading) {
    return <div className="lp-page" style={pageTheme({})}><div className="lp-loading">Loading landing page...</div></div>
  }

  if (!page) {
    return <div className="lp-page" style={pageTheme({})}><div className="lp-loading">{error || 'Landing page not found.'}</div></div>
  }

  const content = (page.content || {}) as Record<string, any>
  const sections = (content.sections || {}) as Record<string, boolean>
  const sectionLabels = (content.section_labels || {}) as Record<string, string>
  const titles = (content.titles || {}) as Record<string, string>
  const subtitles = (content.subtitles || {}) as Record<string, string>
  const navLinks = Array.isArray(content.nav_links) ? content.nav_links : []
  const howSteps = Array.isArray(content.how_steps) ? content.how_steps : []
  const featureCards = Array.isArray(content.features) ? content.features : []
  const testimonials = Array.isArray(content.testimonials) ? content.testimonials : []
  const pricingPlans = Array.isArray(content.pricing_plans) ? content.pricing_plans : []
  const emailCaptureEnabled = content.email_capture_enabled !== false
  const brandName = String(content.brand_name || page.name || 'Your Brand')
  const brandMark = String(content.brand_mark || '◎')
  const heroTag = String(content.hero_tag || 'Built for your audience')
  const heroCtaNote = String(content.hero_cta_note || 'Free forever · Pro available · No account required')
  const heroSecondaryCta = String(content.hero_secondary_cta || 'See pricing')
  const heroImageUrl = String(content.hero_image_url || '')
  const demoImageUrl = String(content.demo_image_url || '')
  const footerText = String(content.footer_text || 'Made with care for your customers.')
  const footerLinkLabel = String(content.footer_link_label || (() => {
    try { return new URL(page.cta_link || window.location.origin).host } catch { return 'yourdomain.com' }
  })())

  const benefits = page.benefits.length ? page.benefits : [
    'Hyper-specific steps',
    'Audio readout',
    'Per-step help',
    'Make it more specific',
    'Translation history',
    'Favourites',
  ]
  const includes = page.includes.length ? page.includes : [
    'Primary deliverable',
    'Quick-start material',
    'Implementation guide',
    'Optional support or upsell path',
  ]
  const proofPoints = page.proof_points.length ? page.proof_points : [
    'Replace this with a believable customer outcome.',
    'Use testimonials that reduce hesitation and show transformation.',
    'Add one more proof point that sounds like a real buyer.',
  ]
  const hasPricingSection = sections.pricing !== false
  const faqItems = page.faq_items.length ? page.faq_items : [
    { question: 'Do I need to create an account?', answer: 'No account needed at all. Just go to the app, type a task, and get your steps.' },
    { question: 'How is this different from just asking ChatGPT?', answer: 'This flow is designed around structured, actionable steps for your buyer instead of broad paragraphs.' },
    { question: 'What if I am still stuck after getting the steps?', answer: 'You can refine the output further and ask for even smaller next actions.' },
  ]

  const fallbackNavLinks = [
    { label: sectionLabels.features || 'Features', href: '#features' },
    { label: 'How it works', href: '#how' },
    ...(hasPricingSection ? [{ label: sectionLabels.pricing || 'Pricing', href: '#pricing' }] : []),
  ]
  const visibleNavLinks = (navLinks.length ? navLinks : fallbackNavLinks).filter((item: any) => (
    hasPricingSection || String(item?.href || '').trim() !== '#pricing'
  ))
  const fallbackFeatures = benefits.slice(0, 6).map((item, index) => ({
    icon: ['🎯', '🔊', '💬', '✨', '📋', '★'][index] || '✦',
    title: item,
    description: 'Turn abstract tasks into structured actions your buyer can actually follow without extra decision fatigue.',
  }))
  const fallbackTestimonials = proofPoints.slice(0, 3).map((item, index) => ({
    quote: item,
    author: `${brandName} customer ${index + 1}`,
    stars: 5,
  }))
  const fallbackPricing = [
    { name: 'Starter', price: '$0', price_suffix: '', description: 'Entry plan', features: ['Feature one', 'Feature two'], cta: 'Start free', featured: false, badge: '', link: '' },
    { name: 'Growth', price: '$29', price_suffix: '/ month', description: 'Main offer', features: ['Everything in Starter', 'More usage', 'Priority support'], cta: 'Choose Growth', featured: true, badge: 'Most popular', link: '' },
    { name: 'Lifetime', price: '$199', price_suffix: '', description: 'One-time payment', features: ['Everything in Growth', 'No recurring bill'], cta: 'Get lifetime', featured: false, badge: '', link: '' },
  ]

  const headlineWords = page.hero_title.trim().split(/\s+/)
  const emphasisCount = headlineWords.length > 3 ? 3 : Math.max(1, headlineWords.length - 1)
  const lead = headlineWords.slice(0, Math.max(1, headlineWords.length - emphasisCount)).join(' ')
  const emphasis = headlineWords.slice(-emphasisCount).join(' ')

  if (page.template === 'studio_jsx') {
    return (
      <StudioLandingPage
        page={page}
        status={status}
        openFaq={openFaq}
        setOpenFaq={setOpenFaq}
        launchCheckout={launchCheckout}
      />
    )
  }

  return (
    <div className="lp-page" style={pageTheme(page.theme)}>
      <nav className="lp-nav">
        <a href="#top" className="lp-nav-logo"><span className="lp-nav-mark">{brandMark}</span> <span>{brandName}</span></a>
        <button
          className="lp-nav-toggle"
          aria-label="Toggle navigation"
          aria-expanded={navOpen ? 'true' : 'false'}
          onClick={() => setNavOpen(prev => !prev)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className={`lp-nav-links${navOpen ? ' open' : ''}`}>
          {visibleNavLinks.map((item: any, index: number) => (
            <a key={`${item.label}-${index}`} href={item.href} onClick={() => setNavOpen(false)}>{item.label}</a>
          ))}
          <button className="lp-nav-cta" onClick={() => { setNavOpen(false); void launchCheckout() }}>{page.cta_text || 'Try Free'} →</button>
        </div>
      </nav>

      {sections.hero !== false && (
        <section className="lp-hero" id="top">
          <div className="lp-hero-tag">✦ {heroTag}</div>
          <h1>{lead}<br /><em>{emphasis}</em></h1>
          <p className="lp-hero-sub">{page.hero_subtitle}</p>
          <div className="lp-hero-actions">
            <button className="lp-btn lp-btn-primary" onClick={() => void launchCheckout()}>{page.cta_text || 'Try it free — no signup needed'}</button>
            {hasPricingSection ? <a href="#pricing" className="lp-btn lp-btn-outline">{heroSecondaryCta}</a> : null}
          </div>
          <p className="lp-hero-social">{heroCtaNote}</p>
          {heroImageUrl && <img className="lp-hero-image" src={heroImageUrl} alt={page.hero_title} />}
          {status && <p className="lp-status">{status}</p>}
        </section>
      )}

      {sections.how !== false && (
        <div className="lp-how-strip" id="how">
          <div className="lp-how-strip-inner">
            {[0, 1, 2].map(index => (
              <div key={index} className="lp-how-step">
                <div className="lp-how-num">{index + 1}</div>
                <div className="lp-how-title">{howSteps[index]?.title || DEFAULT_HOW_STEPS[index].title}</div>
                <div className="lp-how-desc">{howSteps[index]?.description || DEFAULT_HOW_STEPS[index].description}</div>
              </div>
            )).reduce<React.ReactNode[]>((acc, item, index) => {
              acc.push(item)
              if (index < 2) acc.push(<div key={`divider-${index}`} className="lp-how-divider">→</div>)
              return acc
            }, [])}
          </div>
        </div>
      )}

      {sections.demo !== false && (
        <section className="lp-demo-section">
          <div className="lp-demo-header">
            <div className="lp-section-tag">{sectionLabels.demo || 'See it in action'}</div>
            <h2>{titles.demo || 'This is what you get instantly.'}</h2>
            <p>{subtitles.demo || page.offer_summary || 'Type any task. Get a clear breakdown like this in seconds.'}</p>
          </div>
          {demoImageUrl && <img className="lp-demo-image" src={demoImageUrl} alt={`${page.name} showcase`} />}
          <div className="lp-demo-card">
            <div className="lp-demo-label">Task entered</div>
            <div className="lp-demo-task">"{page.name || 'Sample workflow'}"</div>
            <div className="lp-demo-start">
              <div className="lp-demo-start-label">▶ Start Here</div>
              <div className="lp-demo-start-text">{includes[0]}</div>
            </div>
            <div className="lp-demo-steps">
              {includes.slice(0, 3).map((item, index) => (
                <div key={`${item}-${index}`} className="lp-demo-step">
                  <div className="lp-demo-step-num">{index + 1}</div>
                  <div>
                    <div className="lp-demo-step-action">{item}</div>
                    <div className="lp-demo-step-detail">Specific, calm direction that reduces friction and helps your buyer move right away.</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {sections.features !== false && (
        <section className="lp-section lp-features-bg" id="features">
          <div className="lp-section-inner">
            <div className="lp-section-tag">{sectionLabels.features || 'Features'}</div>
            <h2 className="lp-section-title">{titles.features || 'Everything your customer needs to get started.'}</h2>
            <p className="lp-section-sub">{subtitles.features || 'Replace this with the benefits for your business.'}</p>
            <div className="lp-features-grid">
              {(featureCards.length ? featureCards : fallbackFeatures).map((item: any, index: number) => (
                <div key={`${item.title}-${index}`} className="lp-feature-card">
                  <span className="lp-feature-icon">{item.icon || '✦'}</span>
                  <div className="lp-feature-title">{item.title}</div>
                  <div className="lp-feature-desc">{item.description}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {sections.testimonials !== false && (
        <section className="lp-section lp-testimonials-bg" id="testimonials">
          <div className="lp-section-inner">
            <div className="lp-section-tag">{sectionLabels.testimonials || 'What people are saying'}</div>
            <h2 className="lp-section-title">{titles.testimonials || 'Real people. Real results.'}</h2>
            <p className="lp-section-sub">{subtitles.testimonials || ''}</p>
            <div className="lp-testimonials-grid">
              {(testimonials.length ? testimonials : fallbackTestimonials).map((item: any, index: number) => (
                <div key={`${item.quote}-${index}`} className="lp-testimonial">
                  <div className="lp-stars">{'★'.repeat(Math.max(1, Number(item.stars) || 5))}</div>
                  <div className="lp-testimonial-text">"{item.quote}"</div>
                  <div className="lp-testimonial-author">{item.author}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {hasPricingSection && (
        <section className="lp-section lp-pricing-section" id="pricing">
          <div className="lp-section-inner">
            <div className="lp-section-tag">{sectionLabels.pricing || 'Pricing'}</div>
            <h2 className="lp-section-title">{titles.pricing || 'Start free. Upgrade when ready.'}</h2>
            <p className="lp-section-sub">{subtitles.pricing || 'Replace this with your pricing explanation.'}</p>
            <div className="lp-pricing-grid">
              {(pricingPlans.length ? pricingPlans : fallbackPricing).map((plan: any, index: number) => (
                <div key={`${plan.name}-${index}`} className={`lp-price-card ${plan.featured ? 'lp-price-card-featured' : ''}`}>
                  {plan.featured && <div className="lp-price-badge">{plan.badge || 'Most popular'}</div>}
                  <div className="lp-price-name">{plan.name}</div>
                  <div className="lp-price-amount">{plan.price} {plan.price_suffix ? <span>{plan.price_suffix}</span> : null}</div>
                  <div className="lp-price-desc">{plan.description}</div>
                  <ul className="lp-price-features">
                    {(Array.isArray(plan.features) ? plan.features : []).map((feature: string, featureIndex: number) => (
                      <li key={`${feature}-${featureIndex}`}>{feature}</li>
                    ))}
                  </ul>
                  <button className={`lp-btn ${plan.featured ? 'lp-btn-primary' : 'lp-btn-outline'} lp-btn-full`} onClick={() => handlePlanAction(plan)}>{plan.cta || page.cta_text || 'Get started'} →</button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {sections.faq !== false && (
        <section className="lp-section" id="faq">
          <div className="lp-section-inner">
            <div className="lp-section-tag">{sectionLabels.faq || 'FAQ'}</div>
            <h2 className="lp-section-title">{titles.faq || 'Common questions.'}</h2>
            <p className="lp-section-sub">{subtitles.faq || ''}</p>
            <div className="lp-faq-list">
              {faqItems.map((item, index) => (
                <div key={`${item.question}-${index}`} className={`lp-faq-item ${openFaq === index ? 'open' : ''}`}>
                  <button type="button" className="lp-faq-q" onClick={() => setOpenFaq(openFaq === index ? null : index)}>
                    <span>{item.question}</span>
                    <span className="lp-faq-chevron">▼</span>
                  </button>
                  <div className="lp-faq-a">
                    <div className="lp-faq-a-inner">{item.answer}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {sections.email !== false && emailCaptureEnabled && (
        <section className="lp-email-section" id="email">
          <div className="lp-section-inner">
            <h2 className="lp-section-title">{titles.email || 'Get weekly updates.'}</h2>
            <p className="lp-section-sub">{subtitles.email || 'Replace this with your newsletter value proposition.'}</p>
            <form className="lp-email-form" onSubmit={submitEmail}>
              <input
                type="email"
                className="lp-email-input"
                placeholder="your@email.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
              />
              <button type="submit" className="lp-email-btn">Subscribe →</button>
            </form>
            <p className="lp-email-note">{String(content.email_note || 'No spam. Unsubscribe anytime.')}</p>
          </div>
        </section>
      )}

      <footer className="lp-footer">
        <div className="lp-footer-logo">{brandMark} {brandName}</div>
        <p>{footerText}</p>
        <br />
        <p><a href={page.cta_link} target="_blank" rel="noreferrer">{footerLinkLabel}</a></p>
      </footer>
    </div>
  )
}
