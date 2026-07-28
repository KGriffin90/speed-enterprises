/**
 * Shared model for the multi-window capture flow used by window-cleaning quotes.
 *
 * Both the AR measuring screen ((platform)/ar-measure) and the quote wizard's
 * Windows field read/write the same accumulated list. We stash it on a global so
 * it survives the push/pop between the wizard and the full-screen AR route
 * without threading params or a context through the navigator.
 */

export interface PaneInfo {
  index: number;
  widthInches: number;  heightInches: number;
  widthFeet: number;    heightFeet: number;
  widthDisplay: string; heightDisplay: string;
  areaSqFt: number;     areaDisplay: string;
}

export interface OverallInfo {
  widthInches: number;  heightInches: number;
  widthFeet: number;    heightFeet: number;
  widthDisplay: string; heightDisplay: string;
  perimeterInches: number; perimeterFeet: number; perimeterDisplay: string;
  totalAreaSqFt: number;   totalAreaDisplay: string;
}

/** One window type + quantity, accumulated across AR captures or manual adds. */
export interface WindowEntry {
  id: string;
  widthInches: number;
  heightInches: number;
  widthDisplay: string;
  heightDisplay: string;
  count: number;
  paneCount: number;
  shapeType: 'rectangular' | 'custom';
  panes?: PaneInfo[];
  overall?: OverallInfo;
  method: 'ar' | 'manual';
}

const KEY = '__windowEntries';

export function getWindowEntries(): WindowEntry[] {
  const g = (global as any)[KEY];
  return Array.isArray(g) ? g : [];
}

export function setWindowEntries(entries: WindowEntry[]): void {
  (global as any)[KEY] = entries;
}

export function clearWindowEntries(): void {
  (global as any)[KEY] = [];
}

/** Total number of physical windows across every size entry. */
export function totalWindowCount(entries: WindowEntry[]): number {
  return entries.reduce((sum, e) => sum + e.count, 0);
}

/** Human-readable summary, e.g. `3× 36.0" × 48.0", 2× 24.0" × 60.0" (custom)`. */
export function summarizeWindowEntries(entries: WindowEntry[]): string {
  return entries
    .map(e => {
      const shape = e.shapeType === 'custom' ? ' (custom)' : '';
      const panes = e.paneCount > 1 ? ` · ${e.paneCount} panes` : '';
      return `${e.count}× ${e.widthDisplay} × ${e.heightDisplay}${shape}${panes}`;
    })
    .join(', ');
}

/** Build a manual (non-AR) entry from typed-in dimensions. */
export function makeManualEntry(widthInches: number, heightInches: number, count: number): WindowEntry {
  return {
    id:           `m_${Date.now()}`,
    widthInches,
    heightInches,
    widthDisplay: `${widthInches.toFixed(1)}"`,
    heightDisplay:`${heightInches.toFixed(1)}"`,
    count:        Math.max(1, count),
    paneCount:    1,
    shapeType:    'rectangular',
    method:       'manual',
  };
}
