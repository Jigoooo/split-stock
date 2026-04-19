export const feeSettingsKeys = {
  all: ['fees'] as const,
  list: () => [...feeSettingsKeys.all, 'list'] as const,
  detail: (env: 'real' | 'mock') => [...feeSettingsKeys.all, 'detail', env] as const,
} as const;
