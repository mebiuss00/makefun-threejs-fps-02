// The look plan, in one place: a dusk foundry. Slate sky and concrete, warm sodium
// light, rust for the Breachers and teal for the Wardens. Every colour the game uses
// is one of these; the lighting makes the shades between them. The same names are
// CSS custom properties in index.html, so the HUD and the world agree.
export const PALETTE = {
  sky: '#232a33',
  fog: '#3a4149',
  concrete: '#6f6e68',
  concreteDark: '#54534e',
  asphalt: '#43454a',
  steel: '#7d8894',
  steelDark: '#49525c',
  rust: '#c85a24',
  rustDark: '#8f3d16',
  teal: '#2fa8a0',
  tealDark: '#1d6e68',
  sand: '#b09a72',
  crate: '#9a7c4f',
  ink: '#ece7db',
  muted: '#9aa3ab',
  danger: '#d8402e',
  gold: '#e8a33d',
};

export const TEAM_COLORS = {
  breach: PALETTE.rust,
  ward: PALETTE.teal,
};
