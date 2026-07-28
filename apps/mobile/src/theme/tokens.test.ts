import {
  resolveTheme, defaultTheme, DEFAULT_BRAND,
  INK, SURFACE, INK_DARK, SURFACE_DARK, SHADOW_SOFT,
} from './tokens';

describe('resolveTheme', () => {
  it('falls back to the default indigo brand when no branding is given', () => {
    expect(resolveTheme(null).brand).toBe(DEFAULT_BRAND);
    expect(resolveTheme(undefined).brand).toBe(DEFAULT_BRAND);
    expect(defaultTheme.brand).toBe(DEFAULT_BRAND);
  });

  it('uses the tenant brand colors when provided', () => {
    const colors = { ...DEFAULT_BRAND, brand500: '#ff0000', brand600: '#cc0000' };
    const t = resolveTheme({ colors, cornerRadius: 'soft' } as any);
    expect(t.brand.brand500).toBe('#ff0000');
    expect(t.brand.brand600).toBe('#cc0000');
  });

  it('maps cornerRadius sharp/soft/rounded to the right px', () => {
    expect(resolveTheme({ colors: DEFAULT_BRAND, cornerRadius: 'sharp' } as any).radius).toBe(4);
    expect(resolveTheme({ colors: DEFAULT_BRAND, cornerRadius: 'soft' } as any).radius).toBe(12);
    expect(resolveTheme({ colors: DEFAULT_BRAND, cornerRadius: 'rounded' } as any).radius).toBe(20);
  });

  it('defaults radius to soft (12) when cornerRadius is missing', () => {
    expect(resolveTheme({ colors: DEFAULT_BRAND } as any).radius).toBe(12);
    expect(resolveTheme(null).radius).toBe(12);
  });

  it('keeps neutral ink/surface tokens fixed and exposes pill radius + shadow', () => {
    const t = resolveTheme(null);
    expect(t.ink).toBe(INK);
    expect(t.surface).toBe(SURFACE);
    expect(t.radiusFull).toBe(999);
    expect(t.shadowSoft).toBe(SHADOW_SOFT);
    expect(t.font).toBeUndefined(); // system font until expo-font wiring lands
  });

  it('defaults to the light scheme', () => {
    const t = resolveTheme(null);
    expect(t.scheme).toBe('light');
    expect(t.isDark).toBe(false);
    expect(t.ink).toBe(INK);
    expect(t.surface).toBe(SURFACE);
  });

  it('flips only the neutral ramps in dark mode; brand stays branded', () => {
    const colors = { ...DEFAULT_BRAND, brand500: '#ff0000' };
    const t = resolveTheme({ colors, cornerRadius: 'soft' } as any, 'dark');
    expect(t.scheme).toBe('dark');
    expect(t.isDark).toBe(true);
    expect(t.ink).toBe(INK_DARK);
    expect(t.surface).toBe(SURFACE_DARK);
    // Brand colors are NOT affected by the scheme (web parity).
    expect(t.brand.brand500).toBe('#ff0000');
  });

  it('never throws on a partial/garbage branding object', () => {
    expect(() => resolveTheme({} as any)).not.toThrow();
    expect(() => resolveTheme({ cornerRadius: 'sharp' } as any)).not.toThrow();
    // A bogus cornerRadius key falls through to undefined → defaults to soft.
    expect(resolveTheme({ colors: DEFAULT_BRAND, cornerRadius: 'nope' } as any).radius).toBe(12);
  });
});
