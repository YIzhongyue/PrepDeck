// implementation — Knowledge Points: personal, concept-level Markdown notes.
// Top-level screen: owns the feature's own provider and its internal
// list/editor/groups-and-tags navigation, the same way Practice/Mock/Learning
// each own an internal "Stage" rather than adding more top-level ScreenId
// values for a single feature's sub-views. The open note is the store's
// kpNoteId, so the URL can name it (/knowledge-points/:id, issue #41).

import { useState } from "react";
import type { Breakpoints } from "../lib/responsive";
import { usePrepDeck } from "../store/PrepDeckContext";
import { KnowledgePointsProvider } from "../store/useKnowledgePoints";
import KnowledgePointsList from "./knowledgePoints/KnowledgePointsList";
import KnowledgePointEditor from "./knowledgePoints/KnowledgePointEditor";
import KnowledgePointGroupsAndTags from "./knowledgePoints/KnowledgePointGroupsAndTags";

function KnowledgePointsInner({ bp }: { bp: Breakpoints }) {
  // An open note (arriving from Learning Mode's related-notes card, a link, or
  // Back/Forward) wins over the list and the groups-and-tags view.
  const { state: appState, showKnowledgePoint } = usePrepDeck();
  const [managing, setManaging] = useState(false);
  const noteId = appState.kpNoteId;

  if (noteId) {
    return (
      <KnowledgePointEditor
        bp={bp}
        noteId={noteId}
        onBack={() => showKnowledgePoint(null)}
        onOpenNote={(id) => showKnowledgePoint(id)}
        onDeleted={() => showKnowledgePoint(null)}
      />
    );
  }
  if (managing) {
    return <KnowledgePointGroupsAndTags onBack={() => setManaging(false)} />;
  }
  return (
    <KnowledgePointsList
      bp={bp}
      onOpenNote={(id) => { setManaging(false); showKnowledgePoint(id); }}
      onManage={() => setManaging(true)}
    />
  );
}

export default function KnowledgePoints({ bp }: { bp: Breakpoints }) {
  const { state } = usePrepDeck();
  return (
    <KnowledgePointsProvider activeExamId={state.examId}>
      <KnowledgePointsInner bp={bp} />
    </KnowledgePointsProvider>
  );
}
