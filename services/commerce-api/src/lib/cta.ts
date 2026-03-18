export type Platform = 'wordpress' | 'youtube' | 'instagram' | 'tiktok' | 'facebook' | 'x' | 'linkedin'

export interface CtaPreviewInput {
  platform: Platform
  cta_text: string
  cta_link: string
  cta_type: string
  pinned_comment_enabled?: boolean
}

export function previewCta(input: CtaPreviewInput) {
  const text = input.cta_text.trim()
  const link = input.cta_link.trim()

  switch (input.platform) {
    case 'wordpress':
      return { primary: `${text}: ${link}` }
    case 'youtube':
      return {
        primary: `${text}\n${link}`,
        pinned_comment: input.pinned_comment_enabled ? `${text}\n${link}` : undefined,
      }
    case 'instagram':
    case 'tiktok':
      return {
        primary: `${text}. Link in bio.`,
        bio_hint: `${text} - link in bio`,
      }
    case 'facebook':
      return { primary: `${text} ${link}` }
    case 'x':
      return {
        primary: input.cta_type === 'reply_cta' ? text : `${text} ${link}`,
        pinned_comment: input.cta_type === 'reply_cta' ? `${text} ${link}` : undefined,
      }
    default:
      return { primary: `${text} ${link}` }
  }
}

