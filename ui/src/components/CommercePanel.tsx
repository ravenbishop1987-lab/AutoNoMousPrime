import { useEffect, useMemo, useState } from 'react'
import {
  createLandingPage,
  createOffer,
  deleteLandingPage,
  getCommerceRevenue,
  getLandingPages,
  getOffers,
  getSettings,
  updateLandingPage,
  type CommerceRevenueData,
  type LandingPageItem,
  type OfferItem,
} from '../api'
const LANDING_TEMPLATES = [
  { value: 'offer', label: 'Offer Page' },
  { value: 'studio_jsx', label: 'Studio JSX Page' },
  { value: 'lead_magnet', label: 'Lead Magnet' },
  { value: 'subscription', label: 'Subscription' },
]

const QUICK_BUILD_TABS = [
  { key: 'basics', label: 'Basics' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'content', label: 'Content' },
] as const

const COMMERCE_VIEWS = [
  { key: 'build', label: 'Build' },
  { key: 'pages', label: 'Pages' },
  { key: 'revenue', label: 'Revenue' },
] as const

const AFFILIATE_STARTERS = [
  {
    key: 'review',
    kind: 'affiliate',
    label: 'Review Page',
    note: 'Best for one product or one main affiliate offer.',
    template: 'offer',
    ctaText: 'Check price',
    heroTitle: 'The simple review page for one strong offer',
    heroSubtitle: 'Explain who this is for, why you recommend it, and what someone should expect before they click through.',
    offerSummary: 'A beginner-friendly breakdown of the offer, what it solves, and why it is worth checking out.',
    benefits: ['Who this is best for', 'Why you recommend it', 'What makes it useful'],
    includes: ['Quick overview', 'Best use case', 'Pros and tradeoffs', 'Affiliate CTA'],
    proofPoints: ['Clear recommendation', 'Fast buyer path', 'Built for affiliate attribution'],
  },
  {
    key: 'comparison',
    kind: 'affiliate',
    label: 'Comparison Page',
    note: 'Best for comparing two or three tools before sending traffic.',
    template: 'offer',
    ctaText: 'Compare options',
    heroTitle: 'Compare the top options before you buy',
    heroSubtitle: 'Use this when your audience needs a short comparison and a clear recommendation instead of a long article.',
    offerSummary: 'A side-by-side comparison page with a simple recommendation and tracked CTA path.',
    benefits: ['Faster decision making', 'Less friction for buyers', 'Stronger conversion clarity'],
    includes: ['Who each option fits', 'Tradeoffs', 'Recommendation', 'CTA to the preferred offer'],
    proofPoints: ['Clear comparison', 'Simple next step', 'Easy to reuse per niche'],
  },
  {
    key: 'resources',
    kind: 'affiliate',
    label: 'Resource Page',
    note: 'Best for listing recommended tools, kits, or partner offers.',
    template: 'offer',
    ctaText: 'See recommended tools',
    heroTitle: 'A curated resource page for your best recommendations',
    heroSubtitle: 'Use this when you want one evergreen page that collects your core affiliate links in a clean format.',
    offerSummary: 'A reusable resource page that bundles your recommended tools and turns scattered links into one tracked destination.',
    benefits: ['Evergreen destination page', 'Easy to link from content', 'Cleaner monetization path'],
    includes: ['Top picks', 'Short notes', 'Who each tool fits', 'Tracked CTA links'],
    proofPoints: ['Easy to maintain', 'Works for content hubs', 'Useful for new visitors'],
  },
  {
    key: 'sales',
    kind: 'sales',
    label: 'Sales Page',
    note: 'Best for selling your own product, service, subscription, or paid offer.',
    template: 'subscription',
    ctaText: 'Buy now',
    heroTitle: 'A direct sales page that leads cleanly to checkout',
    heroSubtitle: 'Use this when you want a focused product page with benefits, proof, pricing, and a clear next step.',
    offerSummary: 'A simple sales page that explains the value, handles objections, and gives buyers a clear checkout path.',
    benefits: ['Clear promise', 'Simple value explanation', 'Direct path to purchase'],
    includes: ['Offer breakdown', 'What is included', 'Proof and FAQ', 'Pricing with checkout CTA'],
    proofPoints: ['Built for conversion', 'Clear buyer path', 'Works with direct checkout links'],
  },
  {
    key: 'ebook',
    kind: 'ebook',
    label: 'Ebook Page',
    note: 'Best for selling or giving away a PDF guide, ebook, or digital download.',
    template: 'lead_magnet',
    ctaText: 'Download the ebook',
    heroTitle: 'Get the complete guide — download it instantly',
    heroSubtitle: 'Use this when you want a clean landing page to deliver a PDF, digital guide, or free resource in exchange for a click or email.',
    offerSummary: 'A focused ebook landing page that shows what is inside, who it is for, and makes the download or purchase the obvious next step.',
    benefits: ['Who this guide is written for', 'The main outcome readers get', 'Why this beats a generic blog post'],
    includes: ['Chapter or section breakdown', 'What readers will learn', 'Bonus tips or extras included', 'Instant download after purchase or opt-in'],
    proofPoints: ['PDF delivered instantly', 'No fluff — straight to the point', 'Written from real experience'],
  },
] as const

function templateLabel(template: string) {
  return LANDING_TEMPLATES.find(item => item.value === template)?.label || template || 'Offer Page'
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const DEFAULT_FEATURES = [
  { icon: '🎯', title: 'Hyper-specific steps', description: 'Replace this with the first feature for your business.' },
  { icon: '🔊', title: 'Audio readout', description: 'Replace this with a second feature or use case.' },
  { icon: '💬', title: 'Per-step help', description: 'Explain how this removes friction for buyers.' },
]

const DEFAULT_TESTIMONIALS = [
  { quote: 'Replace this with a believable customer outcome.', author: 'Customer one', stars: 5 },
  { quote: 'Use testimonials that reduce hesitation and show transformation.', author: 'Customer two', stars: 5 },
  { quote: 'Add one more proof point that sounds like a real buyer.', author: 'Customer three', stars: 5 },
]

const DEFAULT_PRICING = [
  { name: 'Starter', price: '$0', price_suffix: '', description: 'Entry plan', features: ['Feature one', 'Feature two'], cta: 'Start free', featured: false, badge: '', link: '' },
  { name: 'Growth', price: '$29', price_suffix: '/ month', description: 'Main offer', features: ['Everything in Starter', 'More usage', 'Priority support'], cta: 'Choose Growth', featured: true, badge: 'Most popular', link: '' },
  { name: 'Lifetime', price: '$199', price_suffix: '', description: 'One-time payment', features: ['Everything in Growth', 'No recurring bill'], cta: 'Get lifetime', featured: false, badge: '', link: '' },
]

const DEFAULT_FAQ = [
  { question: 'What happens after purchase?', answer: 'Buyers go through your tracked success flow.' },
  { question: 'Can I measure which post drove the sale?', answer: 'Yes. Attribution is tied to CTA, landing page, and offer.' },
  { question: 'Can I edit this later?', answer: 'Yes. This page is managed from the Commerce tab.' },
]

const DEFAULT_HOW_STEPS = [
  { title: 'Step one', description: 'Explain the first part of your process.' },
  { title: 'Step two', description: 'Explain the next stage clearly.' },
  { title: 'Step three', description: 'Explain the result or activation point.' },
]

const DEFAULT_PAGE_CONTENT = {
  brand_name: 'Your Brand',
  brand_mark: '◎',
  hero_tag: 'Built for your audience',
  hero_cta_note: 'Free trial or primary offer note',
  hero_secondary_cta: 'See pricing',
  hero_image_url: '',
  demo_image_url: '',
  sections: {
    hero: true,
    how: true,
    demo: true,
    features: true,
    testimonials: true,
    pricing: true,
    faq: true,
    email: true,
  },
  nav_links: [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how' },
    { label: 'Pricing', href: '#pricing' },
  ],
  section_labels: {
    demo: 'See it in action',
    features: 'Features',
    testimonials: 'What people are saying',
    pricing: 'Pricing',
    faq: 'FAQ',
  },
  titles: {
    demo: 'This is what you get instantly.',
    features: 'Everything your customer needs to get started.',
    testimonials: 'Real people. Real results.',
    pricing: 'Start free. Upgrade when ready.',
    faq: 'Common questions.',
    email: 'Get weekly updates.',
  },
  subtitles: {
    demo: 'Replace this with a short explanation of what the visitor sees next.',
    features: 'Replace this with benefits for your business.',
    testimonials: 'Replace this with trust-building proof.',
    pricing: 'Replace this with your pricing explanation.',
    faq: 'Replace this with FAQ guidance.',
    email: 'Replace this with your newsletter value proposition.',
  },
  how_steps: DEFAULT_HOW_STEPS,
  features: DEFAULT_FEATURES,
  testimonials: DEFAULT_TESTIMONIALS,
  pricing_plans: DEFAULT_PRICING,
  email_capture_enabled: true,
  email_note: 'No spam. Unsubscribe anytime.',
  footer_text: 'Made with care for your customers.',
  footer_link_label: 'yourdomain.com',
}

function parseTextList(value: string) {
  return value.split('\n').map(item => item.trim()).filter(Boolean)
}

function parseFaq(value: string) {
  return value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [question, ...rest] = item.split('|')
      return { question: (question || '').trim(), answer: rest.join('|').trim() }
    })
    .filter(item => item.question && item.answer)
}

export default function CommercePanel() {
  const [siteUrl, setSiteUrl] = useState(window.location.origin)
  const [starterKey, setStarterKey] = useState<(typeof AFFILIATE_STARTERS)[number]['key']>('review')
  const [revenue, setRevenue] = useState<CommerceRevenueData | null>(null)
  const [offers, setOffers] = useState<OfferItem[]>([])
  const [landingPages, setLandingPages] = useState<LandingPageItem[]>([])
  const [catalogMsg, setCatalogMsg] = useState('')
  const [offerName, setOfferName] = useState('')
  const [offerCheckoutUrl, setOfferCheckoutUrl] = useState('')
  const [pageName, setPageName] = useState('')
  const [editingLandingPageId, setEditingLandingPageId] = useState('')
  const [pageSlug, setPageSlug] = useState('')
  const [pageTemplate, setPageTemplate] = useState('offer')
  const [pageHeroTitle, setPageHeroTitle] = useState('')
  const [pageHeroSubtitle, setPageHeroSubtitle] = useState('')
  const [pageCtaText, setPageCtaText] = useState('Start now')
  const [pageCtaLink, setPageCtaLink] = useState('https://example.com/offer')
  const [pageOfferSummary, setPageOfferSummary] = useState('')
  const [pageBenefits, setPageBenefits] = useState('Clear outcome\nLower friction\nBetter buyer confidence')
  const [pageIncludes, setPageIncludes] = useState('Core product or service\nQuick-start guide\nBonus asset\nSupport or next step')
  const [pageFaq, setPageFaq] = useState(DEFAULT_FAQ.map(item => `${item.question} | ${item.answer}`).join('\n'))
  const [pageProofPoints, setPageProofPoints] = useState('Trusted by focused builders\nClear offer outcomes\nFast Stripe checkout')
  const [brandName, setBrandName] = useState(DEFAULT_PAGE_CONTENT.brand_name)
  const [brandMark, setBrandMark] = useState(DEFAULT_PAGE_CONTENT.brand_mark)
  const [heroTag, setHeroTag] = useState(DEFAULT_PAGE_CONTENT.hero_tag)
  const [heroCtaNote, setHeroCtaNote] = useState(DEFAULT_PAGE_CONTENT.hero_cta_note)
  const [heroSecondaryCta, setHeroSecondaryCta] = useState(DEFAULT_PAGE_CONTENT.hero_secondary_cta)
  const [heroImageUrl, setHeroImageUrl] = useState('')
  const [demoImageUrl, setDemoImageUrl] = useState('')
  const [sectionFlags, setSectionFlags] = useState(DEFAULT_PAGE_CONTENT.sections)
  const [navLinksText, setNavLinksText] = useState(DEFAULT_PAGE_CONTENT.nav_links.map(item => `${item.label} | ${item.href}`).join('\n'))
  const [howStepsText, setHowStepsText] = useState(DEFAULT_HOW_STEPS.map(item => `${item.title} | ${item.description}`).join('\n'))
  const [featuresText, setFeaturesText] = useState(DEFAULT_FEATURES.map(item => `${item.icon} | ${item.title} | ${item.description}`).join('\n'))
  const [testimonialsText, setTestimonialsText] = useState(DEFAULT_TESTIMONIALS.map(item => `${item.quote} | ${item.author} | ${item.stars}`).join('\n'))
  const [pricingPlansForm, setPricingPlansForm] = useState(DEFAULT_PRICING)
  const [titleDemo, setTitleDemo] = useState(String(DEFAULT_PAGE_CONTENT.titles.demo))
  const [titleFeatures, setTitleFeatures] = useState(String(DEFAULT_PAGE_CONTENT.titles.features))
  const [titleTestimonials, setTitleTestimonials] = useState(String(DEFAULT_PAGE_CONTENT.titles.testimonials))
  const [titlePricing, setTitlePricing] = useState(String(DEFAULT_PAGE_CONTENT.titles.pricing))
  const [titleFaq, setTitleFaq] = useState(String(DEFAULT_PAGE_CONTENT.titles.faq))
  const [titleEmail, setTitleEmail] = useState(String(DEFAULT_PAGE_CONTENT.titles.email))
  const [subtitleDemo, setSubtitleDemo] = useState(String(DEFAULT_PAGE_CONTENT.subtitles.demo))
  const [subtitleFeatures, setSubtitleFeatures] = useState(String(DEFAULT_PAGE_CONTENT.subtitles.features))
  const [subtitleTestimonials, setSubtitleTestimonials] = useState(String(DEFAULT_PAGE_CONTENT.subtitles.testimonials))
  const [subtitlePricing, setSubtitlePricing] = useState(String(DEFAULT_PAGE_CONTENT.subtitles.pricing))
  const [subtitleFaq, setSubtitleFaq] = useState(String(DEFAULT_PAGE_CONTENT.subtitles.faq))
  const [subtitleEmail, setSubtitleEmail] = useState(String(DEFAULT_PAGE_CONTENT.subtitles.email))
  const [labelDemo, setLabelDemo] = useState(String(DEFAULT_PAGE_CONTENT.section_labels.demo))
  const [labelFeatures, setLabelFeatures] = useState(String(DEFAULT_PAGE_CONTENT.section_labels.features))
  const [labelTestimonials, setLabelTestimonials] = useState(String(DEFAULT_PAGE_CONTENT.section_labels.testimonials))
  const [labelPricing, setLabelPricing] = useState(String(DEFAULT_PAGE_CONTENT.section_labels.pricing))
  const [labelFaq, setLabelFaq] = useState(String(DEFAULT_PAGE_CONTENT.section_labels.faq))
  const [emailCaptureEnabled, setEmailCaptureEnabled] = useState(true)
  const [emailNote, setEmailNote] = useState(String(DEFAULT_PAGE_CONTENT.email_note))
  const [footerText, setFooterText] = useState(String(DEFAULT_PAGE_CONTENT.footer_text))
  const [footerLinkLabel, setFooterLinkLabel] = useState(String(DEFAULT_PAGE_CONTENT.footer_link_label))
  const [showRevenueDetails, setShowRevenueDetails] = useState(false)
  const [quickBuildTab, setQuickBuildTab] = useState<(typeof QUICK_BUILD_TABS)[number]['key']>('basics')
  const [commerceView, setCommerceView] = useState<(typeof COMMERCE_VIEWS)[number]['key']>('build')
  const [pageSearch, setPageSearch] = useState('')
  const [pageTypeFilter, setPageTypeFilter] = useState<'all' | 'affiliate' | 'sales'>('all')

  const normalizedSiteUrl = siteUrl.trim().replace(/\/+$/, '') || window.location.origin
  const derivedLandingPageUrl = pageSlug.trim() ? `${normalizedSiteUrl}/lp/${encodeURIComponent(pageSlug.trim())}` : ''
  const selectedStarter = AFFILIATE_STARTERS.find(item => item.key === starterKey) || AFFILIATE_STARTERS[0]
  const revenueTotals = revenue?.analytics?.totals
  const visibleQuickBuildTabs = QUICK_BUILD_TABS.filter(tab => tab.key !== 'pricing' || sectionFlags.pricing)
  const pageAnalytics = new Map((revenue?.analytics?.pages || []).map(item => [item.id, item]))
  const filteredLandingPages = useMemo(() => {
    const search = pageSearch.trim().toLowerCase()
    return landingPages.filter(item => {
      const content = (item.content_json || {}) as Record<string, any>
      const sections = (content.sections || {}) as Record<string, boolean>
      const pageKind = sections.pricing !== false ? 'sales' : 'affiliate'
      const matchesType = pageTypeFilter === 'all' || pageKind === pageTypeFilter
      if (!matchesType) return false
      if (!search) return true
      const haystack = [
        item.name || '',
        item.slug || '',
        templateLabel(item.template || 'offer'),
      ].join(' ').toLowerCase()
      return haystack.includes(search)
    })
  }, [landingPages, pageSearch, pageTypeFilter])

  const builtContent = useMemo(() => {
    const features = featuresText
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => {
        const [icon, title, ...rest] = item.split('|')
        return { icon: (icon || '').trim(), title: (title || '').trim(), description: rest.join('|').trim() }
      })
      .filter(item => item.title)

    const testimonials = testimonialsText
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => {
        const [quote, author, stars] = item.split('|')
        return { quote: (quote || '').trim(), author: (author || '').trim(), stars: Number((stars || '5').trim()) || 5 }
      })
      .filter(item => item.quote)

    const howSteps = howStepsText
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => {
        const [title, ...rest] = item.split('|')
        return { title: (title || '').trim(), description: rest.join('|').trim() }
      })
      .filter(item => item.title)

    return {
      brand_name: brandName,
      brand_mark: brandMark,
      hero_tag: heroTag,
      hero_cta_note: heroCtaNote,
      hero_secondary_cta: heroSecondaryCta,
      hero_image_url: heroImageUrl.trim(),
      demo_image_url: demoImageUrl.trim(),
      sections: sectionFlags,
      nav_links: navLinksText
        .split('\n')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
          const [label, href] = item.split('|')
          return { label: (label || '').trim(), href: (href || '').trim() }
        })
        .filter(item => item.label && item.href),
      section_labels: {
        demo: labelDemo,
        features: labelFeatures,
        testimonials: labelTestimonials,
        pricing: labelPricing,
        faq: labelFaq,
      },
      titles: {
        demo: titleDemo,
        features: titleFeatures,
        testimonials: titleTestimonials,
        pricing: titlePricing,
        faq: titleFaq,
        email: titleEmail,
      },
      subtitles: {
        demo: subtitleDemo,
        features: subtitleFeatures,
        testimonials: subtitleTestimonials,
        pricing: subtitlePricing,
        faq: subtitleFaq,
        email: subtitleEmail,
      },
      how_steps: howSteps,
      features,
      testimonials,
      pricing_plans: pricingPlansForm.map(plan => ({
        ...plan,
        features: Array.isArray(plan.features)
          ? plan.features.map(feature => feature.trim()).filter(Boolean)
          : [],
      })),
      email_capture_enabled: emailCaptureEnabled,
      email_note: emailNote,
      footer_text: footerText,
      footer_link_label: footerLinkLabel,
    }
  }, [
    brandMark,
    brandName,
    demoImageUrl,
    emailCaptureEnabled,
    emailNote,
    featuresText,
    footerLinkLabel,
    footerText,
    heroCtaNote,
    heroImageUrl,
    heroSecondaryCta,
    heroTag,
    labelDemo,
    howStepsText,
    labelFaq,
    labelFeatures,
    labelPricing,
    labelTestimonials,
    navLinksText,
    pricingPlansForm,
    sectionFlags,
    subtitleDemo,
    subtitleEmail,
    subtitleFaq,
    subtitleFeatures,
    subtitlePricing,
    subtitleTestimonials,
    testimonialsText,
    titleDemo,
    titleEmail,
    titleFaq,
    titleFeatures,
    titlePricing,
    titleTestimonials,
  ])

  useEffect(() => {
    Promise.all([
      getOffers().then(data => setOffers(Array.isArray(data.items) ? data.items : [])),
      getLandingPages().then(data => setLandingPages(Array.isArray(data.items) ? data.items : [])),
      getCommerceRevenue().then(data => setRevenue(data)),
      getSettings().then(settings => {
        const configuredSiteUrl = settings?.commerce?.site_url?.trim()
        if (configuredSiteUrl) setSiteUrl(configuredSiteUrl)
      }),
    ]).catch(() => setCatalogMsg('Could not load catalog from the commerce API.'))
  }, [])

  useEffect(() => {
    applyStarterPreset(AFFILIATE_STARTERS[0], true)
    // Initial beginner-friendly default.
  }, [])

  useEffect(() => {
    if (!sectionFlags.pricing && quickBuildTab === 'pricing') {
      setQuickBuildTab('basics')
    }
  }, [quickBuildTab, sectionFlags.pricing])

  const reloadCatalog = async () => {
    const [offersData, pagesData] = await Promise.all([getOffers(), getLandingPages()])
    setOffers(Array.isArray(offersData.items) ? offersData.items : [])
    setLandingPages(Array.isArray(pagesData.items) ? pagesData.items : [])
  }

  const loadRevenue = async () => {
    setRevenue(await getCommerceRevenue())
  }

  const resetLandingPageForm = () => {
    setEditingLandingPageId('')
    setPageName('')
    setPageSlug('')
    setPageTemplate('offer')
    setPageHeroTitle('')
    setPageHeroSubtitle('')
    setPageCtaText('Start now')
    setPageCtaLink('https://example.com/offer')
    setPageOfferSummary('')
    setPageBenefits('Clear outcome\nLower friction\nBetter buyer confidence')
    setPageIncludes('Core product or service\nQuick-start guide\nBonus asset\nSupport or next step')
    setPageFaq(DEFAULT_FAQ.map(item => `${item.question} | ${item.answer}`).join('\n'))
    setPageProofPoints('Trusted by focused builders\nClear offer outcomes\nFast Stripe checkout')
    setBrandName(DEFAULT_PAGE_CONTENT.brand_name)
    setBrandMark(DEFAULT_PAGE_CONTENT.brand_mark)
    setHeroTag(DEFAULT_PAGE_CONTENT.hero_tag)
    setHeroCtaNote(DEFAULT_PAGE_CONTENT.hero_cta_note)
    setHeroSecondaryCta(DEFAULT_PAGE_CONTENT.hero_secondary_cta)
    setHeroImageUrl('')
    setDemoImageUrl('')
    setSectionFlags(DEFAULT_PAGE_CONTENT.sections)
    setNavLinksText(DEFAULT_PAGE_CONTENT.nav_links.map(item => `${item.label} | ${item.href}`).join('\n'))
    setHowStepsText(DEFAULT_HOW_STEPS.map(item => `${item.title} | ${item.description}`).join('\n'))
    setFeaturesText(DEFAULT_FEATURES.map(item => `${item.icon} | ${item.title} | ${item.description}`).join('\n'))
    setTestimonialsText(DEFAULT_TESTIMONIALS.map(item => `${item.quote} | ${item.author} | ${item.stars}`).join('\n'))
    setPricingPlansForm(DEFAULT_PRICING)
    setTitleDemo(String(DEFAULT_PAGE_CONTENT.titles.demo))
    setTitleFeatures(String(DEFAULT_PAGE_CONTENT.titles.features))
    setTitleTestimonials(String(DEFAULT_PAGE_CONTENT.titles.testimonials))
    setTitlePricing(String(DEFAULT_PAGE_CONTENT.titles.pricing))
    setTitleFaq(String(DEFAULT_PAGE_CONTENT.titles.faq))
    setTitleEmail(String(DEFAULT_PAGE_CONTENT.titles.email))
    setSubtitleDemo(String(DEFAULT_PAGE_CONTENT.subtitles.demo))
    setSubtitleFeatures(String(DEFAULT_PAGE_CONTENT.subtitles.features))
    setSubtitleTestimonials(String(DEFAULT_PAGE_CONTENT.subtitles.testimonials))
    setSubtitlePricing(String(DEFAULT_PAGE_CONTENT.subtitles.pricing))
    setSubtitleFaq(String(DEFAULT_PAGE_CONTENT.subtitles.faq))
    setSubtitleEmail(String(DEFAULT_PAGE_CONTENT.subtitles.email))
    setLabelDemo(String(DEFAULT_PAGE_CONTENT.section_labels.demo))
    setLabelFeatures(String(DEFAULT_PAGE_CONTENT.section_labels.features))
    setLabelTestimonials(String(DEFAULT_PAGE_CONTENT.section_labels.testimonials))
    setLabelPricing(String(DEFAULT_PAGE_CONTENT.section_labels.pricing))
    setLabelFaq(String(DEFAULT_PAGE_CONTENT.section_labels.faq))
    setEmailCaptureEnabled(true)
    setEmailNote(String(DEFAULT_PAGE_CONTENT.email_note))
    setFooterText(String(DEFAULT_PAGE_CONTENT.footer_text))
    setFooterLinkLabel(String(DEFAULT_PAGE_CONTENT.footer_link_label))
  }

  const loadLandingPageForEdit = (item: LandingPageItem) => {
    const content = (item.content_json || {}) as Record<string, any>
    setCommerceView('build')
    setQuickBuildTab('basics')
    setEditingLandingPageId(item.id)
    setPageName(item.name || '')
    setPageSlug(item.slug || '')
    setPageTemplate(item.template || 'offer')
    setPageHeroTitle(item.hero_title || '')
    setPageHeroSubtitle(item.hero_subtitle || '')
    setPageCtaText(item.cta_text || 'Start now')
    setPageCtaLink(item.cta_link || '')
    setPageOfferSummary(item.offer_summary || '')
    setPageBenefits((item.benefits_json || []).join('\n'))
    setPageIncludes((item.includes_json || []).join('\n'))
    setPageFaq((item.faq_json || []).map((faq) => `${faq.question} | ${faq.answer}`).join('\n'))
    setPageProofPoints((item.proof_json || []).join('\n'))
    setBrandName(String(content.brand_name || DEFAULT_PAGE_CONTENT.brand_name))
    setBrandMark(String(content.brand_mark || DEFAULT_PAGE_CONTENT.brand_mark))
    setHeroTag(String(content.hero_tag || DEFAULT_PAGE_CONTENT.hero_tag))
    setHeroCtaNote(String(content.hero_cta_note || DEFAULT_PAGE_CONTENT.hero_cta_note))
    setHeroSecondaryCta(String(content.hero_secondary_cta || DEFAULT_PAGE_CONTENT.hero_secondary_cta))
    setHeroImageUrl(String(content.hero_image_url || ''))
    setDemoImageUrl(String(content.demo_image_url || ''))
    setSectionFlags({ ...DEFAULT_PAGE_CONTENT.sections, ...(content.sections || {}) })
    setNavLinksText(Array.isArray(content.nav_links) ? content.nav_links.map((link: any) => `${link.label || ''} | ${link.href || ''}`).join('\n') : DEFAULT_PAGE_CONTENT.nav_links.map(item => `${item.label} | ${item.href}`).join('\n'))
    setHowStepsText(Array.isArray(content.how_steps) ? content.how_steps.map((step: any) => `${step.title || ''} | ${step.description || ''}`).join('\n') : DEFAULT_HOW_STEPS.map(item => `${item.title} | ${item.description}`).join('\n'))
    setFeaturesText(Array.isArray(content.features) ? content.features.map((feature: any) => `${feature.icon || ''} | ${feature.title || ''} | ${feature.description || ''}`).join('\n') : DEFAULT_FEATURES.map(item => `${item.icon} | ${item.title} | ${item.description}`).join('\n'))
    setTestimonialsText(Array.isArray(content.testimonials) ? content.testimonials.map((testimonial: any) => `${testimonial.quote || ''} | ${testimonial.author || ''} | ${testimonial.stars || 5}`).join('\n') : DEFAULT_TESTIMONIALS.map(item => `${item.quote} | ${item.author} | ${item.stars}`).join('\n'))
    setPricingPlansForm(Array.isArray(content.pricing_plans) && content.pricing_plans.length ? content.pricing_plans : DEFAULT_PRICING)
    setLabelDemo(String(content.section_labels?.demo || DEFAULT_PAGE_CONTENT.section_labels.demo))
    setLabelFeatures(String(content.section_labels?.features || DEFAULT_PAGE_CONTENT.section_labels.features))
    setLabelTestimonials(String(content.section_labels?.testimonials || DEFAULT_PAGE_CONTENT.section_labels.testimonials))
    setLabelPricing(String(content.section_labels?.pricing || DEFAULT_PAGE_CONTENT.section_labels.pricing))
    setLabelFaq(String(content.section_labels?.faq || DEFAULT_PAGE_CONTENT.section_labels.faq))
    setTitleDemo(String(content.titles?.demo || DEFAULT_PAGE_CONTENT.titles.demo))
    setTitleFeatures(String(content.titles?.features || DEFAULT_PAGE_CONTENT.titles.features))
    setTitleTestimonials(String(content.titles?.testimonials || DEFAULT_PAGE_CONTENT.titles.testimonials))
    setTitlePricing(String(content.titles?.pricing || DEFAULT_PAGE_CONTENT.titles.pricing))
    setTitleFaq(String(content.titles?.faq || DEFAULT_PAGE_CONTENT.titles.faq))
    setTitleEmail(String(content.titles?.email || DEFAULT_PAGE_CONTENT.titles.email))
    setSubtitleDemo(String(content.subtitles?.demo || DEFAULT_PAGE_CONTENT.subtitles.demo))
    setSubtitleFeatures(String(content.subtitles?.features || DEFAULT_PAGE_CONTENT.subtitles.features))
    setSubtitleTestimonials(String(content.subtitles?.testimonials || DEFAULT_PAGE_CONTENT.subtitles.testimonials))
    setSubtitlePricing(String(content.subtitles?.pricing || DEFAULT_PAGE_CONTENT.subtitles.pricing))
    setSubtitleFaq(String(content.subtitles?.faq || DEFAULT_PAGE_CONTENT.subtitles.faq))
    setSubtitleEmail(String(content.subtitles?.email || DEFAULT_PAGE_CONTENT.subtitles.email))
    setEmailCaptureEnabled(Boolean(content.email_capture_enabled ?? true))
    setEmailNote(String(content.email_note || DEFAULT_PAGE_CONTENT.email_note))
    setFooterText(String(content.footer_text || DEFAULT_PAGE_CONTENT.footer_text))
    setFooterLinkLabel(String(content.footer_link_label || DEFAULT_PAGE_CONTENT.footer_link_label))
    setCatalogMsg(`Editing landing page: ${item.name}`)
  }

  const applyStarterPreset = (starter = selectedStarter, forceReplace = false) => {
    const currentOfferName = forceReplace ? '' : offerName.trim()
    const currentPageName = forceReplace ? '' : pageName.trim()
    const currentPageSlug = forceReplace ? '' : pageSlug.trim()
    const currentCheckoutUrl = forceReplace ? '' : (offerCheckoutUrl || pageCtaLink).trim()
    const isSalesStarter = starter.kind === 'sales'
    const isEbookStarter = starter.kind === 'ebook'
    const starterName = currentOfferName || currentPageName || starter.label
    const starterSlug = slugify(currentPageSlug || currentPageName || currentOfferName || starter.label)
    setStarterKey(starter.key)
    setPageTemplate(starter.template)
    setPageName(currentPageName || starterName)
    setOfferName(currentOfferName || starterName)
    setPageSlug(starterSlug)
    setPageHeroTitle(starter.heroTitle)
    setPageHeroSubtitle(starter.heroSubtitle)
    setPageCtaText(starter.ctaText)
    setOfferCheckoutUrl(currentCheckoutUrl || 'https://example.com/offer')
    setPageOfferSummary(starter.offerSummary)
    setPageBenefits(starter.benefits.join('\n'))
    setPageIncludes(starter.includes.join('\n'))
    setPageProofPoints(starter.proofPoints.join('\n'))
    setPageFaq(DEFAULT_FAQ.map(item => `${item.question} | ${item.answer}`).join('\n'))
    setSectionFlags({
      hero: true,
      how: starter.key !== 'resources',
      demo: false,
      features: true,
      testimonials: starter.key !== 'comparison',
      pricing: isSalesStarter || isEbookStarter,
      faq: true,
      email: isEbookStarter,
    })
    setHeroTag(isEbookStarter ? 'Free download' : isSalesStarter ? 'Sales page starter' : 'Affiliate page starter')
    setHeroCtaNote(isEbookStarter ? 'Instant PDF download' : isSalesStarter ? 'Direct checkout path' : 'Simple tracked outbound click')
    setHeroSecondaryCta(isEbookStarter ? 'See what is inside' : isSalesStarter ? 'See pricing' : 'Learn more')
    setBrandName(DEFAULT_PAGE_CONTENT.brand_name)
    setBrandMark(DEFAULT_PAGE_CONTENT.brand_mark)
    setTitleFeatures(
      isEbookStarter
        ? "What's inside this guide"
        : starter.key === 'comparison'
          ? 'What to compare before choosing'
          : isSalesStarter
            ? 'Why this offer is worth buying'
            : 'What to know before you click through'
    )
    setSubtitleFeatures(
      isEbookStarter
        ? 'Give readers a clear picture of what they will learn and why it is worth downloading.'
        : isSalesStarter
          ? 'Keep this short. New visitors should understand the offer and outcome in under 30 seconds.'
          : 'Keep this short. New visitors should understand the recommendation in under 30 seconds.'
    )
    setTitleTestimonials(isEbookStarter ? 'Readers love this guide' : isSalesStarter ? 'Proof that this offer works' : 'Why this recommendation is worth attention')
    setSubtitleTestimonials(
      isEbookStarter
        ? 'Share real feedback from people who read it and took action.'
        : isSalesStarter
          ? 'Use outcomes, buyer wins, and credibility signals that reduce hesitation before checkout.'
          : 'Use proof, outcomes, or reviewer-style notes that reduce hesitation.'
    )
    setTitleFaq(isEbookStarter ? 'Questions about the ebook' : isSalesStarter ? 'Questions before someone buys' : 'Questions before someone leaves your site')
    setSubtitleFaq(
      isEbookStarter
        ? 'Clear up format questions, delivery, refunds, and who this is really for.'
        : isSalesStarter
          ? 'Answer the objections that would otherwise block the purchase.'
          : 'Answer the objections that would otherwise block the click.'
    )
    setPricingPlansForm(
      isEbookStarter
        ? [
            {
              name: 'Free Download',
              price: 'Free',
              price_suffix: '',
              description: 'Get instant access to the full ebook at no cost.',
              features: ['Full PDF guide', 'Instant download', 'No credit card required'],
              cta: 'Download now',
              featured: false,
              badge: '',
              link: currentCheckoutUrl || '',
            },
            {
              name: 'Ebook + Extras',
              price: '$27',
              price_suffix: '',
              description: 'The ebook plus bonus templates, checklists, or companion resources.',
              features: ['Full PDF guide', 'Bonus templates', 'Checklists included', 'Lifetime access'],
              cta: 'Get the bundle',
              featured: true,
              badge: 'Best value',
              link: currentCheckoutUrl || '',
            },
          ]
        : isSalesStarter
          ? DEFAULT_PRICING.map((plan, index) => ({
              ...plan,
              name: index === 0 ? 'Starter' : index === 1 ? 'Core Offer' : 'Premium',
              cta: starter.ctaText,
              link: currentCheckoutUrl || '',
            }))
        : starter.key === 'comparison'
          ? [
              {
                name: 'Option A',
                price: '',
                price_suffix: '',
                description: 'First option in the comparison.',
                features: ['Best for ...', 'Main strength', 'Tradeoff'],
                cta: 'Visit option A',
                featured: false,
                badge: '',
                link: '',
              },
              {
                name: 'Option B',
                price: '',
                price_suffix: '',
                description: 'Second option in the comparison.',
                features: ['Best for ...', 'Main strength', 'Tradeoff'],
                cta: 'Visit option B',
                featured: true,
                badge: 'Recommended',
                link: '',
              },
              {
                name: 'Option C',
                price: '',
                price_suffix: '',
                description: 'Optional third option.',
                features: ['Best for ...', 'Main strength', 'Tradeoff'],
                cta: 'Visit option C',
                featured: false,
                badge: '',
                link: '',
              },
            ]
          : starter.key === 'resources'
            ? [
                {
                  name: 'Tool 1',
                  price: '',
                  price_suffix: '',
                  description: 'Short note on what this tool does.',
                  features: ['Who it is for', 'Why it helps'],
                  cta: 'Open tool',
                  featured: false,
                  badge: '',
                  link: '',
                },
                {
                  name: 'Tool 2',
                  price: '',
                  price_suffix: '',
                  description: 'Short note on what this tool does.',
                  features: ['Who it is for', 'Why it helps'],
                  cta: 'Open tool',
                  featured: false,
                  badge: '',
                  link: '',
                },
                {
                  name: 'Tool 3',
                  price: '',
                  price_suffix: '',
                  description: 'Short note on what this tool does.',
                  features: ['Who it is for', 'Why it helps'],
                  cta: 'Open tool',
                  featured: false,
                  badge: '',
                  link: '',
                },
              ]
            : [{
                name: 'Primary recommendation',
                price: '',
                price_suffix: '',
                description: 'Use this card as a simple recommendation block.',
                features: [...starter.includes],
                cta: starter.ctaText,
                featured: true,
                badge: 'Recommended',
                link: currentCheckoutUrl || '',
              }]
    )
  }

  const saveStarterPage = async () => {
    const wasEditing = Boolean(editingLandingPageId)
    const pageNameValue = pageName.trim() || offerName.trim()
    const pageSlugValue = slugify(pageSlug || pageNameValue)
    const checkoutLink = (offerCheckoutUrl || pageCtaLink).trim()
    if (!pageNameValue || !pageSlugValue || !pageHeroTitle.trim() || !checkoutLink) {
      setCatalogMsg('Add a page name, slug, headline, and destination link before creating the starter page.')
      return
    }

    if (pageSlugValue !== pageSlug) setPageSlug(pageSlugValue)
    if (checkoutLink !== pageCtaLink) setPageCtaLink(checkoutLink)
    if (checkoutLink !== offerCheckoutUrl) setOfferCheckoutUrl(checkoutLink)

    const payload = {
      id: editingLandingPageId || undefined,
      name: pageNameValue,
      slug: pageSlugValue,
      url: `${normalizedSiteUrl}/lp/${encodeURIComponent(pageSlugValue)}`,
      template: pageTemplate,
      content: builtContent,
      hero_title: pageHeroTitle,
      hero_subtitle: pageHeroSubtitle,
      cta_text: pageCtaText,
      cta_link: checkoutLink,
      offer_summary: pageOfferSummary,
      benefits: parseTextList(pageBenefits),
      includes: parseTextList(pageIncludes),
      faq_items: parseFaq(pageFaq),
      proof_points: parseTextList(pageProofPoints),
      theme: {},
    }

    const pageResult = editingLandingPageId
      ? await updateLandingPage(editingLandingPageId, payload)
      : await createLandingPage(payload)

    if (!pageResult.item) {
      setCatalogMsg(pageResult.error || 'Starter page save failed.')
      return
    }

    let message = `Landing page ${wasEditing ? 'updated' : 'created'}: ${pageResult.item.name}`
    const existingOffer = offers.find(item => item.landing_page_id === pageResult.item?.id)
    if (!wasEditing && !existingOffer) {
      const offerResult = await createOffer({
        name: offerName.trim() || pageNameValue,
        checkout_url: checkoutLink,
        landing_page_id: pageResult.item.id,
      })
      if (offerResult.item) {
        message = `${message}. Offer linked: ${offerResult.item.name}`
      }
    }

    setEditingLandingPageId(pageResult.item.id)
    setCatalogMsg(message)
    await reloadCatalog()
    if (!wasEditing) {
      setCommerceView('pages')
    }
  }

  const toggleSection = (key: keyof typeof DEFAULT_PAGE_CONTENT.sections) => {
    setSectionFlags(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const updatePricingPlan = (index: number, key: keyof (typeof DEFAULT_PRICING)[number], value: string | boolean | string[]) => {
    setPricingPlansForm(prev => prev.map((plan, planIndex) => (
      planIndex === index ? { ...plan, [key]: value } : plan
    )))
  }

  const removePage = async (item: LandingPageItem) => {
    const confirmed = window.confirm(`Delete landing page "${item.name}"? This will also remove linked offer records.`)
    if (!confirmed) return
    const result = await deleteLandingPage(item.id)
    if (!result?.ok) {
      setCatalogMsg(result?.error || 'Landing page delete failed.')
      return
    }
    if (editingLandingPageId === item.id) {
      resetLandingPageForm()
      setEditingLandingPageId('')
    }
    setCatalogMsg(`Deleted landing page: ${item.name}`)
    await reloadCatalog()
    await loadRevenue()
  }

  const copyPageAffiliateLink = async (item: LandingPageItem) => {
    const value = `${normalizedSiteUrl}/lp/${encodeURIComponent(item.slug || '')}`.trim()
    if (!value) {
      setCatalogMsg(`No link available to copy for: ${item.name}`)
      return
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const input = document.createElement('textarea')
        input.value = value
        input.setAttribute('readonly', 'true')
        input.style.position = 'absolute'
        input.style.left = '-9999px'
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
      }
      setCatalogMsg(`Copied affiliate link for: ${item.name}`)
    } catch {
      setCatalogMsg(`Could not copy affiliate link for: ${item.name}`)
    }
  }

  return (
    <div className="panel-shell">
      <div className="panel-stack">
        <div className="card">
          <div className="title-row">
            <div className="panel-stack">
              <div className="section-title">Commerce</div>
              <div className="panel-title">Starter sales and affiliate pages</div>
              <div className="muted-copy" style={{ maxWidth: 760, lineHeight: 1.6 }}>
                Build the page first, then manage links and performance after it exists.
                This screen now separates page creation, page management, and revenue so beginners do not have to process everything at once.
              </div>
            </div>
            <div className="inline-wrap">
              {COMMERCE_VIEWS.map(view => (
                <button
                  key={view.key}
                  type="button"
                  className={commerceView === view.key ? 'btn-primary' : 'btn-ghost'}
                  onClick={() => setCommerceView(view.key)}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-label">Landing Pages</div>
            <div className="summary-value">{landingPages.length}</div>
            <div className="muted-copy">Tracked commerce destinations</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Offers</div>
            <div className="summary-value">{offers.length}</div>
            <div className="muted-copy">Products, services, or tracked destinations</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">CTA Clicks</div>
            <div className="summary-value">{revenueTotals?.cta_clicks || 0}</div>
            <div className="muted-copy">Tracked across posts and landing pages</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Revenue</div>
            <div className="summary-value">${((revenue?.totals?.totalRevenueCents || 0) / 100).toFixed(0)}</div>
            <div className="muted-copy">From the commerce tracking service</div>
          </div>
        </div>

        {commerceView === 'build' && (
        <div className="panel-grid">
          <div className="card">
            <div className="section-title">Pick A Starter Page</div>
            <div className="muted-copy" style={{ marginBottom: 14 }}>
              Pick the page type first. The form on the right updates to match it.
            </div>
            <div className="panel-stack">
              {AFFILIATE_STARTERS.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setEditingLandingPageId('')
                    setCatalogMsg('')
                    applyStarterPreset(item, true)
                  }}
                  style={{
                    textAlign: 'left',
                    padding: 14,
                    borderColor: starterKey === item.key ? 'var(--accent)' : 'var(--border)',
                    background: starterKey === item.key ? 'rgba(88,166,255,.08)' : 'transparent',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{item.note}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="section-title">Quick Build</div>
            <div style={{ marginBottom: 12, color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
              Current starter: <strong style={{ color: 'var(--text)' }}>{selectedStarter.label}</strong>. Fill the basics, adjust the content you want, then create the page.
            </div>
            {editingLandingPageId ? (
              <div style={{ marginBottom: 12, padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(88,166,255,.06)', fontSize: 13 }}>
                You are editing an existing landing page. Save to update it, or start fresh to build a new one.
              </div>
            ) : null}
            <div className="inline-wrap" style={{ marginBottom: 14 }}>
              {visibleQuickBuildTabs.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  className={quickBuildTab === tab.key ? 'btn-primary' : 'btn-ghost'}
                  onClick={() => setQuickBuildTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {quickBuildTab === 'basics' && (
              <div className="panel-stack">
                <div className="control-grid">
                  <div>
                    <label>Page Name</label>
                    <input value={pageName} onChange={e => {
                      setPageName(e.target.value)
                      if (!offerName.trim()) setOfferName(e.target.value)
                      if (!pageSlug.trim()) setPageSlug(slugify(e.target.value))
                    }} placeholder="My favorite focus tool" />
                  </div>
                  <div>
                    <label>Offer Name</label>
                    <input value={offerName} onChange={e => setOfferName(e.target.value)} placeholder="Focus Tool offer" />
                  </div>
                  <div>
                    <label>Slug</label>
                    <input value={pageSlug} onChange={e => setPageSlug(slugify(e.target.value))} placeholder="focus-tool-review" />
                  </div>
                  <div>
                    <label>Button Text</label>
                    <input value={pageCtaText} onChange={e => setPageCtaText(e.target.value)} placeholder="Check price" />
                  </div>
                </div>
                <label>Headline</label>
                <input value={pageHeroTitle} onChange={e => setPageHeroTitle(e.target.value)} placeholder="Why I recommend this tool" />
                <label>Subtitle</label>
                <textarea value={pageHeroSubtitle} onChange={e => setPageHeroSubtitle(e.target.value)} rows={3} style={{ resize: 'vertical' }} placeholder="Short explanation of who this helps and why the click is worth it." />
                <label>Destination Or Checkout Link</label>
                <input value={offerCheckoutUrl || pageCtaLink} onChange={e => {
                  setOfferCheckoutUrl(e.target.value)
                  setPageCtaLink(e.target.value)
                }} placeholder="https://..." />
                <label>Short Offer Summary</label>
                <textarea value={pageOfferSummary} onChange={e => setPageOfferSummary(e.target.value)} rows={3} style={{ resize: 'vertical' }} placeholder="One short paragraph on why this offer matters." />
              </div>
            )}
            {quickBuildTab === 'pricing' && (
              <div className="panel-stack">
                <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
                  Use this for sales pages, subscriptions, or any page that needs named pricing options. For affiliate pages, you can leave pricing turned off.
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={sectionFlags.pricing}
                    onChange={() => {
                      const nextValue = !sectionFlags.pricing
                      toggleSection('pricing')
                      if (nextValue) setQuickBuildTab('pricing')
                    }}
                  />
                  Show pricing on this page
                </label>
                {sectionFlags.pricing ? (
                  <div className="panel-stack">
                    {pricingPlansForm.map((plan, index) => (
                      <div key={`${plan.name}-${index}`} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, display: 'grid', gap: 8 }}>
                        <div style={{ fontWeight: 700 }}>Plan {index + 1}</div>
                        <div className="control-grid">
                          <div>
                            <label>Name</label>
                            <input value={plan.name} onChange={e => updatePricingPlan(index, 'name', e.target.value)} />
                          </div>
                          <div>
                            <label>Price</label>
                            <input value={plan.price} onChange={e => updatePricingPlan(index, 'price', e.target.value)} placeholder="$29" />
                          </div>
                          <div>
                            <label>Suffix</label>
                            <input value={plan.price_suffix} onChange={e => updatePricingPlan(index, 'price_suffix', e.target.value)} placeholder="/ month" />
                          </div>
                          <div>
                            <label>Button Text</label>
                            <input value={plan.cta} onChange={e => updatePricingPlan(index, 'cta', e.target.value)} />
                          </div>
                        </div>
                        <label>Description</label>
                        <input value={plan.description} onChange={e => updatePricingPlan(index, 'description', e.target.value)} />
                        <label>Plan Features</label>
                        <textarea value={plan.features.join('\n')} onChange={e => updatePricingPlan(index, 'features', e.target.value.split('\n'))} rows={4} style={{ resize: 'vertical' }} />
                        <label>Plan Link</label>
                        <input value={plan.link || ''} onChange={e => updatePricingPlan(index, 'link', e.target.value)} placeholder="https://checkout-or-payment-link" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted-copy">Pricing is currently hidden for this page. Turn it on if this page should sell directly.</div>
                )}
              </div>
            )}
            {quickBuildTab === 'content' && (
              <div className="panel-stack">
                <div className="inline-wrap">
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
                    <input type="checkbox" checked={sectionFlags.how} onChange={() => toggleSection('how')} />
                    Show how-it-works
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
                    <input type="checkbox" checked={sectionFlags.testimonials} onChange={() => toggleSection('testimonials')} />
                    Show testimonials
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
                    <input type="checkbox" checked={sectionFlags.faq} onChange={() => toggleSection('faq')} />
                    Show FAQ
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
                    <input
                      type="checkbox"
                      checked={sectionFlags.pricing}
                      onChange={() => {
                        const nextValue = !sectionFlags.pricing
                        toggleSection('pricing')
                        if (nextValue) setQuickBuildTab('pricing')
                      }}
                    />
                    Show pricing
                  </label>
                </div>
                <label>Benefits</label>
                <textarea value={pageBenefits} onChange={e => setPageBenefits(e.target.value)} rows={4} style={{ resize: 'vertical' }} />
                <label>What&apos;s Included</label>
                <textarea value={pageIncludes} onChange={e => setPageIncludes(e.target.value)} rows={4} style={{ resize: 'vertical' }} />
                <label>Proof Points</label>
                <textarea value={pageProofPoints} onChange={e => setPageProofPoints(e.target.value)} rows={4} style={{ resize: 'vertical' }} />
                <label>Testimonials</label>
                <textarea value={testimonialsText} onChange={e => setTestimonialsText(e.target.value)} rows={5} style={{ resize: 'vertical' }} />
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>One per line: `quote | author | stars`</div>
                <label>FAQ Items</label>
                <textarea value={pageFaq} onChange={e => setPageFaq(e.target.value)} rows={5} style={{ resize: 'vertical' }} />
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>One per line: `Question | Answer`</div>
              </div>
            )}
            <div className="inline-wrap">
              <button className="btn-success" onClick={saveStarterPage}>
                {editingLandingPageId ? 'Update starter page' : 'Create starter page'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCommerceView('pages')}>
                View landing pages
              </button>
              <button type="button" className="btn-ghost" onClick={() => applyStarterPreset(selectedStarter, true)}>
                Reload starter defaults
              </button>
              <button type="button" className="btn-ghost" onClick={() => {
                resetLandingPageForm()
                setEditingLandingPageId('')
                setCatalogMsg('')
                applyStarterPreset(selectedStarter, true)
              }}>
                Start fresh
              </button>
              {derivedLandingPageUrl ? (
                <a
                  href={derivedLandingPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', minHeight: 36 }}
                >
                  Preview page
                </a>
              ) : null}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
              Page path: {pageSlug.trim() ? `/lp/${pageSlug.trim()}` : 'set a slug to generate the page path'}
            </div>
            {catalogMsg && <div style={{ marginTop: 10, fontSize: 12, color: catalogMsg.includes('failed') || catalogMsg.includes('Could not') ? '#f85149' : '#3fb950' }}>{catalogMsg}</div>}
          </div>
        </div>
        )}

        {commerceView === 'pages' && (
        <div className="card">
          <div className="section-title">Landing Pages</div>
          <div className="muted-copy" style={{ marginBottom: 14, fontSize: 13, lineHeight: 1.6 }}>
            Open an existing page to edit it, copy its public link, or check its performance and stored destination links.
          </div>
          <div className="control-grid" style={{ marginBottom: 14 }}>
            <div>
              <label>Search Pages</label>
              <input value={pageSearch} onChange={e => setPageSearch(e.target.value)} placeholder="Search by page name or slug" />
            </div>
            <div>
              <label>Page Type</label>
              <select value={pageTypeFilter} onChange={e => setPageTypeFilter(e.target.value as 'all' | 'affiliate' | 'sales')}>
                <option value="all">All page types</option>
                <option value="affiliate">Affiliate pages</option>
                <option value="sales">Sales pages</option>
              </select>
            </div>
          </div>
          <div className="inline-wrap" style={{ marginBottom: 14 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                resetLandingPageForm()
                setCatalogMsg('')
                setEditingLandingPageId('')
                applyStarterPreset(selectedStarter, true)
                setCommerceView('build')
              }}
            >
              Create new page
            </button>
          </div>
          {landingPages.length === 0 ? (
            <div className="muted-copy">No pages yet. Create one from a starter.</div>
          ) : (
            <div className="panel-stack">
              {filteredLandingPages.length === 0 ? (
                <div className="muted-copy">No pages match the current search or filter.</div>
              ) : filteredLandingPages.map(item => {
                const content = (item.content_json || {}) as Record<string, any>
                const sections = (content.sections || {}) as Record<string, boolean>
                const pageKindLabel = sections.pricing !== false ? 'sales' : 'affiliate'
                const links = [
                  ...(item.cta_link ? [{ label: item.cta_text || 'Primary CTA', url: item.cta_link, kind: sections.pricing !== false ? 'checkout' : 'primary' }] : []),
                  ...((Array.isArray(content.pricing_plans) ? content.pricing_plans : [])
                    .map((plan: any, index: number) => ({
                      label: String(plan.name || `Link ${index + 1}`),
                      url: String(plan.link || '').trim(),
                      kind: sections.pricing !== false ? 'plan' : 'affiliate',
                    }))
                    .filter(link => link.url)),
                ]
                const analytics = pageAnalytics.get(item.id)
                const isActive = editingLandingPageId === item.id
                return (
                  <div key={item.id} style={{ padding: 14, border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, display: 'grid', gap: 12 }}>
                    <div className="title-row">
                      <div className="panel-stack" style={{ gap: 4 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 700 }}>{item.name}</div>
                          <span className="badge badge-gray">{pageKindLabel}</span>
                        </div>
                        <div className="muted-copy" style={{ fontSize: 12 }}>
                          {templateLabel(item.template || 'offer')} - /lp/{item.slug}
                        </div>
                      </div>
                      <div className="inline-wrap">
                        <a href={`${normalizedSiteUrl}/lp/${encodeURIComponent(item.slug)}`} target="_blank" rel="noreferrer" className="btn-ghost" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 36 }}>
                          Open page
                        </a>
                        <button type="button" className="btn-ghost" onClick={() => loadLandingPageForEdit(item)}>
                          Edit
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => void removePage(item)}>
                          Delete
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => void copyPageAffiliateLink(item)}
                        >
                          Copy affiliate link
                        </button>
                      </div>
                    </div>

                    <div className="summary-grid">
                      <div className="summary-card">
                        <div className="summary-label">Visits</div>
                        <div className="summary-value summary-value-sm">{analytics?.visits || 0}</div>
                      </div>
                      <div className="summary-card">
                        <div className="summary-label">Clicks</div>
                        <div className="summary-value summary-value-sm">{analytics?.clicks || 0}</div>
                      </div>
                      <div className="summary-card">
                        <div className="summary-label">Checkouts</div>
                        <div className="summary-value summary-value-sm">{analytics?.checkout_started || 0}</div>
                      </div>
                      <div className="summary-card">
                        <div className="summary-label">Sales</div>
                        <div className="summary-value summary-value-sm">{analytics?.purchases || 0}</div>
                      </div>
                      <div className="summary-card">
                        <div className="summary-label">Revenue</div>
                        <div className="summary-value summary-value-sm">${(((analytics?.revenue_cents || 0) as number) / 100).toFixed(2)}</div>
                      </div>
                    </div>

                    <div className="panel-stack" style={{ gap: 8 }}>
                      <div className="section-title" style={{ marginBottom: 0 }}>
                        {sections.pricing !== false ? 'Checkout Links' : 'Affiliate Links'}
                      </div>
                      {links.length === 0 ? (
                        <div className="muted-copy" style={{ fontSize: 13 }}>
                          No links stored on this page yet. Open `Edit` to add them.
                        </div>
                      ) : (
                        <div className="panel-stack" style={{ gap: 8 }}>
                          {links.map((link, index) => (
                            <div key={`${link.label}-${index}`} style={{ display: 'grid', gap: 4, padding: 10, border: '1px solid var(--border)', borderRadius: 10 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <strong>{link.label}</strong>
                                <span className="badge badge-gray">{link.kind}</span>
                              </div>
                              <a href={link.url} target="_blank" rel="noreferrer" style={{ color: '#58a6ff', wordBreak: 'break-all', fontSize: 12 }}>
                                {link.url}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )}

      {commerceView === 'revenue' && (
      <div className="card">
        <div className="section-title">Revenue Attribution</div>
        <div className="muted-copy" style={{ marginBottom: 12 }}>
          Use this view to check commerce totals and see which landing pages are producing clicks and revenue.
        </div>
        <div className="inline-wrap" style={{ marginBottom: 12 }}>
          <button className="btn-ghost" onClick={loadRevenue}>Refresh Revenue</button>
          <button type="button" className="btn-ghost" onClick={() => setShowRevenueDetails(value => !value)}>
            {showRevenueDetails ? 'Hide details' : 'Show details'}
          </button>
        </div>
        {!revenue ? (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>Load the Node commerce revenue summary.</div>
        ) : revenue.error ? (
          <div style={{ color: '#f85149', fontSize: 12 }}>{revenue.error}</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>Revenue</div>
                <strong>${((revenue.totals?.totalRevenueCents || 0) / 100).toFixed(2)}</strong>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>Orders</div>
                <strong>{revenue.totals?.orderCount || 0}</strong>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>Subscriptions</div>
                <strong>{revenue.totals?.subscriptionCount || 0}</strong>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>Page Visits</div>
                <strong>{revenue.analytics?.totals.page_views || 0}</strong>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>CTA Clicks</div>
                <strong>{revenue.analytics?.totals.cta_clicks || 0}</strong>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>Checkout Starts</div>
                <strong>{revenue.analytics?.totals.checkout_started || 0}</strong>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>Purchases</div>
                <strong>{revenue.analytics?.totals.purchases || 0}</strong>
              </div>
            </div>
            {showRevenueDetails && (revenue.timeline?.length || 0) > 0 && (
              <div>
                <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>Monthly Revenue</div>
                <table>
                  <thead><tr><th>Month</th><th>Revenue</th><th>Orders</th></tr></thead>
                  <tbody>
                    {(revenue.timeline || []).map(item => (
                      <tr key={item.month}>
                        <td>{item.month}</td>
                        <td>${((item.revenue_cents || 0) / 100).toFixed(2)}</td>
                        <td>{item.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {showRevenueDetails && (revenue.analytics?.pages?.length || 0) > 0 && (
              <div>
                <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>Top Landing Pages</div>
                <table>
                  <thead><tr><th>Page</th><th>Visits</th><th>Clicks</th><th>Revenue</th></tr></thead>
                  <tbody>
                    {(revenue.analytics?.pages || []).slice(0, 6).map(page => (
                      <tr key={page.id}>
                        <td>{page.name || page.slug}</td>
                        <td>{page.visits}</td>
                        <td>{page.clicks}</td>
                        <td>${((page.revenue_cents || 0) / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      )}
      </div>
    </div>
  )
}
