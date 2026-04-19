export const protectionLimitsKeys = {
  all: ['protection'] as const,
  detail: (accountId: number) => [...protectionLimitsKeys.all, 'detail', accountId] as const,
} as const;
