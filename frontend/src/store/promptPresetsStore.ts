import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PromptPreset {
  id: string;
  name: string;
  model: string;
  style: string;
  prompt: string;
}

interface PresetsStore {
  presets: PromptPreset[];
  save: (p: Omit<PromptPreset, "id">) => void;
  remove: (id: string) => void;
  update: (id: string, p: Partial<Omit<PromptPreset, "id">>) => void;
}

export const usePresetsStore = create<PresetsStore>()(
  persist(
    (set) => ({
      presets: [],
      save: (p) =>
        set((s) => ({
          presets: [
            ...s.presets,
            { ...p, id: crypto.randomUUID() },
          ],
        })),
      remove: (id) =>
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
      update: (id, patch) =>
        set((s) => ({
          presets: s.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
    }),
    { name: "caption-prompt-presets" }
  )
);
