import { useId, useRef } from "react";
import { optionText, type ComponentOption, type QuestionContentModel } from "@prepdeck/shared";
import ComponentContent from "./ComponentContent";
import { moveAnswer, setMatch, type inspectAnswerControls } from "../lib/componentAnswerControls";
import { useI18n } from "../i18n";

export function AnswerOption({ option, content }: { option: ComponentOption; content: QuestionContentModel }) {
  return option.body ? <ComponentContent content={content} blocks={option.body} /> : <p>{optionText(option, content)}</p>;
}

export default function ComponentAnswerControls({ state, raw, disabled, change, message, announce }: {
  state: ReturnType<typeof inspectAnswerControls>; raw: string; disabled: boolean; change: (next: string) => boolean;
  message: string; announce: (message: string) => void;
}) {
  const id = useId(), rows = useRef(new Map<string, HTMLLIElement>());
  const { t, rich } = useI18n();
  if (!state.preview || !state.preview.content) return null;
  const { interaction, preview } = state, content = state.preview.content;
  return <section className="component-answer-controls" aria-label={t("authoring.answers.label")}>
    <h4>{t(interaction.type === "order" ? "authoring.answers.sequence" : "authoring.answers.matches")}</h4>
    <p>{t("authoring.answers.intro")}</p>
    {interaction.type === "order" ? <ol className="component-answer-order">{preview.correctAnswers.map((answer, index) => {
      const option = interaction.options.find(candidate => candidate.id === answer)!;
      return <li key={answer} tabIndex={-1} aria-label={t("authoring.answers.answer", { id: answer })} ref={element => { if (element) rows.current.set(answer, element); else rows.current.delete(answer); }}>
        <p><strong>{t("study.structured.position", { n: index + 1 })}</strong> · {rich("authoring.answers.idCode", { code: (chunks) => <code>{chunks}</code>, id: answer })}</p>
        <AnswerOption option={option} content={content} />
        <div className="authoring-toolbar">{[-1, 1].map(delta => <button key={delta} type="button" className="btn btn-secondary"
          disabled={disabled || (delta < 0 ? index === 0 : index === preview.correctAnswers.length - 1)}
          aria-label={t(delta < 0 ? "authoring.answers.moveUp" : "authoring.answers.moveDown", { id: answer })} onClick={() => {
            if (change(moveAnswer(raw, answer, delta))) {
              rows.current.get(answer)?.focus({ preventScroll: true });
              announce(t("authoring.answers.moved", { id: answer, position: index + delta + 1, total: preview.correctAnswers.length }));
            }
          }}>{t(delta < 0 ? "authoring.answers.up" : "authoring.answers.down")}</button>)}</div>
      </li>;
    })}</ol> : <>
      <p>{t("authoring.answers.rightReuse")}</p>
      <div className="component-match-columns"><section aria-label={t("authoring.answers.leftItems")}>{interaction.left.map((left, index) => {
        const pair = preview.correctAnswers.map(answer => JSON.parse(answer) as [string, string]).find(([leftId]) => leftId === left.id)!;
        return <div className="component-answer-item" key={left.id}>
          <p><strong>{rich("authoring.answers.leftIdCode", { code: (chunks) => <code>{chunks}</code>, id: left.id })}</strong></p><AnswerOption option={left} content={content} />
          <label htmlFor={`${id}-${index}`}>{t("authoring.answers.rightFor", { id: left.id })}</label>
          <select id={`${id}-${index}`} className="input" value={pair[1]} disabled={disabled} onChange={event => {
            if (change(setMatch(raw, left.id, event.target.value))) announce(t("authoring.answers.matchChanged", { id: left.id }));
          }}>{interaction.right.map(right => <option key={right.id} value={right.id}>{right.id}: {optionText(right, content)}</option>)}</select>
        </div>;
      })}</section><section aria-label={t("authoring.answers.rightItems")}>{interaction.right.map(right => <div className="component-answer-item" key={right.id}>
        <p><strong>{rich("authoring.answers.rightIdCode", { code: (chunks) => <code>{chunks}</code>, id: right.id })}</strong></p><AnswerOption option={right} content={content} />
      </div>)}</section></div>
    </>}
    <p role="status">{message}</p>
  </section>;
}
