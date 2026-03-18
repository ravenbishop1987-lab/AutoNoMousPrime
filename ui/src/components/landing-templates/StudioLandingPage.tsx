import { type PublicLandingPage } from '../../api'

interface Props {
  page: PublicLandingPage
  status: string
  openFaq: number | null
  setOpenFaq: (value: number | null) => void
  launchCheckout: (ctaId?: string) => Promise<void>
}

export default function StudioLandingPage({ page, status, openFaq, setOpenFaq, launchCheckout }: Props) {
  const content = (page.content || {}) as Record<string, any>
  const sections = (content.sections || {}) as Record<string, boolean>
  const highlights = Array.isArray(content.highlights) ? content.highlights : [
    'Fast launch',
    'Tracked checkout',
    'Reusable funnel',
  ]
  const featureCards = Array.isArray(content.features) ? content.features : []
  const testimonials = Array.isArray(content.testimonials) ? content.testimonials : []
  const faqItems = page.faq_items?.length ? page.faq_items : [
    { question: 'What happens after purchase?', answer: 'The buyer is routed into your linked checkout and fulfillment flow.' },
    { question: 'Can I edit this page later?', answer: 'Yes. The JSX template is driven by the Commerce builder content.' },
  ]
  const pricingPlans = Array.isArray(content.pricing_plans) ? content.pricing_plans : []
  const hasPricingSection = sections.pricing !== false && pricingPlans.length > 0

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f7f1e6 0%, #efe2c7 55%, #f8f6f1 100%)',
      color: '#1d1408',
      fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
    }}>
      <section style={{ padding: '32px 24px 16px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          borderBottom: '1px solid rgba(29,20,8,.12)',
          paddingBottom: 18,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: '#1d1408',
              color: '#f7f1e6',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 18,
            }}>
              {String(content.brand_mark || 'AP').slice(0, 2)}
            </div>
            <div>
              <div style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', opacity: 0.65 }}>Commerce Landing</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{content.brand_name || page.name}</div>
            </div>
          </div>
          <button
            onClick={() => void launchCheckout('studio-nav')}
            style={{
              border: 'none',
              borderRadius: 999,
              background: '#1d1408',
              color: '#fff7ea',
              padding: '12px 22px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {page.cta_text || 'Start Now'}
          </button>
        </div>
      </section>

      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 64px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.05fr) minmax(320px, .95fr)',
          gap: 28,
          alignItems: 'stretch',
        }}>
          <div style={{
            background: 'rgba(255,250,242,.78)',
            border: '1px solid rgba(29,20,8,.12)',
            borderRadius: 28,
            padding: 36,
            boxShadow: '0 28px 70px rgba(79,56,22,.12)',
          }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 999,
              background: '#fff7ea',
              border: '1px solid rgba(29,20,8,.12)',
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '.12em',
            }}>
              {content.hero_tag || 'Launch-ready offer'}
            </div>
            <h1 style={{ fontSize: 'clamp(2.8rem, 5vw, 5rem)', lineHeight: 1, marginTop: 18, maxWidth: 720 }}>
              {page.hero_title}
            </h1>
            <p style={{ marginTop: 18, maxWidth: 620, fontSize: 18, lineHeight: 1.65, color: 'rgba(29,20,8,.78)' }}>
              {page.hero_subtitle}
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
              <button
                onClick={() => void launchCheckout('studio-hero')}
                style={{
                  border: 'none',
                  borderRadius: 16,
                  background: '#1d1408',
                  color: '#fff7ea',
                  padding: '16px 24px',
                  fontWeight: 800,
                  fontSize: 15,
                  cursor: 'pointer',
                }}
              >
                {page.cta_text || 'Buy Now'}
              </button>
              {hasPricingSection ? (
                <a
                  href="#pricing"
                  style={{
                    borderRadius: 16,
                    border: '1px solid rgba(29,20,8,.18)',
                    color: '#1d1408',
                    padding: '15px 22px',
                    fontWeight: 700,
                    fontSize: 15,
                    textDecoration: 'none',
                    background: '#fff7ea',
                  }}
                >
                  View Pricing
                </a>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 22 }}>
              {highlights.map((item: string, index: number) => (
                <div
                  key={`${item}-${index}`}
                  style={{
                    borderRadius: 999,
                    background: 'rgba(29,20,8,.06)',
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
            {status && <div style={{ marginTop: 20, color: '#7a2417', fontSize: 13 }}>{status}</div>}
          </div>

          <div style={{
            background: '#1d1408',
            color: '#fff7ea',
            borderRadius: 28,
            padding: 28,
            display: 'grid',
            gap: 18,
            boxShadow: '0 28px 70px rgba(29,20,8,.2)',
          }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.14em', opacity: 0.7 }}>Offer Snapshot</div>
            <div style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 800 }}>{page.offer_summary || 'Built to convert and easy to reuse.'}</div>
            <div style={{ display: 'grid', gap: 12 }}>
              {(page.includes || []).slice(0, 4).map((item, index) => (
                <div key={`${item}-${index}`} style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 12, alignItems: 'start' }}>
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 12,
                    background: 'rgba(255,247,234,.12)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                  }}>
                    {index + 1}
                  </div>
                  <div style={{ lineHeight: 1.5 }}>{item}</div>
                </div>
              ))}
            </div>
            <div style={{
              borderRadius: 20,
              background: 'rgba(255,247,234,.08)',
              padding: 18,
              fontSize: 14,
              lineHeight: 1.7,
            }}>
              {page.proof_points?.[0] || 'Use this space to reinforce the outcome and reduce hesitation.'}
            </div>
          </div>
        </div>
      </section>

      {featureCards.length > 0 && (
        <section style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }}>
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {featureCards.map((item: any, index: number) => (
              <div key={`${item.title}-${index}`} style={{
                background: 'rgba(255,250,242,.82)',
                border: '1px solid rgba(29,20,8,.12)',
                borderRadius: 24,
                padding: 24,
                boxShadow: '0 18px 40px rgba(79,56,22,.08)',
              }}>
                <div style={{ fontSize: 24 }}>{item.icon || '•'}</div>
                <div style={{ marginTop: 14, fontSize: 20, fontWeight: 800 }}>{item.title}</div>
                <div style={{ marginTop: 10, fontSize: 15, lineHeight: 1.65, color: 'rgba(29,20,8,.74)' }}>{item.description}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasPricingSection && (
        <section id="pricing" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', opacity: 0.65 }}>Pricing</div>
            <h2 style={{ fontSize: 'clamp(2rem, 3.8vw, 3rem)', marginTop: 10 }}>Pick the offer path that fits.</h2>
          </div>
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {pricingPlans.map((plan: any, index: number) => (
              <div key={`${plan.name}-${index}`} style={{
                background: plan.featured ? '#1d1408' : 'rgba(255,250,242,.82)',
                color: plan.featured ? '#fff7ea' : '#1d1408',
                border: `1px solid ${plan.featured ? 'rgba(255,247,234,.16)' : 'rgba(29,20,8,.12)'}`,
                borderRadius: 26,
                padding: 26,
                boxShadow: '0 18px 40px rgba(79,56,22,.08)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{plan.name}</div>
                  {plan.badge ? (
                    <div style={{
                      borderRadius: 999,
                      background: plan.featured ? 'rgba(255,247,234,.12)' : 'rgba(29,20,8,.08)',
                      padding: '7px 10px',
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '.08em',
                    }}>
                      {plan.badge}
                    </div>
                  ) : null}
                </div>
                <div style={{ marginTop: 12, fontSize: 38, fontWeight: 900 }}>
                  {plan.price}
                  {plan.price_suffix ? <span style={{ fontSize: 16, opacity: 0.7, marginLeft: 6 }}>{plan.price_suffix}</span> : null}
                </div>
                <div style={{ marginTop: 8, lineHeight: 1.6, opacity: 0.8 }}>{plan.description}</div>
                <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
                  {(Array.isArray(plan.features) ? plan.features : []).map((feature: string, featureIndex: number) => (
                    <div key={`${feature}-${featureIndex}`} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 10, alignItems: 'start' }}>
                      <div style={{ fontWeight: 900 }}>+</div>
                      <div style={{ lineHeight: 1.5 }}>{feature}</div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => void launchCheckout(`studio-plan-${index + 1}`)}
                  style={{
                    marginTop: 22,
                    width: '100%',
                    border: 'none',
                    borderRadius: 16,
                    background: plan.featured ? '#fff7ea' : '#1d1408',
                    color: plan.featured ? '#1d1408' : '#fff7ea',
                    padding: '15px 18px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {plan.cta || page.cta_text || 'Choose Plan'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {(testimonials.length > 0 || faqItems.length > 0) && (
        <section style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 80px', display: 'grid', gap: 22, gridTemplateColumns: '1.1fr .9fr' }}>
          <div style={{ display: 'grid', gap: 16 }}>
            {(testimonials.length ? testimonials : [{ quote: page.proof_points?.[0] || '', author: page.name, stars: 5 }]).map((item: any, index: number) => (
              <div key={`${item.quote}-${index}`} style={{
                background: 'rgba(255,250,242,.82)',
                border: '1px solid rgba(29,20,8,.12)',
                borderRadius: 24,
                padding: 24,
              }}>
                <div style={{ fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.55 }}>
                  {'★'.repeat(Math.max(1, Number(item.stars) || 5))}
                </div>
                <div style={{ marginTop: 12, fontSize: 24, lineHeight: 1.35, fontWeight: 700 }}>
                  "{item.quote}"
                </div>
                <div style={{ marginTop: 12, opacity: 0.7 }}>{item.author}</div>
              </div>
            ))}
          </div>
          <div style={{
            background: '#fff7ea',
            border: '1px solid rgba(29,20,8,.12)',
            borderRadius: 28,
            padding: 24,
            alignSelf: 'start',
          }}>
            <div style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', opacity: 0.65 }}>Questions</div>
            <h3 style={{ fontSize: 28, marginTop: 10 }}>Everything needed to move.</h3>
            <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
              {faqItems.map((item, index) => (
                <div key={`${item.question}-${index}`} style={{ borderTop: index ? '1px solid rgba(29,20,8,.1)' : 'none', paddingTop: index ? 12 : 0 }}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      textAlign: 'left',
                      color: '#1d1408',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    <span>{item.question}</span>
                    <span>{openFaq === index ? '−' : '+'}</span>
                  </button>
                  {openFaq === index ? (
                    <div style={{ marginTop: 10, lineHeight: 1.7, color: 'rgba(29,20,8,.72)' }}>{item.answer}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
