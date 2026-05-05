import { create } from "zustand";
import type { Dataset } from "../types";

interface DatasetStore {
  activeDatasetId: string | null;
  activeDataset: Dataset | null;
  setActiveDataset: (ds: Dataset | null) => void;
  setActiveDatasetId: (id: string | null) => void;
}

export const useDatasetStore = create<DatasetStore>((set) => ({
  activeDatasetId: null,
  activeDataset: null,
  setActiveDataset: (ds) => set({ activeDataset: ds, activeDatasetId: ds?.id ?? null }),
  setActiveDatasetId: (id) => set({ activeDatasetId: id }),
}));
