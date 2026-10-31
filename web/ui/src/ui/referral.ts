export const REFERRAL_SOURCES = [
  { value: 'friend_colleague', label: 'From a friend / colleague' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'news_article', label: 'News Article' },
  { value: 'google', label: 'Google' },
  { value: 'claude', label: 'Claude' },
  { value: 'chatgpt', label: 'Chat GPT' },
  { value: 'other', label: 'Other' },
] as const;

export type ReferralSource = typeof REFERRAL_SOURCES[number]['value'];

export interface ReferralAnswer {
  source: ReferralSource;
  otherText: string | null;
}

const SOURCES = new Set<string>(REFERRAL_SOURCES.map(({ value }) => value));

export function validateReferral(source: string, otherText: string):
  { valid: true; answer: ReferralAnswer } | { valid: false; message: string } {
  if (!SOURCES.has(source)) return { valid: false, message: 'Choose how you heard about us.' };
  const detail = otherText.trim();
  if (source === 'other' && !detail) return { valid: false, message: 'Tell us where you heard about us.' };
  if (detail.length > 200) return { valid: false, message: 'Keep your answer to 200 characters or fewer.' };
  return {
    valid: true,
    answer: { source: source as ReferralSource, otherText: source === 'other' ? detail : null },
  };
}
