/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
export const ONYX_THEME_VARIABLES = {
  surfaceApp: '--onyx-surface-app',
  surfaceEditor: '--onyx-surface-editor',
  surfacePanel: '--onyx-surface-panel',
  surfaceSidebar: '--onyx-surface-sidebar',
  surfaceMenu: '--onyx-surface-menu',
  surfaceDialog: '--onyx-surface-dialog',
  surfaceOverlay: '--onyx-surface-overlay',
  textForeground: '--onyx-text-foreground',
  textMuted: '--onyx-text-muted',
  textDescription: '--onyx-text-description',
  textLink: '--onyx-text-link',
  textInverse: '--onyx-text-inverse',
  controlButtonBg: '--onyx-control-button-bg',
  controlButtonFg: '--onyx-control-button-fg',
  controlButtonHoverBg: '--onyx-control-button-hover-bg',
  controlSecondaryBg: '--onyx-control-secondary-bg',
  controlSecondaryFg: '--onyx-control-secondary-fg',
  controlSecondaryHoverBg: '--onyx-control-secondary-hover-bg',
  controlDestructiveBg: '--onyx-control-destructive-bg',
  controlDestructiveFg: '--onyx-control-destructive-fg',
  controlInputBg: '--onyx-control-input-bg',
  controlInputFg: '--onyx-control-input-fg',
  controlInputBorder: '--onyx-control-input-border',
  controlFocusRing: '--onyx-control-focus-ring',
  stateHover: '--onyx-state-hover',
  stateActive: '--onyx-state-active',
  stateSelected: '--onyx-state-selected',
  stateSelectedFg: '--onyx-state-selected-fg',
  stateDisabled: '--onyx-state-disabled',
  stateWarning: '--onyx-state-warning',
  stateError: '--onyx-state-error',
  stateSuccess: '--onyx-state-success',
  shellActivityBarBg: '--onyx-shell-activity-bar-bg',
  shellActivityBarFg: '--onyx-shell-activity-bar-fg',
  shellActivityBarInactiveFg: '--onyx-shell-activity-bar-inactive-fg',
  shellStatusBarBg: '--onyx-shell-status-bar-bg',
  shellStatusBarFg: '--onyx-shell-status-bar-fg',
  shellTabsBg: '--onyx-shell-tabs-bg',
  shellTabsBorder: '--onyx-shell-tabs-border',
  shellToolbarBg: '--onyx-shell-toolbar-bg',
  shellToolbarBorder: '--onyx-shell-toolbar-border',
  shellBadgeBg: '--onyx-shell-badge-bg',
  shellBadgeFg: '--onyx-shell-badge-fg',
  shellScrollbarThumb: '--onyx-shell-scrollbar-thumb',
  shellScrollbarThumbHover: '--onyx-shell-scrollbar-thumb-hover',
  shellScrollbarThumbActive: '--onyx-shell-scrollbar-thumb-active',
  radiusSm: '--onyx-radius-sm',
  radiusMd: '--onyx-radius-md',
  radiusLg: '--onyx-radius-lg',
  shadowSm: '--onyx-shadow-sm',
  shadowMd: '--onyx-shadow-md',
  shadowLg: '--onyx-shadow-lg',
  zPopover: '--onyx-z-popover',
  zDialog: '--onyx-z-dialog',
  zOverlay: '--onyx-z-overlay',
  uiScale: '--onyx-scale-ui',
  typographyScale: '--onyx-scale-type',
  fontFamily: '--onyx-font-family',
  fontSize: '--onyx-font-size'
} as const;

export type OnyxThemeToken = keyof typeof ONYX_THEME_VARIABLES;
export type OnyxThemeVariables = Partial<Record<OnyxThemeToken, string>>;

export const ONYX_DEFAULT_THEME: Record<OnyxThemeToken, string> = {
  surfaceApp: '#100F0F',
  surfaceEditor: '#100F0F',
  surfacePanel: '#1C1B1A',
  surfaceSidebar: '#1C1B1A',
  surfaceMenu: '#1C1B1A',
  surfaceDialog: '#1C1B1A',
  surfaceOverlay: 'rgba(16, 15, 15, 0.76)',
  textForeground: '#CECDC3',
  textMuted: '#B7B5AC',
  textDescription: '#878580',
  textLink: '#4385BE',
  textInverse: '#FFFCF0',
  controlButtonBg: '#205EA6',
  controlButtonFg: '#FFFCF0',
  controlButtonHoverBg: '#4385BE',
  controlSecondaryBg: '#282726',
  controlSecondaryFg: '#CECDC3',
  controlSecondaryHoverBg: '#343331',
  controlDestructiveBg: '#AF3029',
  controlDestructiveFg: '#FFFCF0',
  controlInputBg: '#1C1B1A',
  controlInputFg: '#CECDC3',
  controlInputBorder: '#403E3C',
  controlFocusRing: '#4385BE',
  stateHover: '#282726',
  stateActive: '#403E3C',
  stateSelected: '#343331',
  stateSelectedFg: '#FFFCF0',
  stateDisabled: 'rgba(183, 181, 172, 0.38)',
  stateWarning: '#D0A215',
  stateError: '#D14D41',
  stateSuccess: '#879A39',
  shellActivityBarBg: '#100F0F',
  shellActivityBarFg: '#CECDC3',
  shellActivityBarInactiveFg: 'rgba(206, 205, 195, 0.62)',
  shellStatusBarBg: '#282726',
  shellStatusBarFg: '#CECDC3',
  shellTabsBg: '#1C1B1A',
  shellTabsBorder: '#403E3C',
  shellToolbarBg: '#1C1B1A',
  shellToolbarBorder: '#403E3C',
  shellBadgeBg: '#4385BE',
  shellBadgeFg: '#100F0F',
  shellScrollbarThumb: '#575653',
  shellScrollbarThumbHover: 'var(--onyx-text-description)',
  shellScrollbarThumbActive: 'var(--onyx-text-muted)',
  radiusSm: '0.375rem',
  radiusMd: '0.5rem',
  radiusLg: '0.75rem',
  shadowSm: '0 4px 14px rgba(16, 15, 15, 0.24)',
  shadowMd: '0 18px 40px rgba(16, 15, 15, 0.36)',
  shadowLg: '0 24px 56px rgba(16, 15, 15, 0.48)',
  zPopover: '300000',
  zDialog: '300001',
  zOverlay: '299999',
  uiScale: '1',
  typographyScale: '1',
  fontFamily: "var(--theme-font-family, 'Segoe UI'), system-ui, sans-serif",
  fontSize: '13px'
};

export function mergeOnyxThemeVariables(...sources: OnyxThemeVariables[]): OnyxThemeVariables {
  return Object.assign({}, ...sources);
}

export function createOnyxThemeStyleMap(
  variables: OnyxThemeVariables = {}
): Record<string, string> {
  const merged = {
    ...ONYX_DEFAULT_THEME,
    ...variables
  };

  return Object.fromEntries(
    Object.entries(ONYX_THEME_VARIABLES).map(([token, cssVariableName]) => [
      cssVariableName,
      merged[token as OnyxThemeToken]
    ])
  );
}
