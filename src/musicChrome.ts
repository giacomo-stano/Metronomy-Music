// One visual vocabulary for library, catalog, player and offline controls.
export const musicChrome = {
  control: { target: 44, icon: 22 },
  menu: { radius: 32, rowHeight: 58, icon: 22, label: 17, lineHeight: 22, inset: 23 },
  motion: {
    pressScale: 0.97, pressDuration: 85,
    release: { stiffness: 420, damping: 26, mass: 0.6 },
    menuOpen: { damping: 26, stiffness: 340 }, menuClose: 140,
  },
} as const;
