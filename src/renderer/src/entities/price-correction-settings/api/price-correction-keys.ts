export const priceCorrectionKeys = {
  all: ['priceCorrection'] as const,
  settings: () => [...priceCorrectionKeys.all, 'settings'] as const,
} as const;
