// Synthetic loopback investigation: active learner paths and the shared renderer
// must be distinguished. Matching option IDs are unique within each side only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { matchPackage } from "../../../docs/proposals/component-authoring/fixtures.mjs";
import { normalizeImportFile, validateComponentPackage } from "../../../packages/shared/src/question-components.ts";
import { readBody, waitUntil } from "./browser-fixture.mjs";
const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const engine = process.env.PLAYWRIGHT_BROWSER || "chromium";
const file = structuredClone(matchPackage);
file.questions[0].needsReview = false;
assert.deepEqual(validateComponentPackage(file), [], "cross-side duplicate IDs and many-to-one answers are legal");
const sameSide = structuredClone(file);
sameSide.questions[0].interaction.right[1].id = "same";
assert.ok(validateComponentPackage(sameSide).length, "same-side duplicates remain invalid");
const row = { ...normalizeImportFile(file).questions[0], id: "matching", examId: "exam", sequenceNumber: 1, revision: 1, answerRevision: 1, archivedAt: null };
const before = JSON.stringify(row);
const answers = ['["same","same"]', '["second","same"]'];
const { outputFiles } = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrepDeckProvider,usePrepDeck} from './src/store/PrepDeckContext'; import {Shell} from './src/App';
import ComponentQuestionEditor from './src/components/ComponentQuestionEditor';
import QuestionImportDialog from './src/components/QuestionImportDialog';
import QuestionContent from './src/components/QuestionContent';
import {ComponentOptionContent} from './src/components/ComponentContent';
import './src/styles/tokens.css'; import './src/styles/app.css';
const row=${JSON.stringify(row)};
function Probe(){window.store=usePrepDeck();return null;}
const path=location.pathname;
const rich=structuredClone(row.content);
rich.interaction.right[0].body.push({id:'right-code',type:'code',text:'rightOnly()'},
 {id:'right-table',type:'table',caption:'Right table',columns:['Side'],rows:[['Right']]},
 {id:'right-figure',type:'figure',assetId:'pixel',alt:'Right pixel'});
const refs=structuredClone(row.content);delete refs.interaction.right[0].body;refs.interaction.right[0].memberRefs=['entry-b'];
createRoot(document.getElementById('root')).render(path==='/editor'?<ComponentQuestionEditor examId="exam" question={row} onClose={()=>{}} onSaved={()=>{}}/>:
 path==='/import'?<QuestionImportDialog examId="exam" onClose={()=>{}} onImported={()=>{}}/>:
 path==='/renderer'?<main style={{padding:24}}>
 <section aria-label="Default left"><QuestionContent src="First entry" content={row.content} optionId="same"/></section>
 <section aria-label="Right Markdown"><QuestionContent src="Shared category" content={row.content} optionId="same" matchingSide="right"/></section>
 <section aria-label="Right mismatched source"><QuestionContent src="First entry" content={row.content} optionId="same" matchingSide="right" qid="matching" target="opt:same" show={true} annotations={[{id:'left-mark',questionId:'matching',targetType:'option',targetRef:'same',rangeStart:0,rangeEnd:5,style:'hl1',note:'Left source annotation'}]}/></section>
 <section aria-label="Missing right ID"><QuestionContent src="Second entry" content={row.content} optionId="second" matchingSide="right"/></section>
 <section aria-label="Explicit left"><ComponentOptionContent content={row.content} optionId="same" matchingSide="left"/></section>
 <section aria-label="Right rich"><QuestionContent src="Shared category" content={rich} optionId="same" matchingSide="right"/></section>
 <section aria-label="Right references"><ComponentOptionContent content={refs} optionId="same" matchingSide="right"/></section>
 </main>:<PrepDeckProvider><Probe/><Shell/></PrepDeckProvider>);`,
 loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false,
 outfile: "fixture.js", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const calls = [], errors = [], unexpected = [], attempts = new Map();
let serial = 0;
const server = createServer(async (req, res) => {
 const url = new URL(req.url, "http://fixture");
 const json = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
 if (!url.pathname.startsWith('/api/')) {
  const asset = outputFiles.find(f => f.path.endsWith(url.pathname.slice(1)));
  if (asset && url.pathname !== '/') { res.setHeader('Content-Type', url.pathname.endsWith('css') ? 'text/css' : 'text/javascript'); return res.end(asset.contents); }
  res.setHeader('Content-Type','text/html'); return res.end('<!doctype html><html lang="en"><head><title>Local matching side fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body data-pd-theme="light"><div id="root"></div><script src="/fixture.js"></script></body></html>');
 }
 const { payload } = await readBody(req); calls.push({ path: url.pathname, method: req.method, payload });
 if (url.pathname === '/api/auth/me') return json({ user: { id:'qa',email:'qa@example.test',displayName:'QA',role:'user' } });
 if (url.pathname === '/api/exams') return json({ exams:[{id:'exam',name:'Synthetic matching',slug:'exam',providers:[],questionCount:1}] });
 if (url.pathname.endsWith('/practice-catalog')) return json({questions:[{...row,correctAnswers:undefined}],bookmarkedIds:[],wrongEntries:[],attemptedIds:[]});
 if (url.pathname.endsWith('/practice-catalog/matching')) return json({content:row.content,revision:1});
 if (url.pathname === '/api/settings') return json({showSharedNotes:true});
 if (url.pathname === '/api/annotation-settings') return json({hl1Alias:'First',hl2Alias:'Second',hl3Alias:'Third'});
 if (url.pathname === '/api/annotations') return json({annotations:[]});
 if (url.pathname === '/api/notes') return json({notes:[]});
 if (url.pathname.endsWith('/learning/progress')) return json({progress:{lastSequenceNumber:1}});
 if (url.pathname.endsWith('/learning-detail')) return json({question:{...row,explanation:'Synthetic explanation'},history:[]});
 if (url.pathname.endsWith('/ai-explanations')) return json({explanations:[]});
 if (url.pathname.endsWith('/knowledge-points')) return json({knowledgePoints:[],total:0});
 if (url.pathname === '/api/attempts/active') return json({attempt:null});
 if (url.pathname.endsWith('/attempts')) { const attempt={...payload,examId:'exam',attemptId:`attempt-${++serial}`,selectedAnswers:{},flagged:{},startedAt:new Date().toISOString()};attempts.set(attempt.attemptId,attempt);return json(attempt,201); }
 if (url.pathname.startsWith('/api/attempts/')) {
  const [,,,id,action,qid]=url.pathname.split('/');const attempt=attempts.get(id);
  if(action==='answers'&&req.method==='PUT'){attempt.selectedAnswers[qid]=payload.selectedAnswer;return json({saved:true});}
  if(action==='answers')return json({isCorrect:true,correctAnswers:answers,explanation:'Synthetic explanation',answerRevision:1});
 }
 if (url.pathname === '/api/import-schemas') return json({capabilities:{blocks:['paragraph'],interactions:['match']}});
 if (url.pathname.endsWith('/import/validate')) return json({valid:true,questionCount:1,issues:[],conflicts:[]});
 return json({error:'Optional fixture route'},503);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await playwright[engine].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 console.log(`Matching investigation: ${engine} ${browser.version()}`);
 const origin=`http://127.0.0.1:${server.address().port}`;
 for(const width of [1280,390]) {
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(url.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});unexpected.push(url.href);return route.abort();});
  const invoke=(method,...args)=>page.evaluate(({method,args})=>window.store[method](...args),{method,args});
  const checkSides=async()=>{
   const select=page.getByRole('combobox',{name:'Match same',exact:true});await select.waitFor();
   assert.match(await select.locator('..').textContent(),/^First entry/);
   assert.equal(await select.locator('option[value="same"]').textContent(),'Shared category');
   assert.equal(await select.locator('option[value="other"]').textContent(),'Other category');
   return select;
  };
  const shot=async name=>{if(process.env.SCREENSHOT_DIR){mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/matching-${name}-${width}.png`,fullPage:true,animations:'disabled'});}};
  await page.goto(origin);await page.waitForFunction(()=>window.store?.state.workspaceStatus==='ready');
  await invoke('begin',['matching']);const select=await checkSides();
  await select.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.getByRole('combobox',{name:'Match second',exact:true}).selectOption('same');
  await page.waitForFunction(()=>window.store.state.sel.matching?.length===2);
  assert.deepEqual(await page.evaluate(()=>window.store.state.sel.matching),answers);
  await page.getByRole('button',{name:'Check answer',exact:true}).click();await page.waitForFunction(()=>!!window.store.state.done.matching);
  assert.equal(await select.isDisabled(),true);assert.match(await page.locator('fieldset').textContent(),/First entry → Shared category; Second entry → Shared category/);
  assert.deepEqual(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/answers')).at(-1).payload.selectedAnswer,answers);
  await shot('practice');
  await invoke('go','learning');await invoke('beginLearning',1);await page.getByRole('progressbar',{name:'Learning progress',exact:true}).waitFor();await checkSides();assert.equal(await select.isDisabled(),true);await shot('learning');
  await invoke('go','mock');await invoke('beginMock');await page.getByRole('timer').waitFor();await checkSides();assert.equal(await select.isDisabled(),false);
  await select.selectOption('same');await page.getByRole('combobox',{name:'Match second',exact:true}).selectOption('same');
  await page.waitForFunction(()=>window.store.state.mSel.matching?.length===2);
  await waitUntil('both matching draft pairs persisted',()=>[...attempts.values()].at(-1).selectedAnswers.matching,{until:value=>value?.length===2});
  assert.deepEqual([...attempts.values()].at(-1).selectedAnswers.matching,answers);await shot('mock');
  console.log(`PASS ${width}: Learning, Practice and Mock already resolve both sides; many-to-one payloads unchanged`);
  const previewCallStart=calls.length;
  await page.goto(`${origin}/editor`);await page.getByRole('region',{name:'Left preview items',exact:true}).getByText('First entry',{exact:true}).waitFor();
  await page.getByRole('region',{name:'Right preview items',exact:true}).getByText('Shared category',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Answer controls',exact:true}).click();await page.getByRole('region',{name:'Right items',exact:true}).getByText('Shared category',{exact:true}).waitFor();await shot('editor');
  await page.goto(`${origin}/import`);await page.getByLabel('Question import JSON file').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
  await page.getByText('Preview imported questions',{exact:true}).click();const preview=page.locator('.authoring-preview');
  await preview.getByText('First entry',{exact:true}).waitFor();assert.match(await preview.textContent(),/First entry → Shared category/);await shot('import');
  assert.equal(calls.slice(previewCallStart).some(c=>c.path.includes('/questions/')&&c.method==='PATCH'||c.path.endsWith('/import')),false,'previewing does not save or import');
  console.log(`PASS ${width}: editor and existing left-projection import preview are side-correct`);
  await page.goto(`${origin}/renderer`);await page.getByRole('region',{name:'Default left',exact:true}).getByText('First entry',{exact:true}).waitFor();await shot('renderer');
  const right=page.getByRole('region',{name:'Right Markdown',exact:true});
  assert.equal(await right.textContent(),'Shared category','an explicit right-side render must not select the colliding left item');
  assert.ok(await right.locator('[data-off]').count(),'matching Markdown uses its own source coordinates');
  const mismatch=page.getByRole('region',{name:'Right mismatched source',exact:true});
  assert.equal(await mismatch.textContent(),'Shared category');assert.equal(await mismatch.locator('[title="Left source annotation"]').count(),0,'left Markdown offsets must not annotate the right item');
  assert.equal(await page.getByRole('region',{name:'Missing right ID',exact:true}).textContent(),'','a missing right ID must not fall back to the left side');
  assert.equal(await page.getByRole('region',{name:'Explicit left',exact:true}).textContent(),'First entry');
  const rich=page.getByRole('region',{name:'Right rich',exact:true});assert.equal(await rich.locator('pre code').textContent(),'rightOnly()');
  assert.equal(await rich.getByRole('table').count(),1);assert.equal(await rich.getByRole('img',{name:'Right pixel'}).evaluate(img=>img.complete&&img.naturalWidth>0),true);
  assert.equal(await page.getByRole('region',{name:'Right references',exact:true}).textContent(),'entry-b: Check the result');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.close();
 }
 assert.equal(JSON.stringify(row),before);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 console.log('PASS side-aware rich renderer; source data, schema, learner answers and previews preserved');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
