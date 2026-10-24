import { optionText, type QuestionContentModel } from "@prepdeck/shared";
import { useI18n } from "../i18n";

export default function StructuredResponse({ content, selected, onChange, disabled = false, correct }: {
  content: QuestionContentModel; selected: string[]; onChange: (answer: string[]) => void; disabled?: boolean; correct?: string[];
}) {
  const { t } = useI18n();
  const i = content.interaction;
  if (i.type !== "order" && i.type !== "match") return null;
  const options = i.type === "order" ? i.options : i.left;
  const pairs = new Map<string, string>();
  if (i.type === "match") for (const answer of selected) { try { const [l, r] = JSON.parse(answer); pairs.set(l, r); } catch { /* An old invalid draft stays visibly unanswered. */ } }
  const displayed = (answers: string[]) => i.type === "order" ? answers.map(id => { const option = i.options.find(o => o.id === id); return option ? optionText(option, content) : id; }).join(" → ") : answers.map(a => {
    try { const [l, r] = JSON.parse(a); return `${optionText(i.left.find(o => o.id === l)!, content)} → ${optionText(i.right.find(o => o.id === r)!, content)}`; } catch { return a; }
  }).join("; ");
  return <fieldset disabled={disabled} style={{ border: 0, padding: 0, minWidth: 0 }}>
    <legend>{t(i.type === "order" ? "study.structured.orderLegend" : "study.structured.matchLegend")}</legend>
    {options.map((o, index) => <label key={o.id} style={{ display: "block", margin: "12px 0" }}>
      {i.type === "order" ? t("study.structured.position", { n: index + 1 }) : optionText(o, content)}
      <select className="input" aria-label={i.type === "order" ? t("study.structured.position", { n: index + 1 }) : t("study.structured.match", { id: o.id })} value={i.type === "order" ? selected[index] ?? "" : pairs.get(o.id) ?? ""} onChange={e => {
        if (i.type === "order") {
          const next = Array.from({ length: options.length }, (_, n) => selected[n] ?? ""); next[index] = e.target.value;
          onChange(next.every(x => !x) ? [] : next);
        } else {
          if (e.target.value) pairs.set(o.id, e.target.value); else pairs.delete(o.id);
          onChange(i.left.filter(l => pairs.has(l.id)).map(l => JSON.stringify([l.id, pairs.get(l.id)])));
        }
      }}><option value="">{t("study.structured.select")}</option>{(i.type === "order" ? i.options : i.right).map(candidate => <option key={candidate.id} value={candidate.id}>{optionText(candidate, content)}</option>)}</select>
    </label>)}
    {correct && <p>{t("study.structured.correctResponse", { response: displayed(correct) })}</p>}
  </fieldset>;
}
