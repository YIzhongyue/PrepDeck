import { registerNavigationSave } from "../lib/examWorkspace";
// implementation — dedicated state/store for the Knowledge Points feature. Kept
// separate from the already-large PrepDeckContext (store/PrepDeckContext.tsx)
// rather than growing it further: this feature owns a nontrivial autosave
// state machine (debounce, retry/backoff, revision-conflict handling) that
// doesn't fit the rest of that context's simple optimistic-update pattern.
// Mirrors PrepDeckContext's own conventions where they do apply: one
// `setState(patch)` merge helper, a `stateRef` kept in sync so callbacks
// read the latest state instead of a stale closure.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { KnowledgePointDetail, KnowledgePointGroup, KnowledgePointSort, KnowledgePointSummary, KnowledgePointTag } from "@prepdeck/shared";
import * as api from "../lib/knowledgePoints";
import { ApiError } from "../lib/api";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export type KnowledgePointsScope = "all" | "exam";

interface KnowledgePointsState {
  items: KnowledgePointSummary[];
  total: number;
  listLoading: boolean;
  listError: string | null;
  orderRevision: number | null;
  ordering: boolean;
  groupId: string | null;
  ungrouped: boolean;
  tagIds: string[];
  search: string;
  sort: KnowledgePointSort;
  // implementation — "Related to this exam" vs. "All personal knowledge points".
  // Defaults to "all" so existing behavior is unchanged when no exam
  // workspace is active. `activeExamId` mirrors the app's current exam
  // (PrepDeckContext.state.examId) so the list can refetch when it changes.
  scope: KnowledgePointsScope;
  activeExamId: string | null;

  groups: KnowledgePointGroup[];
  ungroupedCount: number;
  tags: KnowledgePointTag[];

  editing: KnowledgePointDetail | null;
  editorLoading: boolean;
  editorError: string | null;
  uploading: number;
  uploadError: string | null;
  metadataError: boolean;
  title: string;
  bodyMarkdown: string;
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  saveErrorMessage: string | null;
  conflict: KnowledgePointDetail | null;
}

const initialState: KnowledgePointsState = {
  items: [],
  total: 0,
  listLoading: false,
  listError: null, orderRevision: null, ordering: false,
  groupId: null,
  ungrouped: false,
  tagIds: [],
  search: "",
  sort: "updated",
  scope: "all",
  activeExamId: null,
  groups: [],
  ungroupedCount: 0,
  tags: [],
  editing: null,
  editorLoading: false,
  editorError: null, uploading: 0, uploadError: null, metadataError: false,
  title: "",
  bodyMarkdown: "",
  saveStatus: "idle",
  lastSavedAt: null,
  saveErrorMessage: null,
  conflict: null,
};

type Patch = Partial<KnowledgePointsState> | ((s: KnowledgePointsState) => Partial<KnowledgePointsState>);

const AUTOSAVE_DEBOUNCE_MS = 1000;
const SEARCH_DEBOUNCE_MS = 300;
const MAX_RETRIES = 5;

interface KnowledgePointsStore {
  state: KnowledgePointsState;
  hasActiveFilters: boolean;
  canReorder: boolean;

  setFilterGroup: (groupId: string | null, ungrouped: boolean) => void;
  toggleFilterTag: (tagId: string) => void;
  clearFilters: () => void;
  setSearch: (q: string) => void;
  setSort: (sort: KnowledgePointSort) => void;
  setScope: (scope: KnowledgePointsScope) => void;
  refreshList: () => void;
  loadMore: () => void;
  reorderNote: (id: string, beforeId: string | null) => void;

  refreshGroupsAndTags: () => void;
  createGroup: (name: string) => Promise<KnowledgePointGroup>;
  renameGroup: (id: string, name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  renameTag: (id: string, name: string) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;

  openNote: (id: string) => void;
  createAndOpenNote: (groupId?: string | null) => Promise<string>;
  closeEditor: () => void;
  setTitle: (title: string) => void;
  setBodyMarkdown: (bodyMarkdown: string) => void;
  retryNow: () => void;
  keepMineAfterConflict: () => void;
  reloadAfterConflict: () => void;
  setNoteGroup: (groupId: string | null) => void;
  addTag: (name: string) => void;
  removeTag: (tagId: string) => void;
  linkQuestion: (questionId: string) => Promise<void>;
  unlinkQuestion: (questionId: string) => Promise<void>;
  uploadImage: (file: File | Blob) => Promise<string>;
  deleteNote: (id: string) => Promise<void>;
  hasUnsavedWork: () => boolean;
  flushEditor: () => Promise<void>;
  setComposing: (composing: boolean) => void;
  dismissUploadError: () => void;
  discardFailedMetadata: () => void;
}

const Ctx = createContext<KnowledgePointsStore | null>(null);

export function KnowledgePointsProvider({ children, activeExamId = null }: { children: React.ReactNode; activeExamId?: string | null }) {
  const [state, setStateRaw] = useState<KnowledgePointsState>(initialState);
  const stateRef = useRef(state);


  const setState = useCallback((patch: Patch) => {
    const next = { ...stateRef.current, ...(typeof patch === "function" ? patch(stateRef.current) : patch) };
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const dirtyRef = useRef(false);
  const composingRef = useRef(false);
  const generationRef = useRef(0);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const uploadsRef = useRef(new Set<Promise<unknown>>());
  const metadataRef = useRef<Array<() => Promise<KnowledgePointDetail | void>>>([]);
  const retryCountRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (debounceTimerRef.current != null) { window.clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    if (retryTimerRef.current != null) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  };

  // One queue owns content and metadata writes. Acknowledgements update only
  // the opened generation; typing during a save leaves another revision dirty.
  const performSave = useCallback(async (): Promise<void> => {
    if (savePromiseRef.current) {
      await savePromiseRef.current;
      if (dirtyRef.current || metadataRef.current.length) return performSave();
      return;
    }
    if (!stateRef.current.editing || composingRef.current) return;
    if (stateRef.current.conflict) throw new Error("Resolve the revision conflict before saving.");
    if (!dirtyRef.current && !metadataRef.current.length) return;
    const generation = generationRef.current;
    const current = () => generation === generationRef.current;
    const task = (async () => {
      setState({ saveStatus: "saving", saveErrorMessage: null });
      while (current() && (dirtyRef.current || metadataRef.current.length)) {
        if (composingRef.current) break;
        const operation = metadataRef.current[0];
        if (operation) {
          let detail: KnowledgePointDetail | void;
          try { detail = await operation(); }
          catch (error) {
            if (current()) setState({ metadataError: true });
            // A failed operation normally stays at the head of the queue to be
            // retried — but only a TRANSIENT failure can succeed by retrying.
            // A rejected one never will, and leaving it queued made every
            // later performSave re-run it and throw before ever reaching the
            // content save, so typed text could not be saved at all until the
            // reader found "Discard failed metadata change". Drop it instead,
            // and say so: the error still surfaces, but the queue behind it is
            // clear, so the panel's Retry (or the next keystroke) saves the
            // content that was stuck behind it.
            if (error instanceof ApiError && error.status !== 429 && error.status < 500) {
              metadataRef.current.shift();
              throw new ApiError(error.status, `${error.message} That change was discarded; your text is unaffected.`, error.body);
            }
            throw error;
          }
          if (!current()) return;
          metadataRef.current.shift();
          // These endpoints do not edit content or advance its revision. A
          // returned detail can include another tab's newer body: do not adopt
          // that unseen revision as the base for our still-local content.
          setState(s => ({ metadataError: false, ...(detail && s.editing ? {
            editing: { ...detail, revision: s.editing.revision, title: s.editing.title, bodyMarkdown: s.editing.bodyMarkdown },
            lastSavedAt: detail.updatedAt,
          } : {}) }));
          continue;
        }
        const s = stateRef.current;
        if (!s.editing) return;
        if (!s.title.trim()) throw new ApiError(400, "A title is required. Enter a title to save this note.");
        dirtyRef.current = false;
        try {
          const { knowledgePoint } = await api.autosaveKnowledgePoint(s.editing.id, {
            baseRevision: s.editing.revision, title: s.title, bodyMarkdown: s.bodyMarkdown,
          });
          if (!current()) return;
          setState({ editing: knowledgePoint, lastSavedAt: knowledgePoint.updatedAt });
        } catch (error) { if (current()) dirtyRef.current = true; throw error; }
      }
      if (!current()) return;
      retryCountRef.current = 0;
      setState({ saveStatus: stateRef.current.uploadError ? "error" : uploadsRef.current.size ? "saving" : dirtyRef.current || composingRef.current ? "unsaved" : "saved",
        saveErrorMessage: stateRef.current.uploadError });
    })().catch(error => {
      if (!current()) return;
      const message = error instanceof Error ? error.message : "Save failed. Please retry.";
      setState({ saveStatus: "error", saveErrorMessage: message,
        ...(api.isRevisionConflict(error) ? { conflict: (error.body as { latest: KnowledgePointDetail }).latest } : {}) });
      // Validation, authentication and revision errors require user action.
      const transient = !(error instanceof ApiError) || error.status === 429 || error.status >= 500;
      if (transient && ++retryCountRef.current <= MAX_RETRIES) {
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          if (current()) void performSave().catch(() => {});
        }, Math.min(8000, 2000 * 2 ** (retryCountRef.current - 1)));
      }
      throw error;
    }).finally(() => { if (savePromiseRef.current === task) savePromiseRef.current = null; });
    savePromiseRef.current = task;
    return task;
  }, [setState]);

  const scheduleSave = useCallback(() => {
    clearTimers();
    if (composingRef.current) return;
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void performSave().catch(() => {});
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [performSave]);

  const hasUnsavedWork = useCallback(() => {
    const s = stateRef.current;
    return dirtyRef.current || composingRef.current || !!savePromiseRef.current || !!metadataRef.current.length || !!uploadsRef.current.size || !!s.uploadError || s.saveStatus === "error";
  }, []);

  const flushEditor = useCallback(async () => {
    clearTimers();
    if (composingRef.current) throw new Error("Finish composing your text before leaving.");
    await Promise.all([...uploadsRef.current]);
    // Let the editor insert the completed attachment before flushing its body.
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    if (stateRef.current.uploadError) throw new Error(stateRef.current.uploadError);
    await performSave();
    if (hasUnsavedWork()) throw new Error("Your note still has unsaved changes. Retry saving before leaving.");
  }, [performSave, hasUnsavedWork]);

  useEffect(() => registerNavigationSave(flushEditor), [flushEditor]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (hasUnsavedWork()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => { clearTimers(); generationRef.current++; window.removeEventListener("beforeunload", handler); };
  }, [hasUnsavedWork]);

  const setTitle = useCallback((title: string) => {
    if (!stateRef.current.editing || title === stateRef.current.title) return;
    dirtyRef.current = true;
    setState({ title, saveStatus: "unsaved" });
    scheduleSave();
  }, [setState, scheduleSave]);
  const setBodyMarkdown = useCallback((bodyMarkdown: string) => {
    if (!stateRef.current.editing || bodyMarkdown === stateRef.current.bodyMarkdown) return;
    dirtyRef.current = true;
    setState({ bodyMarkdown, saveStatus: "unsaved" });
    scheduleSave();
  }, [setState, scheduleSave]);
  const setComposing = useCallback((composing: boolean) => {
    if (!stateRef.current.editing) return;
    composingRef.current = composing;
    if (composing) { clearTimers(); setState({ saveStatus: "unsaved" }); }
    else scheduleSave();
  }, [setState, scheduleSave]);
  const retryNow = useCallback(() => { clearTimers(); retryCountRef.current = 0; void performSave().catch(() => {}); }, [performSave]);
  const dismissUploadError = useCallback(() => {
    setState({ uploadError: null, saveErrorMessage: null, saveStatus: dirtyRef.current ? "unsaved" : "saved" });
    scheduleSave();
  }, [setState, scheduleSave]);
  const discardFailedMetadata = useCallback(() => {
    if (!stateRef.current.metadataError) return;
    metadataRef.current.shift();
    clearTimers(); retryCountRef.current = 0;
    setState({ metadataError: false, saveErrorMessage: null, saveStatus: dirtyRef.current || metadataRef.current.length ? "unsaved" : "saved" });
    void performSave().catch(() => {});
  }, [performSave, setState]);

  const keepMineAfterConflict = useCallback(() => {
    const s = stateRef.current;
    if (!s.conflict || !s.editing) return;
    setState({ editing: { ...s.editing, revision: s.conflict.revision }, conflict: null });
    dirtyRef.current = true;
    retryNow();
  }, [retryNow, setState]);
  const reloadAfterConflict = useCallback(() => {
    const latest = stateRef.current.conflict;
    if (!latest) return;
    clearTimers(); dirtyRef.current = false; retryCountRef.current = 0;
    setState({ editing: latest, title: latest.title, bodyMarkdown: latest.bodyMarkdown, conflict: null,
      saveStatus: stateRef.current.uploadError ? "error" : "saved", lastSavedAt: latest.updatedAt, saveErrorMessage: stateRef.current.uploadError });
  }, [setState]);

  const openNote = useCallback((id: string) => {
    clearTimers();
    const generation = ++generationRef.current;
    dirtyRef.current = false; composingRef.current = false; metadataRef.current = []; retryCountRef.current = 0;
    setState({ editorLoading: true, editorError: null, editing: null, title: "", bodyMarkdown: "", saveStatus: "idle", conflict: null, saveErrorMessage: null, uploadError: null, metadataError: false });
    api.getKnowledgePoint(id).then(({ knowledgePoint }) => {
      if (generation !== generationRef.current) return;
      setState({ editing: knowledgePoint, title: knowledgePoint.title, bodyMarkdown: knowledgePoint.bodyMarkdown,
        editorLoading: false, saveStatus: "saved", lastSavedAt: knowledgePoint.updatedAt });
    }).catch(() => { if (generation === generationRef.current) setState({ editorLoading: false, editorError: "Could not load this note. Retry or return to your list." }); });
  }, [setState]);

  const creationRef = useRef<Promise<string> | null>(null);
  const createAndOpenNote = useCallback((groupId?: string | null) => {
    if (creationRef.current) return creationRef.current;
    const create = api.createKnowledgePoint({ groupId: groupId ?? undefined }).then(({ knowledgePoint }) => {
      generationRef.current++; dirtyRef.current = false; retryCountRef.current = 0;
      setState({ editing: knowledgePoint, title: knowledgePoint.title, bodyMarkdown: knowledgePoint.bodyMarkdown,
        saveStatus: "saved", lastSavedAt: knowledgePoint.updatedAt, conflict: null, saveErrorMessage: null });
      return knowledgePoint.id;
    }).finally(() => { creationRef.current = null; });
    creationRef.current = create;
    return create;
  }, [setState]);

  const closeEditor = useCallback(() => {
    clearTimers(); generationRef.current++;
    dirtyRef.current = false; composingRef.current = false; metadataRef.current = []; retryCountRef.current = 0;
    savePromiseRef.current = null; uploadsRef.current.clear();
    setState({ editing: null, editorLoading: false, editorError: null, title: "", bodyMarkdown: "",
      saveStatus: "idle", lastSavedAt: null, conflict: null, saveErrorMessage: null,
      uploading: 0, uploadError: null, metadataError: false });
  }, [setState]);

  const listSequenceRef = useRef(0);
  const refreshList = useCallback((keepError = false) => {
    const sequence = ++listSequenceRef.current;
    const s = stateRef.current;
    setState({ listLoading: true, ...(keepError ? {} : { listError: null }) });
    api
      .listKnowledgePoints({
        groupId: s.groupId,
        ungrouped: s.ungrouped,
        tagIds: s.tagIds,
        q: s.search || undefined,
        sort: s.sort,
        examId: s.scope === "exam" && s.activeExamId ? s.activeExamId : undefined,
        limit: 200,
        offset: 0,
      })
      .then((res) => { if (sequence === listSequenceRef.current) setState({ items: res.knowledgePoints, total: res.total, orderRevision: res.orderRevision, listLoading: false }); })
      .catch(() => { if (sequence === listSequenceRef.current) setState({ listLoading: false, listError: "Could not load your notes. Please retry." }); });
  }, [setState]);

  const refreshGroupsAndTags = useCallback(() => {
    Promise.all([api.listKnowledgePointGroups(), api.listKnowledgePointTags()])
      .then(([g, t]) => setState({ groups: g.groups, ungroupedCount: g.ungroupedCount, tags: t.tags }))
      .catch(() => {});
  }, [setState]);

  const loadMore = useCallback(() => {
    const s = stateRef.current;
    if (s.listLoading || s.items.length >= s.total) return;
    const sequence = ++listSequenceRef.current;
    setState({ listLoading: true, listError: null });
    void api.listKnowledgePoints({ groupId: s.groupId, ungrouped: s.ungrouped, tagIds: s.tagIds, q: s.search || undefined,
      sort: s.sort, examId: s.scope === "exam" && s.activeExamId ? s.activeExamId : undefined, limit: 200, offset: s.items.length })
      .then(res => { if (sequence === listSequenceRef.current) {
        if (s.orderRevision !== res.orderRevision && s.sort === "custom") { refreshList(); return; }
        setState({ items: [...s.items, ...res.knowledgePoints], total: res.total, listLoading: false });
      } })
      .catch(() => { if (sequence === listSequenceRef.current) setState({ listLoading: false, listError: "Could not load more notes. Please retry." }); });
  }, [setState, refreshList]);

  useEffect(() => {
    refreshGroupsAndTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirrors the app's active exam (from PrepDeckContext) into local state so
  // refreshList can react to it. Falls back to "all" if the exam-scoped view
  // is active but there's no longer an active exam (e.g. workspace closed).
  useEffect(() => {
    setState((s) => ({ activeExamId, scope: activeExamId ? s.scope : "all" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExamId]);

  // Structural filter changes (group/tag/sort/scope) refetch immediately;
  // free-text search is debounced so typing doesn't fire a request per
  // keystroke.
  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.groupId, state.ungrouped, state.tagIds, state.sort, state.scope, state.activeExamId]);

  useEffect(() => {
    const t = window.setTimeout(() => refreshList(), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.search]);

  const setFilterGroup = useCallback((groupId: string | null, ungrouped: boolean) => {
    const isAll = groupId === null && !ungrouped;
    setState({ groupId, ungrouped, sort: isAll ? "updated" : "custom" });
  }, [setState]);

  const toggleFilterTag = useCallback((tagId: string) => {
    setState((s) => ({ tagIds: s.tagIds.includes(tagId) ? s.tagIds.filter((t) => t !== tagId) : [...s.tagIds, tagId] }));
  }, [setState]);

  const clearFilters = useCallback(() => setState({ tagIds: [], search: "" }), [setState]);
  const setSearch = useCallback((q: string) => setState({ search: q }), [setState]);
  const setSort = useCallback((sort: KnowledgePointSort) => setState({ sort }), [setState]);
  const setScope = useCallback((scope: KnowledgePointsScope) => setState({ scope }), [setState]);

  const reorderNote = useCallback((id: string, beforeId: string | null) => {
    const s = stateRef.current;
    // A drag that cannot be saved must say so. Returning silently left the
    // card animating back with no explanation of why nothing happened.
    if (s.ordering || s.listLoading) {
      setState({ listError: "Still saving the last move. Wait for it to finish, then try again." });
      return;
    }
    if (s.orderRevision == null) {
      setState({ listError: "This view cannot be reordered. Open a single group with custom sort to change the order." });
      return;
    }
    // Move it locally first and keep the original to put back on failure. The
    // server CAS is what decides the outcome; making the card wait a round
    // trip before it moves only makes a correct drag feel broken.
    const previous = s.items;
    const items = previous.slice();
    const fromIdx = items.findIndex(i => i.id === id);
    if (fromIdx < 0) return;
    const [moved] = items.splice(fromIdx, 1);
    const toIdx = beforeId ? items.findIndex(i => i.id === beforeId) : -1;
    items.splice(toIdx < 0 ? items.length : toIdx, 0, moved!);
    setState({ items, ordering: true, listError: null });
    void api.reorderKnowledgePoint(id, beforeId, s.orderRevision)
      .then(() => { setState({ ordering: false }); refreshList(true); })
      .catch(error => {
        setState({ items: previous, ordering: false, listError: error instanceof ApiError && error.status === 409
          ? "The order changed in another tab. The latest order has been loaded; try your move again."
          : "Could not save the new order. Your previous order is retained; please retry." });
        refreshList(true);
      });
  }, [setState, refreshList]);

  const createGroup = useCallback((name: string) => api.createKnowledgePointGroup(name).then((res) => { refreshGroupsAndTags(); return res.group; }), [refreshGroupsAndTags]);
  const renameGroup = useCallback((id: string, name: string) => api.renameKnowledgePointGroup(id, name).then(() => { refreshGroupsAndTags(); refreshList(); }), [refreshGroupsAndTags, refreshList]);
  const deleteGroup = useCallback((id: string) => api.deleteKnowledgePointGroup(id).then(() => {
    refreshGroupsAndTags();
    setState((s) => (s.groupId === id ? { groupId: null, ungrouped: false } : {}));
    refreshList();
  }), [refreshGroupsAndTags, refreshList, setState]);
  const renameTag = useCallback((id: string, name: string) => api.renameKnowledgePointTag(id, name).then(() => { refreshGroupsAndTags(); refreshList(); }), [refreshGroupsAndTags, refreshList]);
  const deleteTag = useCallback((id: string) => api.deleteKnowledgePointTag(id).then(() => {
    refreshGroupsAndTags();
    setState((s) => ({ tagIds: s.tagIds.filter((t) => t !== id) }));
    refreshList();
  }), [refreshGroupsAndTags, refreshList, setState]);

  const queueMetadata = useCallback((operation: () => Promise<KnowledgePointDetail | void>) => {
    metadataRef.current.push(operation);
    setState({ saveStatus: "unsaved", saveErrorMessage: null });
    return performSave();
  }, [performSave, setState]);
  const setNoteGroup = useCallback((groupId: string | null) => {
    const id = stateRef.current.editing?.id;
    if (id) void queueMetadata(async () => {
      const { knowledgePoint } = await api.setKnowledgePointGroup(id, groupId); refreshGroupsAndTags(); return knowledgePoint;
    }).catch(() => {});
  }, [queueMetadata, refreshGroupsAndTags]);
  const addTag = useCallback((name: string) => {
    const id = stateRef.current.editing?.id;
    if (id) void queueMetadata(async () => {
      const { knowledgePoint } = await api.addTagToKnowledgePoint(id, name); refreshGroupsAndTags(); return knowledgePoint;
    }).catch(() => {});
  }, [queueMetadata, refreshGroupsAndTags]);
  const removeTag = useCallback((tagId: string) => {
    const id = stateRef.current.editing?.id;
    if (id) void queueMetadata(async () => {
      const { knowledgePoint } = await api.removeTagFromKnowledgePoint(id, tagId);
      refreshGroupsAndTags(); return knowledgePoint;
    }).catch(() => {});
  }, [queueMetadata, refreshGroupsAndTags]);
  const linkQuestion = useCallback((questionId: string) => {
    const id = stateRef.current.editing?.id;
    return id ? queueMetadata(async () => (await api.linkQuestionToKnowledgePoint(id, questionId)).knowledgePoint) : Promise.resolve();
  }, [queueMetadata]);
  const unlinkQuestion = useCallback((questionId: string) => {
    const id = stateRef.current.editing?.id;
    return id ? queueMetadata(async () => (await api.unlinkQuestionFromKnowledgePoint(id, questionId)).knowledgePoint) : Promise.resolve();
  }, [queueMetadata]);

  const uploadImage = useCallback(async (file: File | Blob) => {
    const id = stateRef.current.editing?.id;
    const generation = generationRef.current;
    if (!id) throw new Error("No knowledge point is open");
    const upload = api.uploadKnowledgePointImage(id, file);
    uploadsRef.current.add(upload);
    setState({ uploading: uploadsRef.current.size, uploadError: null, saveStatus: "saving" });
    try {
      const { image } = await upload;
      if (generation !== generationRef.current) throw new Error("The original note is no longer open");
      setState(s => ({ editing: s.editing ? { ...s.editing, images: [...s.editing.images, image] } : null }));
      return image.url;
    } catch (error) {
      if (generation === generationRef.current) setState({ uploadError: "Image upload failed. Retry or dismiss the upload before leaving.", saveStatus: "error" });
      throw error;
    } finally {
      uploadsRef.current.delete(upload);
      if (generation === generationRef.current) setState({ uploading: uploadsRef.current.size });
    }
  }, [setState]);

  const deleteNote = useCallback(async (id: string) => {
    const generation = generationRef.current;
    const deletingCurrent = stateRef.current.editing?.id === id;
    if (deletingCurrent) {
      clearTimers();
      await Promise.allSettled([...(savePromiseRef.current ? [savePromiseRef.current] : []), ...uploadsRef.current]);
    }
    await api.deleteKnowledgePoint(id);
    // Waiting work may have set errors or scheduled another retry. Discard it
    // only after deletion succeeds, without clearing a different note's draft.
    if (deletingCurrent && generation === generationRef.current && stateRef.current.editing?.id === id) closeEditor();
    setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
    refreshGroupsAndTags();
  }, [closeEditor, setState, refreshGroupsAndTags]);

  const hasActiveFilters = state.tagIds.length > 0 || state.search.trim() !== "";
  // Custom position is stored per group across the whole personal library
  // (see /reorder), not per exam — the exam-scoped view only ever shows a
  // subset, so reordering within it would silently corrupt that global
  // order. Same reasoning already applies to tag/search filters above.
  const canReorder = (state.groupId !== null || state.ungrouped) && !hasActiveFilters && state.scope === "all" && state.sort === "custom" && state.orderRevision != null && state.items.length === state.total;

  const store: KnowledgePointsStore = {
    state,
    hasActiveFilters,
    canReorder,
    setFilterGroup,
    toggleFilterTag,
    clearFilters,
    setSearch,
    setSort,
    setScope,
    refreshList,
    loadMore,
    reorderNote,
    refreshGroupsAndTags,
    createGroup,
    renameGroup,
    deleteGroup,
    renameTag,
    deleteTag,
    openNote,
    createAndOpenNote,
    closeEditor,
    setTitle,
    setBodyMarkdown,
    retryNow,
    keepMineAfterConflict,
    reloadAfterConflict,
    setNoteGroup,
    addTag,
    removeTag,
    linkQuestion,
    unlinkQuestion,
    uploadImage,
    deleteNote,
    hasUnsavedWork,
    flushEditor, setComposing, dismissUploadError, discardFailedMetadata,
  };

  return React.createElement(Ctx.Provider, { value: store }, children);
}

export function useKnowledgePoints(): KnowledgePointsStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useKnowledgePoints must be used within a KnowledgePointsProvider");
  return ctx;
}
