import { useEffect } from "react";
import { useNotesActions, useNotesState, useWorkspaceState } from "../store/PrepDeckContext";
import { useI18n } from "../i18n";

/** One bounded page on entry; subsequent pages require a deliberate click. */
export default function NotesPagination({ questionId }: { questionId?: string }) {
  const { loadNotesPage } = useNotesActions();
  const { notesPages } = useNotesState();
  const { examId, switching } = useWorkspaceState();
  const page = notesPages[questionId ? `question:${questionId}` : "exam"];
  const { t } = useI18n();
  useEffect(() => { if (!page && examId && !switching) loadNotesPage(questionId); }, [page, questionId, loadNotesPage, examId, switching]);
  if (page?.status === "ready" && !page.cursor) return null;
  return <div>
    {page?.status === "error" && <p role="alert">{t("errors.kp.loadMore")}</p>}
    <button type="button" className="btn btn-ghost" disabled={!page || page.status === "loading"}
      onClick={() => loadNotesPage(questionId)}>
      {!page || page.status === "loading" ? t("common.loading") : t("kp.list.loadMore")}
    </button>
  </div>;
}
