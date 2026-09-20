// Each visit has its own generation: returning A → B → A must not revive
// a response from the first A. Lanes additionally order repeated reads.
export class WorkspaceRequests {
  private generation = 0;
  private lanes = new Map<string, number>();
  private pending = new Map<string, Promise<unknown>>();

  invalidate() { this.generation++; this.lanes.clear(); }
  cancelLane(lane: string) { this.lanes.set(lane, (this.lanes.get(lane) ?? 0) + 1); }
  capture(lane?: string) {
    const generation = this.generation;
    if (lane) this.cancelLane(lane);
    const sequence = lane ? this.lanes.get(lane) : null;
    return () => generation === this.generation && (!lane || sequence === this.lanes.get(lane));
  }
  // Serialize writes to each resource so a late older draft cannot win on
  // the server. A rejected write must not prevent the next explicit retry.
  write<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.pending.set(key, next);
    const remove = () => { if (this.pending.get(key) === next) this.pending.delete(key); };
    void next.then(remove, remove);
    return next;
  }
  has(key: string) { return this.pending.has(key); }
  async drain() {
    while (this.pending.size) await Promise.allSettled([...this.pending.values()]);
  }
}

export function storedExam(userId: string): string | null {
  try { return localStorage.getItem(`prepdeck:active-exam:${userId}`); } catch { return null; }
}
export function storeExam(userId: string, examId: string | null) {
  try {
    const key = `prepdeck:active-exam:${userId}`;
    if (examId) localStorage.setItem(key, examId); else localStorage.removeItem(key);
  } catch { /* Browser storage is optional; switching still works. */ }
}

// Editors contribute saves before a workspace change or a cross-page jump.
// Rejections keep the current page mounted with its drafts intact.
export function beforeWorkspaceNavigation(): Promise<void> {
  const saves: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent("prepdeck:save-before-navigation", {
    detail: { waitUntil: (save: Promise<unknown>) => saves.push(save) }
  }));
  return Promise.all(saves).then(() => {});
}
export function registerNavigationSave(save: () => Promise<unknown>): () => void {
  const handler = (event: Event) => {
    (event as CustomEvent<{ waitUntil: (save: Promise<unknown>) => void }>).detail.waitUntil(save());
  };
  window.addEventListener("prepdeck:save-before-navigation", handler);
  return () => window.removeEventListener("prepdeck:save-before-navigation", handler);
}
