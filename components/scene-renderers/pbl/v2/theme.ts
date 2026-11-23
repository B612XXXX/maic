import type { CSSProperties } from 'react';

/** Local to PBL surfaces, including portalled dialogs. */
export const PBL_THEME = {
  colorScheme: 'light',
  '--background': '#f5f0e7',
  '--foreground': '#453526',
  '--card': '#fffbf5',
  '--card-foreground': '#453526',
  '--popover': '#fffbf5',
  '--popover-foreground': '#453526',
  '--primary': '#a36c26',
  '--primary-foreground': '#fffaf2',
  '--secondary': '#eee2cf',
  '--secondary-foreground': '#60472c',
  '--muted': '#efe7da',
  '--muted-foreground': '#8a7660',
  '--accent': '#f1dfbf',
  '--accent-foreground': '#69451f',
  '--destructive': '#b44432',
  '--border': '#ddcdb6',
  '--input': '#d6c3a6',
  '--ring': '#b5833c',
} satisfies CSSProperties & Record<`--${string}`, string>;
