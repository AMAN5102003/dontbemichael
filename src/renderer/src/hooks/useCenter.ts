import { useStore } from '@/store/store';
import { dockCentered } from '@/shell/wideCenter';

/** The 1:1 with Michael is wide in the center right now (shell/wideCenter.ts).
 *  A panel counts as open only where the column shows: the office or a file tab. */
export function useDockCentered(): boolean {
  return useStore((s) => dockCentered({
    dockOpen: s.dockOpen,
    dockWide: s.dockWide,
    dockSideForNow: s.dockSideForNow,
    panelWideOpen: s.panelWide && s.rightColumn === 'person' && !!s.selectedId && (s.floorView === 'office' || s.floorView === 'file'),
    claim: s.centerClaim
  }));
}
