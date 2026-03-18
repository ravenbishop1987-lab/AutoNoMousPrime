import { useState } from 'react'

const FEATURES = [
  {
    icon: '🧠',
    title: 'Full Content Pipeline',
    desc: 'One click runs the entire pipeline — SEO research, long-form blog post (up to 3,000 words), AI image, TTS narration, slide video, and social captions. All from a single topic.',
  },
  {
    icon: '🎬',
    title: 'Auto Video Creator',
    desc: 'Choose your duration (1–15 min), aspect ratio (16:9 YouTube, 9:16 TikTok, 1:1 Instagram), and the system assembles a fully narrated, captioned video ready to publish.',
  },
  {
    icon: '📡',
    title: '7-Platform Publisher',
    desc: 'Publishes directly to WordPress, YouTube, Instagram, TikTok, Facebook, Twitter/X, and LinkedIn using native APIs — no third-party scheduler needed.',
  },
  {
    icon: '📧',
    title: 'Email Marketing Automation',
    desc: 'Built-in Gmail SMTP autoresponder with visual sequence builder. Set up drip campaigns, schedule each step by day, personalize with subscriber tokens, and track opens, clicks, and unsubscribes — no third-party email tool required.',
  },
  {
    icon: '📋',
    title: 'Embeddable Capture Forms',
    desc: 'Build custom opt-in forms and embed them on any landing page, sales page, or website with a single iframe or script tag. New subscribers are auto-enrolled into your sequences immediately.',
  },
  {
    icon: '💬',
    title: 'Comment Auto-Reply',
    desc: 'AI scans for new comments every 15 minutes across all platforms — including your WordPress blog — and replies in your brand tone automatically.',
  },
  {
    icon: '📈',
    title: 'SEO Research + Reports',
    desc: 'Built-in keyword research, rank tracking, SEO meta generation (title, description, schema, tags), and a printable HTML SEO report for every post.',
  },
  {
    icon: '⚡',
    title: 'Full Autonomous Mode',
    desc: 'Set your topic list or let AI generate daily topics. Turn off approval gates. The system runs at 8 AM every day, posts on schedule, replies to comments, and sends emails — completely hands-free.',
  },
]

const PLANS = [
  {
    name: 'Starter',
    price: '$49',
    period: '/mo',
    desc: 'For solo creators building their content base',
    features: [
      '30 pipeline runs/month',
      '1 brand / 1 seat',
      'Blog + image pipeline',
      'WordPress auto-publish',
      'Social scheduling (all 7 platforms)',
      'Email sequences (up to 3 active)',
      'Subscriber list (up to 500)',
      'Embeddable capture forms',
      'Approval gates (review before posting)',
      'SEO research + printable reports',
      'Email support',
    ],
    cta: 'Start Free Trial',
    featured: false,
    badge: '',
  },
  {
    name: 'Pro',
    price: '$149',
    period: '/mo',
    desc: 'For operators who want full automation',
    features: [
      '100 pipeline runs/month',
      '3 brands / 3 seats',
      'Full pipeline — blog + image + audio + video',
      '16:9 / 9:16 / 1:1 video formats',
      'Comment auto-reply (all platforms + blog)',
      'Unlimited email sequences',
      'Subscribers up to 5,000',
      'Open / click / unsubscribe tracking',
      'Capture forms with auto-enroll',
      'Full autonomous mode (no approvals)',
      'AI-generated daily topics by niche',
      'Priority support',
    ],
    cta: 'Get Pro',
    featured: true,
    badge: 'Most Popular',
  },
  {
    name: 'Agency',
    price: '$399',
    period: '/mo',
    desc: 'For agencies managing multiple clients at scale',
    features: [
      'Unlimited pipeline runs',
      '10 brands / 10 seats',
      'Everything in Pro',
      'Unlimited subscribers',
      'Email analytics — step drop-off, sequence comparison',
      'Named AI personas per brand',
      'Per-brand email sequences + capture forms',
      'Custom daily schedules per brand',
      'Analytics across all brands',
      'White-label branding',
      'Dedicated onboarding + support',
    ],
    cta: 'Go Agency',
    featured: false,
    badge: '',
  },
]

const FAQS = [
  {
    q: 'What does one "pipeline run" actually do?',
    a: 'A single run takes your topic and keyword, runs SEO research, writes a full blog post (500–3,000 words), generates a matching AI image, records a TTS voiceover, assembles a narrated slide video, writes platform-specific captions, and queues everything for publishing. One click, fully automated.',
  },
  {
    q: 'How does the email autoresponder work?',
    a: 'You build a sequence — a series of emails each scheduled for a specific day (Day 0, Day 3, Day 7, etc.). When someone subscribes via a capture form or is added manually, they\'re enrolled automatically. The system sends each email on schedule using your own Gmail account via app password — no third-party email platform needed. You get open tracking, click tracking, and one-click unsubscribe built in.',
  },
  {
    q: 'How do capture forms work?',
    a: 'Build a form in the Forms tab — set your headline, colors, button text, and which sequence to enroll people in. You\'ll get an iframe snippet and a script tag you can drop onto any landing page, sales page, or website. Works with Webflow, WordPress, Squarespace, Framer, or plain HTML.',
  },
  {
    q: 'Do I need to approve posts before they go live?',
    a: 'On Starter, posts go to a review queue by default. On Pro and Agency you can turn off approval gates entirely in Settings → Automation, and the system will post directly on schedule without any intervention.',
  },
  {
    q: 'How does the comment auto-reply work?',
    a: 'Every 15 minutes the system polls your connected platforms for new comments. It reads each one, generates a contextual reply using your brand name, tone, and any custom instructions you set, then posts the reply directly via the platform\'s API. You can see every reply in the Replies tab.',
  },
  {
    q: 'What platforms does it publish to?',
    a: 'WordPress, YouTube, Instagram, TikTok, Facebook Pages, Facebook Groups, Twitter/X, and LinkedIn — all via native APIs. No webhooks, no third-party schedulers.',
  },
  {
    q: 'Do I need technical skills to set it up?',
    a: 'No. Everything is configured through the Settings panel — paste in your API keys and tokens, select your platforms, set your schedule, and it runs. Gmail SMTP is set up with a single app password. Most users are fully live in under 30 minutes.',
  },
]

interface Props {
  onGetStarted: () => void
}

export default function SalesPage({ onGetStarted }: Props) {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div style={{ fontFamily: 'inherit', color: '#e6edf3', background: '#0d1117', minHeight: '100vh' }}>

      {/* Nav */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: 60,
        background: 'rgba(13,17,23,.92)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,.07)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'linear-gradient(135deg,#58a6ff,#a78bfa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 900, color: '#fff',
          }}>A</div>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: -.3 }}>Autonomous Prime</span>
        </div>
        <div style={{ display: 'flex', gap: 28, fontSize: 13, color: 'rgba(255,255,255,.55)' }}>
          <a href="#features" style={{ color: 'inherit', textDecoration: 'none' }}>Features</a>
          <a href="#pricing" style={{ color: 'inherit', textDecoration: 'none' }}>Pricing</a>
          <a href="#faq" style={{ color: 'inherit', textDecoration: 'none' }}>FAQ</a>
        </div>
        <button onClick={onGetStarted} style={{
          padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg,#58a6ff,#a78bfa)',
          color: '#fff', fontWeight: 700, fontSize: 13,
        }}>
          Get Started →
        </button>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '100px 24px 80px', maxWidth: 840, margin: '0 auto' }}>
        <div style={{
          display: 'inline-block', padding: '4px 14px', borderRadius: 99,
          background: 'rgba(88,166,255,.1)', border: '1px solid rgba(88,166,255,.25)',
          fontSize: 12, fontWeight: 600, color: '#58a6ff', marginBottom: 24,
          letterSpacing: .5,
        }}>
          ⚡ CONTENT + EMAIL + PUBLISHING — ALL AUTOMATED
        </div>

        <h1 style={{
          fontSize: 'clamp(36px, 6vw, 68px)', fontWeight: 900, lineHeight: 1.1,
          margin: '0 0 24px', letterSpacing: -1.5,
        }}>
          Your entire content and email operation.{' '}
          <span style={{
            background: 'linear-gradient(135deg,#58a6ff,#a78bfa)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Running itself.
          </span>
        </h1>

        <p style={{ fontSize: 18, color: 'rgba(255,255,255,.6)', lineHeight: 1.7, marginBottom: 40, maxWidth: 620, margin: '0 auto 40px' }}>
          One platform that writes your blog, creates narrated videos, publishes to all 7 platforms, runs your email sequences, and replies to every comment — automatically, every single day.
        </p>

        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={onGetStarted} style={{
            padding: '14px 32px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg,#58a6ff,#a78bfa)',
            color: '#fff', fontWeight: 800, fontSize: 16,
            boxShadow: '0 0 40px rgba(88,166,255,.3)',
          }}>
            Start Free Trial →
          </button>
          <a href="#features" style={{
            padding: '14px 32px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)',
            color: 'rgba(255,255,255,.7)', fontWeight: 700, fontSize: 16,
            textDecoration: 'none', display: 'inline-block',
          }}>
            See how it works
          </a>
        </div>

        <p style={{ marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,.3)' }}>
          No credit card required · Cancel anytime · Setup in under 30 minutes
        </p>

        {/* Mock dashboard */}
        <div style={{
          marginTop: 60, borderRadius: 16, overflow: 'hidden',
          border: '1px solid rgba(255,255,255,.1)',
          background: 'rgba(255,255,255,.03)',
          boxShadow: '0 40px 80px rgba(0,0,0,.5)',
        }}>
          <div style={{
            padding: '10px 16px', background: 'rgba(255,255,255,.04)',
            borderBottom: '1px solid rgba(255,255,255,.07)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {['#f85149','#e3b341','#3fb950'].map(c => (
              <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
            ))}
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.25)', marginLeft: 8 }}>autonomous-prime — dashboard</span>
          </div>
          <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { label: 'Posts Published',    value: '1,284', trend: '+12 today',      color: '#3fb950' },
              { label: 'Emails Sent',        value: '12,480', trend: '34.2% open rate', color: '#58a6ff' },
              { label: 'Active Subscribers', value: '2,847', trend: '+38 this week',  color: '#a78bfa' },
            ].map(s => (
              <div key={s.label} style={{
                background: 'rgba(255,255,255,.04)', borderRadius: 10,
                border: '1px solid rgba(255,255,255,.08)', padding: '14px 16px', textAlign: 'left',
              }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>{s.trend}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ background: 'rgba(88,166,255,.06)', border: '1px solid rgba(88,166,255,.15)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: '#58a6ff', fontWeight: 700, marginBottom: 8 }}>⚡ Running Now</div>
              {['SEO research + outline...', 'Blog post (1,500 words)...', 'AI image generation...', 'Email sequence — Day 3 send...'].map(t => (
                <div key={t} style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>● {t}</div>
              ))}
            </div>
            <div style={{ background: 'rgba(63,185,80,.06)', border: '1px solid rgba(63,185,80,.15)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: '#3fb950', fontWeight: 700, marginBottom: 8 }}>✓ Completed Today</div>
              {['Published to WordPress + 6 platforms', 'YouTube + TikTok uploaded', '127 emails delivered (36% open)', '4 comments auto-replied'].map(t => (
                <div key={t} style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>✓ {t}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{ padding: '80px 24px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', letterSpacing: 1.5, marginBottom: 12 }}>FEATURES</div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 900, margin: 0, letterSpacing: -.5 }}>
            Everything in one system
          </h2>
          <p style={{ color: 'rgba(255,255,255,.5)', marginTop: 12, fontSize: 16 }}>
            No juggling tools. No copy-pasting between apps. One platform runs content, email, and publishing.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{
              background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 14, padding: '24px 26px',
            }}>
              <div style={{ fontSize: 28, marginBottom: 14 }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,.5)', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Platform strip */}
      <div style={{
        padding: '40px 24px', textAlign: 'center',
        background: 'rgba(255,255,255,.02)', borderTop: '1px solid rgba(255,255,255,.06)', borderBottom: '1px solid rgba(255,255,255,.06)',
      }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.3)', marginBottom: 20, letterSpacing: 1 }}>PUBLISHES DIRECTLY TO</div>
        <div style={{ display: 'flex', gap: 32, justifyContent: 'center', flexWrap: 'wrap', fontSize: 14, fontWeight: 700 }}>
          {[
            { name: 'WordPress', color: '#21759b' },
            { name: 'YouTube',   color: '#ff0000' },
            { name: 'Instagram', color: '#e1306c' },
            { name: 'TikTok',    color: '#ff0050' },
            { name: 'Facebook',  color: '#1877f2' },
            { name: 'Twitter / X', color: '#1d9bf0' },
            { name: 'LinkedIn',  color: '#0a66c2' },
          ].map(p => (
            <span key={p.name} style={{ color: p.color, opacity: .8 }}>{p.name}</span>
          ))}
        </div>
      </div>

      {/* Email feature callout */}
      <section style={{ padding: '80px 24px', maxWidth: 1000, margin: '0 auto' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(88,166,255,.07), rgba(167,139,250,.07))',
          border: '1px solid rgba(88,166,255,.2)',
          borderRadius: 20, padding: '48px 52px',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', letterSpacing: 1.5, marginBottom: 14 }}>BUILT-IN EMAIL MARKETING</div>
            <h3 style={{ fontSize: 'clamp(22px, 3vw, 34px)', fontWeight: 900, margin: '0 0 16px', lineHeight: 1.2 }}>
              Your email list.<br />Your sequences.<br />No monthly tool fees.
            </h3>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.7, marginBottom: 24 }}>
              Autonomous Prime includes a full email marketing stack — visual sequence builder, subscriber management, embeddable capture forms, open and click tracking, and a complete analytics dashboard. Sends through your own Gmail account. No Mailchimp. No ConvertKit. No extra bill.
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              {[
                'Drag-and-drop sequence builder with day scheduling',
                'Embeddable opt-in forms for any website',
                'Auto-enroll on form submit → instant Day 0 send',
                'Open rate, CTR, and unsubscribe tracking',
                'Step drop-off analytics per sequence',
                'CAN-SPAM footer + one-click unsubscribe',
              ].map(item => (
                <div key={item} style={{ display: 'flex', gap: 10, fontSize: 14, color: 'rgba(255,255,255,.65)', alignItems: 'flex-start' }}>
                  <span style={{ color: '#3fb950', marginTop: 1, flexShrink: 0 }}>✓</span>
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {[
              { label: 'Active Subscribers',  value: '2,847',  color: '#58a6ff' },
              { label: 'Open Rate',           value: '34.2%',  color: '#3fb950' },
              { label: 'Click-Through Rate',  value: '8.7%',   color: '#e3b341' },
              { label: 'Emails Delivered',    value: '12,480', color: '#a78bfa' },
            ].map(stat => (
              <div key={stat.label} style={{
                background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
                borderRadius: 10, padding: '14px 18px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)' }}>{stat.label}</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ padding: '80px 24px', maxWidth: 1040, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', letterSpacing: 1.5, marginBottom: 12 }}>PRICING</div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 900, margin: 0, letterSpacing: -.5 }}>
            Simple, transparent pricing
          </h2>
          <p style={{ color: 'rgba(255,255,255,.5)', marginTop: 12, fontSize: 16 }}>
            Start free. Scale when you're ready. Email marketing included on every plan.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
          {PLANS.map(plan => (
            <div key={plan.name} style={{
              background: plan.featured ? 'rgba(88,166,255,.08)' : 'rgba(255,255,255,.03)',
              border: `1px solid ${plan.featured ? 'rgba(88,166,255,.4)' : 'rgba(255,255,255,.08)'}`,
              borderRadius: 16, padding: '28px 26px', position: 'relative',
              boxShadow: plan.featured ? '0 0 40px rgba(88,166,255,.15)' : 'none',
            }}>
              {plan.badge && (
                <div style={{
                  position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                  background: 'linear-gradient(135deg,#58a6ff,#a78bfa)',
                  color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 14px', borderRadius: 99,
                  whiteSpace: 'nowrap',
                }}>{plan.badge}</div>
              )}
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{plan.name}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', marginBottom: 16 }}>{plan.desc}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 20 }}>
                <span style={{ fontSize: 42, fontWeight: 900 }}>{plan.price}</span>
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,.4)' }}>{plan.period}</span>
              </div>
              <ul style={{ listStyle: 'none', margin: '0 0 24px', padding: 0, display: 'grid', gap: 8 }}>
                {plan.features.map(f => (
                  <li key={f} style={{ fontSize: 14, color: 'rgba(255,255,255,.65)', display: 'flex', gap: 8 }}>
                    <span style={{ color: '#3fb950', flexShrink: 0 }}>✓</span> {f}
                  </li>
                ))}
              </ul>
              <button onClick={onGetStarted} style={{
                width: '100%', padding: '12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: plan.featured ? 'linear-gradient(135deg,#58a6ff,#a78bfa)' : 'rgba(255,255,255,.07)',
                color: '#fff', fontWeight: 700, fontSize: 14,
              }}>
                {plan.cta} →
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" style={{ padding: '60px 24px 80px', maxWidth: 700, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e3b341', letterSpacing: 1.5, marginBottom: 12 }}>FAQ</div>
          <h2 style={{ fontSize: 32, fontWeight: 900, margin: 0 }}>Common questions</h2>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {FAQS.map((item, i) => (
            <div key={i} style={{
              background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 10, overflow: 'hidden',
            }}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{
                  width: '100%', padding: '16px 20px', background: 'none', border: 'none',
                  cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  color: '#e6edf3', fontSize: 14, fontWeight: 600, textAlign: 'left', gap: 12,
                }}
              >
                <span>{item.q}</span>
                <span style={{
                  transition: 'transform .2s', display: 'inline-block',
                  transform: openFaq === i ? 'rotate(180deg)' : 'none',
                  color: 'rgba(255,255,255,.4)', fontSize: 11, flexShrink: 0,
                }}>▼</span>
              </button>
              {openFaq === i && (
                <div style={{ padding: '0 20px 16px', fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.7 }}>
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section style={{
        padding: '80px 24px', textAlign: 'center',
        background: 'linear-gradient(135deg, rgba(88,166,255,.06), rgba(167,139,250,.06))',
        borderTop: '1px solid rgba(255,255,255,.07)',
      }}>
        <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 900, margin: '0 0 16px', letterSpacing: -.5 }}>
          Ready to run on autopilot?
        </h2>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,.5)', marginBottom: 8 }}>
          Set your niche, connect your accounts, build your first sequence.
        </p>
        <p style={{ fontSize: 15, color: 'rgba(255,255,255,.35)', marginBottom: 36 }}>
          Autonomous Prime handles content, email, publishing, and replies — every day, automatically.
        </p>
        <button onClick={onGetStarted} style={{
          padding: '16px 40px', borderRadius: 10, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg,#58a6ff,#a78bfa)',
          color: '#fff', fontWeight: 800, fontSize: 17,
          boxShadow: '0 0 60px rgba(88,166,255,.35)',
        }}>
          Get Started Free →
        </button>
        <p style={{ marginTop: 14, fontSize: 12, color: 'rgba(255,255,255,.25)' }}>
          No credit card required · Cancel anytime · Email marketing included
        </p>
      </section>

      {/* Footer */}
      <footer style={{
        padding: '30px 40px', borderTop: '1px solid rgba(255,255,255,.07)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12, color: 'rgba(255,255,255,.25)', flexWrap: 'wrap', gap: 10,
      }}>
        <span>◎ Autonomous Prime</span>
        <div style={{ display: 'flex', gap: 24 }}>
          <a href="#features" style={{ color: 'inherit', textDecoration: 'none' }}>Features</a>
          <a href="#pricing" style={{ color: 'inherit', textDecoration: 'none' }}>Pricing</a>
          <a href="#faq" style={{ color: 'inherit', textDecoration: 'none' }}>FAQ</a>
        </div>
        <span>© {new Date().getFullYear()} — All rights reserved</span>
      </footer>
    </div>
  )
}
