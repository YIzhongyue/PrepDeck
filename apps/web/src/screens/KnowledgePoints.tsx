// implementation — Knowledge Points: personal, concept-level Markdown notes.
// Top-level screen: owns the feature's own provider and its internal
// list/editor/groups-and-tags navigation as local state, the same way
// Practice/Mock/Learning each own an internal "Stage" rather than adding
// more top-level ScreenId values for a single feature's sub-views.

import { useEffect, useState } from "react";
import type { Breakpoints } from "../lib/responsive";
import { usePrepDeck } from "../store/PrepDeckContext";
import { KnowledgePointsProvider } from "../store/useKnowledgePoints";
import KnowledgePointsList from "./knowledgePoints/KnowledgePointsList";
import KnowledgePointEditor from "./knowledgePoints/KnowledgePointEditor";
import KnowledgePointGroupsAndTags from "./knowledgePoints/KnowledgePointGroupsAndTags";

type View = { kind: "list" } | { kind: "editor"; noteId: string } | { kind: "manage" };

function KnowledgePointsInner({ bp }: { bp: Breakpoints }) {
  // implementation — arriving here via usePrepDeck().openKnowledgePointNote(id)
  // (e.g. from Learning Mode's related-notes card) should land straight in
  // the editor for that note, not the list. The lazy initializer covers a
  // fresh mount; the effect covers navigating to another related note while
  // this screen is already mounted (state.screen stays "knowledgePoints", so
  // no remount happens).
  const { state: appState, clearPendingKnowledgePoint } = usePrepDeck();
  const [view, setView] = useState<View>(() =>
    appState.pendingKnowledgePointId ? { kind: "editor", noteId: appState.pendingKnowledgePointId } : { kind: "list" }
  );
  useEffect(() => {
    if (!appState.pendingKnowledgePointId) return;
    setView({ kind: "editor", noteId: appState.pendingKnowledgePointId });
    clearPendingKnowledgePoint();
  }, [appState.pendingKnowledgePointId, clearPendingKnowledgePoint]);

  if (view.kind === "editor") {
    return (
      <KnowledgePointEditor
        bp={bp}
        noteId={view.noteId}
        onBack={() => setView({ kind: "list" })}
        onOpenNote={(id) => setView({ kind: "editor", noteId: id })}
        onDeleted={() => setView({ kind: "list" })}
      />
    );
  }
  if (view.kind === "manage") {
    return <KnowledgePointGroupsAndTags onBack={() => setView({ kind: "list" })} />;
  }
  return (
    <KnowledgePointsList
      bp={bp}
      onOpenNote={(id) => setView({ kind: "editor", noteId: id })}
      onManage={() => setView({ kind: "manage" })}
    />
  );
}

export default function KnowledgePoints({ bp }: { bp: Breakpoints }) {
  const { state } = usePrepDeck();
  return (
    <KnowledgePointsProvider activeExamId={state.examId}>
      <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Personal library · Available across all exams</p>
      <KnowledgePointsInner bp={bp} />
    </KnowledgePointsProvider>
  );
}
