export const SYSTEM_TEMPLATES = [
  {
    id: 'system-blog-outline',
    template_kind: 'blog_post',
    scope: 'system',
    visibility: 'marketplace',
    name: 'Authority Blog Outline',
    description: 'SEO-ready blog structure with problem, proof, framework, CTA.',
    body_template: `Title: {{title}}

Intro hook
Problem framing
Three key takeaways
Proof or case study
Action steps
CTA: {{cta_label}} -> {{cta_url}}`,
    config: { tone: 'authoritative', sections: ['hook', 'problem', 'framework', 'proof', 'cta'] },
    tags: ['seo', 'blog', 'long-form'],
  },
  {
    id: 'system-youtube-description',
    template_kind: 'youtube_description',
    scope: 'system',
    visibility: 'marketplace',
    name: 'YouTube Conversion Description',
    description: 'Description block optimized for retention and offer clickthrough.',
    body_template: `Hook: {{hook}}

What this video covers:
- {{point_one}}
- {{point_two}}
- {{point_three}}

Offer:
{{offer_name}} -> {{landing_page_url}}

CTA:
{{cta_label}}`,
    config: { include_timestamps: true, include_offer_block: true },
    tags: ['youtube', 'description', 'conversion'],
  },
  {
    id: 'system-tiktok-script',
    template_kind: 'tiktok_script',
    scope: 'system',
    visibility: 'marketplace',
    name: 'TikTok Hook Script',
    description: 'Fast hook, proof, and single CTA for short-form video.',
    body_template: `Hook in first 2 seconds: {{hook}}
Pattern interrupt
One lesson
One proof point
CTA: {{cta_label}}`,
    config: { duration_seconds: 30, style: 'short-form' },
    tags: ['tiktok', 'script', 'short-form'],
  },
  {
    id: 'system-cta-block',
    template_kind: 'cta_block',
    scope: 'system',
    visibility: 'marketplace',
    name: 'Problem To Offer CTA',
    description: 'Reusable CTA block for blog and social content.',
    body_template: `If {{problem_statement}}, use {{offer_name}}.
CTA label: {{cta_label}}
CTA URL: {{cta_url}}`,
    config: { placement: 'end_of_content' },
    tags: ['cta', 'offer'],
  },
  {
    id: 'system-landing-page',
    template_kind: 'landing_page',
    scope: 'system',
    visibility: 'marketplace',
    name: 'Offer Landing Skeleton',
    description: 'Hero, proof, value stack, FAQ, CTA.',
    body_template: `Hero: {{headline}}
Subheadline: {{subheadline}}
Proof: {{proof}}
Value stack: {{value_stack}}
FAQ: {{faq}}
CTA: {{cta_label}}`,
    config: { sections: ['hero', 'proof', 'benefits', 'faq', 'cta'] },
    tags: ['landing-page', 'offer'],
  },
  {
    id: 'system-workflow-preset',
    template_kind: 'workflow_preset',
    scope: 'system',
    visibility: 'marketplace',
    name: 'Content To Social Launch',
    description: 'Blog, short video, social post, CTA, and scheduled publish path.',
    body_template: `Workflow preset for {{campaign_name}}`,
    config: {
      steps: ['blog_post', 'video_script', 'social_caption', 'cta_block', 'publish_schedule'],
      approvals_required: ['review', 'publish'],
    },
    tags: ['workflow', 'preset', 'launch'],
  },
  {
    id: 'system-content-preset',
    template_kind: 'content_preset',
    scope: 'system',
    visibility: 'marketplace',
    name: 'Thought Leadership Preset',
    description: 'Tone, CTA style, and publishing profile for expert-led brands.',
    body_template: `Preset for {{brand_name}}`,
    config: {
      tone: 'expert',
      cta_style: 'consultative',
      platforms: ['linkedin', 'youtube', 'wordpress'],
    },
    tags: ['preset', 'brand'],
  },
]
