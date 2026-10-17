// Isolated discovery artifact: never imported into the application or router.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatAnswerText, optionText } from "../../../packages/shared/src/index.ts";
import QuestionContent from "../../../apps/web/src/components/QuestionContent.tsx";
import ComponentContent from "../../../apps/web/src/components/ComponentContent.tsx";
import { inspect, moveAnswer, setMatch } from "./model.mjs";
import { fixtures } from "./fixtures.mjs";
import "./prototype.css";

export default function Prototype() {
  const [raw, setRaw] = useState(fixtures.ordering);
  const [mode, setMode] = useState("form");
  const [history, setHistory] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [movedId, setMovedId] = useState("");
  const rows = useRef(new Map<string, HTMLLIElement>());
  const state = useMemo(() => inspect(raw), [raw]);
  useLayoutEffect(() => { if (movedId) rows.current.get(movedId)?.focus(); }, [raw, movedId]);
  const change = (next: string) => {
    if (next === raw) return;
    setHistory(previous => [...previous, raw]); setRaw(next);
  };
  const preview = state.preview;
  const interaction = state.item?.interaction;
  return <main className="discovery">
    <header><span className="discovery-label">PROPOSAL · SYNTHETIC DATA ONLY</span><h1>Ordering & matching authoring</h1>
      <p>Explore answer controls for one existing component question. This prototype has no save endpoint.</p></header>
    <nav aria-label="Synthetic examples">
      {Object.entries(fixtures).map(([name, value]) => <button key={name} onClick={() => {
        setRaw(value); setHistory([]); setMessage(""); setMovedId("");
      }}>{name[0].toUpperCase() + name.slice(1)}</button>)}
    </nav>
    <div className="discovery-toolbar"><div role="group" aria-label="Editing mode">
      <button aria-pressed={mode === "form"} onClick={() => setMode("form")}>Answer controls</button>
      <button aria-pressed={mode === "json"} onClick={() => setMode("json")}>Return to JSON</button>
    </div><button disabled={!history.length} onClick={() => {
      setRaw(history[history.length - 1]); setHistory(previous => previous.slice(0, -1)); setMovedId(""); setMessage("Previous draft restored exactly.");
    }}>Undo last change</button><span>{history.length ? "Draft changed · local only" : "Example unchanged"}</span></div>
    <div className="discovery-grid">
      <section aria-label="Answer authoring">
        <div hidden={mode !== "json"}><label>Question package JSON<textarea spellCheck={false} value={raw} onChange={event => {
          change(event.target.value); setMovedId("");
        }} /></label><p>Switching views never parses and rewrites this source. Edit content, IDs and structure here.</p></div>
        <div hidden={mode !== "form"}>
          {!preview ? <div role="alert"><h2>Keep this package in JSON</h2><p>{state.reason}</p>
            {state.issues && <ul>{state.issues.map((issue, index) => <li key={index}><code>{issue.path}</code>: {issue.message}</li>)}</ul>}
            <p>The original source remains available, unchanged by these controls.</p></div> : <>
            <h2>{interaction.type === "order" ? "Correct sequence" : "Correct matches"}</h2>
            <p>IDs and displayed option order stay unchanged. Content and shared materials remain in JSON.</p>
            {interaction.type === "order" ? <ol className="answer-order">{state.item.scoring.correctAnswers.map((id, index) => {
              const option = interaction.options.find(candidate => candidate.id === id);
              return <li key={id} tabIndex={-1} ref={element => { if (element) rows.current.set(id, element); else rows.current.delete(id); }} aria-label={`Answer ${id}`}>
                <div><strong>{index + 1}. {optionText(option, preview.content)}</strong><small>ID: {id}</small></div><div className="move-buttons">
                  {[-1, 1].map(delta => <button key={delta} disabled={delta < 0 ? index === 0 : index === interaction.options.length - 1}
                    aria-label={`Move ${id} ${delta < 0 ? "up" : "down"}`} onClick={() => {
                      change(moveAnswer(raw, id, delta)); setMovedId(id); setMessage(`${id} moved to position ${index + delta + 1} of ${interaction.options.length}.`);
                    }}>{delta < 0 ? "↑ Up" : "↓ Down"}</button>)}
                </div>
              </li>;
            })}</ol> : <><p>A right-hand target may be used more than once.</p>{interaction.left.map(left => {
              const pair = state.item.scoring.correctAnswers.map(answer => JSON.parse(answer)).find(([id]) => id === left.id);
              return <label key={left.id} className="match-field">{optionText(left, preview.content)} <small>Left ID: {left.id}</small>
                <select aria-label={`Match ${left.id}`} value={pair[1]} onChange={event => {
                  change(setMatch(raw, left.id, event.target.value)); setMovedId(""); setMessage(`Match for ${left.id} changed.`);
                }}>{interaction.right.map(right => <option key={right.id} value={right.id}>{optionText(right, preview.content)} (ID: {right.id})</option>)}</select>
              </label>;
            })}</>}
          </>}
        </div>
        <p role="status" className="status">{message}</p>
      </section>
      <section aria-label="Read-only question preview"><h2>Read-only preview</h2>
        {preview ? <><QuestionContent src={preview.stem} content={preview.content} />
          {(interaction.type === "order" ? [["Options", interaction.options]] : [["Left", interaction.left], ["Right", interaction.right]]).map(([label, options]) =>
            <div key={label}><h3>{label}</h3>{options.map(option => <div className="preview-option" key={option.id}><strong>ID: {option.id}</strong>
              {option.body ? <ComponentContent content={preview.content} blocks={option.body} /> : <p>{optionText(option, preview.content)}</p>}
            </div>)}</div>)}
          <p className="correct-response"><strong>Correct response: </strong>{formatAnswerText(preview, preview.correctAnswers)}</p>
        </> : <p>No current valid preview. Correct the source in JSON; no previous question is substituted.</p>}
      </section>
    </div>
    <footer>Discovery artifact for issue #155. No storage, learning state, AI requests, import or bank write. Product implementation awaits owner approval.</footer>
  </main>;
}
