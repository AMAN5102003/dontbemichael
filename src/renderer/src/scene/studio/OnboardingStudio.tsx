/**
 * The studio beside onboarding's Team step (branding/DESIGN.md 7.25): it fills
 * with a pod for each person the owner picks, around Michael's glass pod, and a
 * dashed "not picked" outline where an unpicked department would sit. Nobody
 * is working yet, so every screen just shows a ready check. The pack setup is
 * the moment the owner sees their office appear.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/design/theme';
import type { DepartmentName } from '@/design/tokens';
import { P, STAGE_H, STAGE_W, pts } from './iso';
import { family, sceneTokens, type Family } from './theme';
import { planStudio, type Seatable } from './layout';
import { Hub, Platform, Pod, StudioDefs } from './StudioArt';

export function OnboardingStudio({ picked, unpicked, businessName }: {
  picked: Seatable[]; unpicked: Seatable[]; businessName?: string;
}) {
  const { t } = useTranslation();
  const dark = useAppTheme() === 'dark';
  const T = sceneTokens(dark);
  const pickedIds = useMemo(() => new Set(picked.map((a) => a.id)), [picked]);
  // Plan with everyone, so a department keeps its slot whether picked or not.
  const plan = useMemo(() => planStudio([...picked, ...unpicked]), [picked, unpicked]);
  const families = useMemo(() => {
    const out: Record<string, Family> = {};
    for (const d of ['front-desk', 'support', 'sales', 'finance', 'marketing', 'people', 'it', 'operations', 'team'] as DepartmentName[]) out[d] = family(d, dark);
    return out;
  }, [dark]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 600, h: 600 });
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The platform spans roughly x 70..1020, y 150..760 of the stage.
  const cropX = 40; const cropY = 150; const cropW = 1010; const cropH = 610;
  const k = Math.min(box.w / cropW, (box.h - 70) / cropH);
  const ox = (box.w - cropW * k) / 2 - cropX * k;
  const oy = 70 + Math.max(0, (box.h - 70 - cropH * k) / 2) - cropY * k;

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--cth-ink)' }}>{businessName || t('onboarding.studio.yourBusiness')}</div>
        <div style={{ fontSize: 12.5, color: 'var(--cth-ink-3)', marginTop: 2 }}>{t('onboarding.studio.yourOffice')}</div>
      </div>
      <svg aria-hidden="true" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} width={STAGE_W * k} height={STAGE_H * k} style={{ position: 'absolute', left: ox, top: oy, overflow: 'visible' }}>
        <StudioDefs T={T} families={families} />
        <Platform T={T} />
        {[
          ...plan.pods.map((pod) => {
            const inPod = pod.members.filter((m) => pickedIds.has(m.id));
            const [gx, gy] = pod.grid;
            if (!inPod.length) {
              // A dashed outline where this department would sit.
              const hw = 0.7;
              const ring = [P(gx - hw, gy - hw, 2), P(gx + hw, gy - hw, 2), P(gx + hw, gy + hw, 2), P(gx - hw, gy + hw, 2)];
              return {
                depth: gx + gy,
                node: (
                  <g key={`ghost-${pod.dept}`}>
                    <polygon points={pts(ring)} fill={dark ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.5)'} stroke={T.stem} strokeWidth={1.5} strokeDasharray="6 5" />
                  </g>
                )
              };
            }
            return {
              depth: gx + gy,
              node: <Pod key={`pod-${pod.dept}`} grid={pod.grid} desks={inPod.map(() => ({ st: 'success' as const }))} c={families[pod.dept]} famKey={pod.dept} selected={false} T={T} dark={dark} />
            };
          }),
          { depth: 0, node: <Hub key="hub" T={T} dark={dark} board={{ todo: 0, doing: 0, waiting: 0, blocked: 0, done: 0 }} /> }
        ].sort((a, b) => a.depth - b.depth).map((o) => o.node)}
      </svg>
      {/* Name tags */}
      {plan.pods.map((pod) => {
        const inPod = pod.members.filter((m) => pickedIds.has(m.id));
        const ghost = !inPod.length;
        // A picked pod's tag floats over its desks; an empty place's tag sits
        // on the back corner of its outline, clear of the pods in front of it.
        const [x, y] = ghost ? P(pod.grid[0] - 0.7, pod.grid[1] - 0.7, 2) : P(pod.grid[0], pod.grid[1], 96);
        const names = (ghost ? pod.members : inPod).map((m) => nameOf(m)).join(', ');
        return (
          <div key={`tag-${pod.dept}`} style={{
            position: 'absolute', left: ox + x * k, top: oy + y * k, transform: ghost ? 'translate(-50%, calc(-100% - 4px))' : 'translate(-50%, -100%)',
            whiteSpace: 'nowrap', padding: '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            background: ghost ? 'color-mix(in srgb, var(--cth-bg) 85%, transparent)' : 'var(--cth-card)', color: ghost ? 'var(--cth-ink-3)' : 'var(--cth-ink)',
            boxShadow: ghost ? 'none' : 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-sm)',
            border: ghost ? '1px dashed var(--cth-line-input)' : 'none'
          }}>
            {ghost ? t('onboarding.studio.notPicked', { names }) : names}
          </div>
        );
      })}
    </div>
  );
}

function nameOf(a: Seatable): string {
  const base = a.character || a.id;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
