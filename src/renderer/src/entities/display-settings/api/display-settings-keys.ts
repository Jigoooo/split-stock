export const displaySettingsKeys = {
  all: ['display'] as const,
  settings: () => [...displaySettingsKeys.all, 'settings'] as const,
} as const;
