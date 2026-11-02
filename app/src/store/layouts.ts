// Dashboard layouts, one per gateway, kept on this phone only (see dashboardLayout.ts). The devices,
// their names, settings and alert rules live on the gateway and are shared by every phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { EMPTY_LAYOUT, layoutKey, type Layout } from '@/dashboardLayout';
import { useGateway } from '@/store/gateway';
import type { CardStyle, CardWidth } from '@/store/settings';

export const DEFAULT_DASHBOARD_TITLE = 'OpenRV';

interface LayoutsState {
  /** By gateway (its Bluetooth address). */
  layouts: Record<string, Layout>;
  update(key: string, change: (layout: Layout) => Partial<Layout>): void;
}

export const useLayouts = create<LayoutsState>()(
  persist(
    (set) => ({
      layouts: {},
      update: (key, change) =>
        set((s) => {
          const current = s.layouts[key] ?? EMPTY_LAYOUT;
          return { layouts: { ...s.layouts, [key]: { ...current, ...change(current) } } };
        }),
    }),
    { name: 'openrv-layouts', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);

/** The connected gateway's key, if connected. */
export function useLayoutKey(): string | undefined {
  return useGateway((s) => layoutKey(s.hello, s.gatewayId));
}

/** The connected gateway's dashboard on this phone. */
export function useLayout(): Layout {
  const key = useLayoutKey();
  return useLayouts((s) => (key ? s.layouts[key] : undefined)) ?? EMPTY_LAYOUT;
}

/** Changes to the connected gateway's dashboard; they do nothing while no gateway is connected. */
export function useLayoutActions() {
  const key = useLayoutKey();
  const update = useLayouts((s) => s.update);
  const change = (fn: (l: Layout) => Partial<Layout>): void => {
    if (key) update(key, fn);
  };
  return {
    setTitle: (title: string | undefined) => change(() => ({ title })),
    setOrder: (order: string[]) => change(() => ({ order })),
    hide: (id: string) => change((l) => ({ hidden: [...l.hidden.filter((h) => h !== id), id] })),
    show: (id: string) => change((l) => ({ hidden: l.hidden.filter((h) => h !== id) })),
    setStyle: (id: string, style: CardStyle) => change((l) => ({ styles: { ...l.styles, [id]: style } })),
    setWidth: (id: string, width: CardWidth) => change((l) => ({ widths: { ...l.widths, [id]: width } })),
  };
}
