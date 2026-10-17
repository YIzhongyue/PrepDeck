import { useId, useRef } from "react";
import { optionText, type ComponentOption, type QuestionContentModel } from "@prepdeck/shared";
import ComponentContent from "./ComponentContent";
import { moveAnswer, setMatch, type inspectAnswerControls } from "../lib/componentAnswerControls";

export function AnswerOption({ option, content }: { option: ComponentOption; content: QuestionContentModel }) {
  return option.body ? <ComponentContent content={content} blocks={option.body} /> : <p>{optionText(option, content)}</p>;
}

export default function ComponentAnswerControls({ state, raw, disabled, change, message, announce }: {
  state: ReturnType<typeof inspectAnswerControls>; raw: string; disabled: boolean; change: (next: string) => boolean;
  message: string; announce: (message: string) => void;
}) {
  const id = useId(), rows = useRef(new Map<string, HTMLLIElement>());
  if (!state.preview || !state.preview.content) return null;
  const { interaction, preview } = state, content = state.preview.content;
  return <section className="component-answer-controls" aria-label="Answer configuration">
    <h4>{interaction.type === "order" ? "Correct sequence" : "Correct matches"}</h4>
    <p>Change the correct answer here. Edit content, IDs and structure in JSON.</p>
    {interaction.type === "order" ? <ol className="component-answer-order">{preview.correctAnswers.map((answer, index) => {
      const option = interaction.options.find(candidate => candidate.id === answer)!;
      return <li key={answer} tabIndex={-1} aria-label={`Answer ${answer}`} ref={element => { if (element) rows.current.set(answer, element); else rows.current.delete(answer); }}>
        <p><strong>Position {index + 1}</strong> · ID: <code>{answer}</code></p>
        <AnswerOption option={option} content={content} />
        <div className="authoring-toolbar">{[-1, 1].map(delta => <button key={delta} type="button" className="btn btn-secondary"
          disabled={disabled || (delta < 0 ? index === 0 : index === preview.correctAnswers.length - 1)}
          aria-label={`Move ${answer} ${delta < 0 ? "up" : "down"}`} onClick={() => {
            if (change(moveAnswer(raw, answer, delta))) {
              rows.current.get(answer)?.focus({ preventScroll: true });
              announce(`${answer} moved to position ${index + delta + 1} of ${preview.correctAnswers.length}.`);
            }
          }}>{delta < 0 ? "↑ Up" : "↓ Down"}</button>)}</div>
      </li>;
    })}</ol> : <>
      <p>A right item may be used more than once or left unused.</p>
      <div className="component-match-columns"><section aria-label="Left items">{interaction.left.map((left, index) => {
        const pair = preview.correctAnswers.map(answer => JSON.parse(answer) as [string, string]).find(([leftId]) => leftId === left.id)!;
        return <div className="component-answer-item" key={left.id}>
          <p><strong>Left ID: <code>{left.id}</code></strong></p><AnswerOption option={left} content={content} />
          <label htmlFor={`${id}-${index}`}>Right item for {left.id}</label>
          <select id={`${id}-${index}`} className="input" value={pair[1]} disabled={disabled} onChange={event => {
            if (change(setMatch(raw, left.id, event.target.value))) announce(`Match for ${left.id} changed.`);
          }}>{interaction.right.map(right => <option key={right.id} value={right.id}>{right.id}: {optionText(right, content)}</option>)}</select>
        </div>;
      })}</section><section aria-label="Right items">{interaction.right.map(right => <div className="component-answer-item" key={right.id}>
        <p><strong>Right ID: <code>{right.id}</code></strong></p><AnswerOption option={right} content={content} />
      </div>)}</section></div>
    </>}
    <p role="status">{message}</p>
  </section>;
}
