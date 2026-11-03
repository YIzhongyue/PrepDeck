// Explicit isolated-browser check; real React lifecycle, synthetic transport.
// Run with node apps/web/scripts/notes-pagination.browser.mjs from the repository root.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const entry = `
import React, {createContext,useCallback,useRef,useState,useContext} from 'react';
import {createRoot} from 'react-dom/client';
import {useQuestionNotes} from './src/store/actions/useQuestionNotes';
import NotesPagination from './src/components/NotesPagination';
import {WorkspaceRequests} from './src/lib/examWorkspace';
import {NotesContext} from 'test-context';
window.calls=[]; window.failNext=false;
window.notesFetch=async path=>{
  window.calls.push(path);
  if(window.failNext){window.failNext=false;throw Error('synthetic failure');}
  return {notes:[],nextCursor:path.includes('cursor=')?null:'next'};
};
function App(){
 const [state,render]=useState({examId:'exam',notes:[],notesPages:{},showShared:true});
 const stateRef=useRef(state); const requests=useRef(new WorkspaceRequests()).current;
 const setState=useCallback(p=>{stateRef.current={...stateRef.current,...(typeof p==='function'?p(stateRef.current):p)};render(stateRef.current)},[]);
 const scopedState=useCallback(lane=>{const valid=requests.capture(lane);return p=>{if(valid())setState(p)}},[requests,setState]);
 const actions=useQuestionNotes({stateRef,requests,setState,scopedState});
 const [qid,setQid]=useState(undefined);
 window.switchQuestion=()=>setQid('q'); window.testState=state;
 return <NotesContext.Provider value={{state,actions}}><NotesPagination questionId={qid}/></NotesContext.Provider>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`;
const output = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", plugins: [{ name: "synthetic-boundaries", setup(builder) {
  builder.onResolve({ filter: /^(test-context|.*\/store\/PrepDeckContext|.*\/lib\/api|.*\/i18n(?:\/runtime)?)$/ }, args => ({ path: args.path.includes("PrepDeckContext") ? "test-context" : args.path, namespace: "synthetic" }));
  builder.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ contents: args.path === "test-context"
    ? `import {createContext,useContext} from 'react'; export const NotesContext=createContext(null); export const useNotesState=()=>useContext(NotesContext).state; export const useWorkspaceState=useNotesState; export const useNotesActions=()=>useContext(NotesContext).actions;`
    : args.path.endsWith("/api") ? `export const apiFetch=(...args)=>window.notesFetch(...args);`
    : `export const t=key=>key; export const useI18n=()=>({t});`, resolveDir: fileURLToPath(new URL("..", import.meta.url)) }));
} }] });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/main.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/main.js" ? output.outputFiles[0].text : '<div id="root"></div><script type="module" src="/main.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const context = await browser.newContext();
  const base = `http://127.0.0.1:${server.address().port}`;
  await context.route("**/*", route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole("button", { name: "kp.list.loadMore" }).waitFor();
  assert.equal(await page.evaluate(() => window.calls.length), 1, "StrictMode does not fetch every page or duplicate first request");
  await page.evaluate(() => { window.failNext = true; });
  await page.getByRole("button").click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button").click();
  await page.waitForFunction(() => window.testState.notesPages.exam?.status === "ready" && window.testState.notesPages.exam.cursor === null);
  assert.equal(await page.getByRole("button").count(), 0);
  await page.evaluate(() => window.switchQuestion());
  await page.getByRole("button", { name: "kp.list.loadMore" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.calls), ["/api/notes?examId=exam", "/api/notes?examId=exam&cursor=next", "/api/notes?examId=exam&cursor=next", "/api/questions/q/notes?"]);
  console.log(JSON.stringify({ passed: true, browser: browser.version(), checks: ["React StrictMode single page", "explicit load more", "retry cursor", "question lazy loading"] }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
