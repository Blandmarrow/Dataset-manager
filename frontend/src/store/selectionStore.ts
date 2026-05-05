import { create } from "zustand";

interface SelectionStore {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  count: number;
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
  selectedIds: new Set(),
  count: 0,
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { selectedIds: next, count: next.size };
    }),
  selectAll: (ids) =>
    set(() => {
      const next = new Set(ids);
      return { selectedIds: next, count: next.size };
    }),
  clear: () => set({ selectedIds: new Set(), count: 0 }),
  isSelected: (id) => get().selectedIds.has(id),
}));
