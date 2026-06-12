import type { ComponentState, NormalizedMonitorState, PublicSnapshot, StorageAdapter } from "@statusframe/core";

export interface MemoryStorageState {
  snapshot?: PublicSnapshot;
  componentStates: ComponentState[];
  monitorStates: NormalizedMonitorState[];
}

export function createMemoryStorage(initial?: Partial<MemoryStorageState>): StorageAdapter & {
  inspect(): MemoryStorageState;
} {
  const state: MemoryStorageState = {
    componentStates: initial?.componentStates ?? [],
    monitorStates: initial?.monitorStates ?? []
  };
  if (initial?.snapshot) state.snapshot = initial.snapshot;

  return {
    name: "memory",
    async loadPublicSnapshot() {
      return state.snapshot;
    },
    async savePublicSnapshot(snapshot) {
      state.snapshot = snapshot;
    },
    async loadComponentStates() {
      return state.componentStates;
    },
    async saveComponentStates(componentStates) {
      state.componentStates = componentStates;
    },
    async saveMonitorStates(monitorStates) {
      state.monitorStates = monitorStates;
    },
    inspect() {
      return {
        ...state,
        componentStates: [...state.componentStates],
        monitorStates: [...state.monitorStates]
      };
    }
  };
}
