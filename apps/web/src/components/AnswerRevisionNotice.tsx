export default function AnswerRevisionNotice({ revisedAt, historical = false, gradedAnswers }: {
  revisedAt?: string | null; historical?: boolean; gradedAnswers?: string[] | null;
}) {
  if (!revisedAt) return null;
  return <div role="note" style={{ fontSize: 12, padding: "8px 10px", borderRadius: 10, background: "var(--color-neutral-100)", margin: "8px 0" }}>
    <strong>Answer revised</strong> · {new Date(revisedAt).toLocaleString()}
    {historical && <div>This result reflects the answer key at the time of the attempt. Historical scores are unchanged.
      {gradedAnswers ? ` Graded answer key: ${gradedAnswers.join(", ")}.` : " The original answer key was not recorded for this legacy attempt."}</div>}
  </div>;
}
