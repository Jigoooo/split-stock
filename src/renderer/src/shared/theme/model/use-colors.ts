export type SemanticColors = {
  bg: {
    base: string;
    elevated: string;
    subtle: string;
    input: string;
    overlay: string;
    overlayHover: string;
    inverse: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    onBrand: string;
    inverse: string;
    disabled: string;
  };
  border: {
    default: string;
    input: string;
    focus: string;
    inverse: string;
  };
  interactive: {
    primary: string;
    primaryHover: string;
    primaryActive: string;
    primarySurface: string;
  };
  feedback: {
    success: string;
    error: string;
    warning: string;
    info: string;
  };
  overlay: {
    modalBackdrop: string;
    sheetBackdrop: string;
  };
  shadow: {
    floating: string;
    modal: string;
  };
};

const CSS_VAR_COLORS: SemanticColors = {
  bg: {
    base: 'var(--bg-2)',
    elevated: 'var(--bg)',
    subtle: 'var(--bg-3)',
    input: 'var(--bg)',
    overlay: 'color-mix(in srgb, var(--fg) 8%, transparent)',
    overlayHover: 'var(--accent-ring)',
    inverse: 'var(--fg)',
  },
  text: {
    primary: 'var(--fg)',
    secondary: 'var(--fg-2)',
    tertiary: 'var(--fg-3)',
    onBrand: '#fff',
    inverse: 'var(--bg)',
    disabled: 'var(--fg-3)',
  },
  border: {
    default: 'var(--border)',
    input: 'var(--border-strong)',
    focus: 'var(--accent)',
    inverse: 'var(--bg)',
  },
  interactive: {
    primary: 'var(--accent)',
    primaryHover: 'var(--accent-hover)',
    primaryActive: 'var(--accent-active)',
    primarySurface: 'var(--accent-tint-8)',
  },
  feedback: {
    success: 'var(--status-connected)',
    error: 'var(--up)',
    warning: '#f59e0b',
    info: 'var(--accent)',
  },
  overlay: {
    modalBackdrop: 'color-mix(in srgb, var(--fg) 22%, transparent)',
    sheetBackdrop: 'color-mix(in srgb, var(--fg) 16%, transparent)',
  },
  shadow: {
    floating: 'rgba(15, 23, 42, 0.16)',
    modal: 'rgba(15, 23, 42, 0.2)',
  },
};

export function useColors(): SemanticColors {
  return CSS_VAR_COLORS;
}
