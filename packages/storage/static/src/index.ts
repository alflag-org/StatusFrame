import type { PublicSnapshot, StorageAdapter } from "@statusframe/core";

export function createStaticStorage(initialSnapshot?: PublicSnapshot): StorageAdapter {
  let snapshot = initialSnapshot;
  return {
    name: "static",
    async loadPublicSnapshot() {
      return snapshot;
    },
    async savePublicSnapshot(nextSnapshot) {
      snapshot = nextSnapshot;
    }
  };
}
