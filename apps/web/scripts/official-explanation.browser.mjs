// Synthetic loopback fixtures: real editor, Learning and graded Practice screens.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";
import { validateQuestionRow } from "../../../packages/shared/src/import-validate.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const explanation = "## Compare the rules\n\nBefore the table.\n\n| Choice | Reason | Evidence | Literal HTML |\n| :--- | :---: | ---: | --- |\n| **A** | x \\| y | [docs](https://example.test/evidence) | <em>plain</em> |\n| B | `code \\| pipe` | [bad](javascript:alert) | <img src=x onerror=alert(1)> |\n| short |\n- After the table: keep a | b | c.\n\n```text\ncode | stays | code\n```\n\nExplanation end.";
const plainTable = "Stem | Other\n--- | ---\nvalue | text";
let question = { id:"table-fixture", examId:"exam", sequenceNumber:1, externalId:"SYNTHETIC-149", revision:1,
  type:"single_choice", stem:plainTable, options:[{id:"A",text:plainTable},{id:"B",text:"Other answer"}],
  correctAnswers:["A"], explanation, tags:[], difficulty:"easy", points:1, needsReview:false };
const calls = [], errors = [];
const { outputFiles } = await build({ stdin: { contents: `
  import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
  import QuestionEditorDialog from './src/components/QuestionEditorDialog';
  import LearningLive from './src/screens/LearningLive'; import PracticeLive from './src/screens/PracticeLive';
  import {__TestStore} from './src/store/PrepDeckContext'; import {breakpointsFor} from './src/lib/responsive';
  import './src/styles/tokens.css'; import './src/styles/app.css';
  window.studyActions = []; const action = name => (...args) => window.studyActions.push({name,args});
  function freeze(value) { if(value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);} return value; }
  function Fixture({initial}) {
    const [q,setQ] = useState(()=>freeze(initial)); const [open,setOpen] = useState(false); window.fixtureQuestion=q;
    if(location.pathname === '/editor') return <><button onClick={()=>setOpen(true)}>Open editor</button>{open && <QuestionEditorDialog
      examId="exam" question={q} initialType="single_choice" onClose={()=>setOpen(false)} onSaved={q=>{setQ(freeze(q));setOpen(false);}}/>}</>;
    const anns = ['stem','opt:A'].map(target=>({id:target,qid:q.id,target,start:0,end:4,style:'underline',note:'Retained source mark'}));
    const state = freeze({queue:[q.id],idx:0,done:{[q.id]:'ok'},graded:{[q.id]:{correctAnswers:q.correctAnswers,explanation:q.explanation}},sel:{[q.id]:['A']},
      lQueue:[q.id],lIdx:0,lVisit:1,lDetail:{[q.id]:{status:'ready',correctAnswers:q.correctAnswers,explanation:q.explanation,history:[]}},
      catalogBy:{[q.id]:q},questionContent:{},notes:[],anns,ai:{[q.id]:{status:'ready',content:${JSON.stringify(plainTable)},provider:'openai',model:'fixture',cached:true}},
      provider:'openai',model:'fixture',studyStatus:{},bookmarks:{}});
    const store = {state,width:innerWidth,height:innerHeight,learningQ:()=>q,curQ:()=>q,mockQ:()=>undefined,
      markLearningViewed:action('view'),prefetchQuestions:action('prefetch'),capture:action('capture'),checkAiCache:action('cache')};
    const Screen = location.pathname === '/learning' ? LearningLive : PracticeLive;
    return <__TestStore store={store}><Screen bp={breakpointsFor(innerWidth,innerHeight)}/></__TestStore>;
  }
  fetch('/fixture-question').then(r=>r.json()).then(initial=>createRoot(document.getElementById('root')).render(<Fixture initial={initial}/>));
`, loader:"tsx", resolveDir:fileURLToPath(new URL("../", import.meta.url)) }, plugins:[{name:"reference-context",setup(api) {
    api.onLoad({filter:/[\\/]PrepDeckContext\.tsx$/}, args=>({loader:"tsx",contents:readFileSync(args.path,"utf8")+"\nexport { StoreProviders as __TestStore };"}));
  }}], bundle:true, write:false, outfile:"fixture.js", platform:"browser", jsx:"automatic", define:{"process.env.NODE_ENV":'"development"'} });
const server = createServer(async (req,res) => {
  const url = new URL(req.url,"http://fixture");
  const json = (status,body)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(body));};
  if(url.pathname === '/fixture-question') return json(200,question);
  if(url.pathname.startsWith('/api/')) {
    const {payload} = await readBody(req); calls.push({method:req.method,path:url.pathname,payload});
    if(req.method === 'GET' && url.pathname === '/api/admin/question-tags') return json(200,{tags:[]});
    if(req.method === 'PATCH' && url.pathname === '/api/exams/exam/questions/table-fixture') {
      const issues = validateQuestionRow(payload,'$'); if(issues.length) return json(422,{issues});
      question = {...question,...payload,revision:question.revision+1}; return json(200,{question});
    }
    return json(500,{error:'Unexpected fixture request'});
  }
  if(url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
    res.setHeader('Content-Type',url.pathname.endsWith('css')?'text/css':'text/javascript');
    return res.end(outputFiles.find(f=>f.path.endsWith(url.pathname.slice(1))).contents);
  }
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" style="padding:16px;max-width:1400px;margin:auto"></main><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  console.log(`Official explanation browser: Chromium ${browser.version()}`);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  context.setDefaultTimeout(10000);
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  if(process.env.SCREENSHOT_DIR) mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});
  for(const width of [390,1440]) {
    const editor = await context.newPage(); await editor.setViewportSize({width,height:1000}); editor.on('pageerror',e=>errors.push(e.message));
    await editor.goto(`${origin}/editor`); await editor.getByRole('button',{name:'Open editor',exact:true}).click();
    const show = async()=>{if(width<1100) await editor.getByRole('button',{name:'Preview',exact:true}).click();};
    const edit = async()=>{if(width<1100) await editor.getByRole('button',{name:'Edit',exact:true}).click();};
    const sourceBefore = structuredClone(question);
    const draft = explanation.replace('Compare the rules',`Unsaved table at ${width}px`);
    await editor.getByLabel('Official explanation · Markdown',{exact:true}).fill(draft);
    await show();
    const verify = async page => {
      const official = page.locator('.st-official'); await official.locator('table').waitFor({state:'attached'});
      const more = official.getByRole('button',{name:'Show more',exact:true});
      if(await more.isVisible()) await more.click();
      const table = official.getByRole('table');
      assert.equal(await table.getByRole('columnheader').count(),4);
      assert.deepEqual(await table.getByRole('columnheader').allTextContents(),['Choice','Reason','Evidence','Literal HTML']);
      assert.deepEqual(await table.locator('tbody tr').last().locator('td').allTextContents(),['short','','','']);
      assert.deepEqual(await table.locator('thead th').evaluateAll(cells=>cells.map(c=>getComputedStyle(c).textAlign)),['left','center','right','left']);
      await table.getByText('x | y',{exact:true}).waitFor();
      await table.getByText('code | pipe',{exact:true}).waitFor();
      const link = table.getByRole('link',{name:'docs',exact:true}); assert.equal(await link.getAttribute('href'),'https://example.test/evidence');
      assert.equal(await link.getAttribute('rel'),'noreferrer noopener');
      assert.equal(await table.locator('a').count(),1);
      assert.equal(await table.locator('img, em, script').count(),0);
      await table.getByText('<em>plain</em>',{exact:true}).waitFor();
      await table.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor();
      assert.equal(await official.locator('li').textContent(),'After the table: keep a | b | c.');
      assert.equal(await official.locator('pre').textContent(),'code | stays | code');
      await official.getByText('Explanation end.',{exact:true}).waitFor();
      assert.equal(await official.locator('[data-off]').evaluateAll((nodes,src)=>nodes.every(n=>!n.textContent || src.slice(Number(n.dataset.off),Number(n.dataset.off)+n.textContent.length)===n.textContent),draft),true,'All visible spans keep source offsets, including escaped pipes and links');
      assert.equal(await page.locator('.st-stem table, .st-opts table, .st-panel > :not(.st-official) table').count(),0,'Stem, option and AI table opt-ins remain off');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No page overflow');
      const scroller = table.locator('..');
      assert.equal(await scroller.evaluate(el=>getComputedStyle(el).overflowX),'auto');
      if(width===390) {
        assert.equal(await scroller.evaluate(el=>el.scrollWidth>el.clientWidth),true,'Wide table scrolls inside official content');
        assert.ok(await scroller.evaluate(el=>{el.scrollLeft=el.scrollWidth;return el.scrollLeft;})>0);
        await scroller.evaluate(el=>{el.scrollLeft=0;});
      }
      return official.locator('.st-prose').innerHTML();
    };
    const previewMarkup = await verify(editor);
    assert.deepEqual(await editor.evaluate(()=>window.fixtureQuestion),sourceBefore,'Unsaved preview does not mutate the question');
    assert.deepEqual(await editor.evaluate(()=>window.studyActions),[]);
    if(process.env.SCREENSHOT_DIR) await editor.screenshot({path:`${process.env.SCREENSHOT_DIR}/editor-${width}.png`,fullPage:true,animations:'disabled'});
    await edit(); await editor.getByRole('button',{name:'Save',exact:true}).click();
    await editor.getByRole('dialog').waitFor({state:'detached'});
    assert.equal(question.explanation,draft,'Save persists original Markdown, not table HTML');
    assert.equal(calls.filter(c=>c.method==='PATCH').at(-1).payload.explanation,draft);
    await editor.getByRole('button',{name:'Open editor',exact:true}).click(); await show();
    assert.equal(await verify(editor),previewMarkup,'Saved/reopened preview matches the unsaved rendering');
    await editor.close();
    for(const surface of ['learning','practice']) {
      const page = await context.newPage(); await page.setViewportSize({width,height:1000}); page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`${origin}/${surface}`);
      assert.equal(await verify(page),previewMarkup,`${surface} matches editor official content`);
      for(const selector of ['.st-stem','.st-opt-main']) {
        const mark = page.locator(`${selector} [data-off="0"]`).first();
        assert.equal(await mark.textContent(),'Stem');
        assert.equal(await mark.evaluate(el=>getComputedStyle(el).textDecorationLine),'underline','Existing source marks survive on adjacent content');
      }
      assert.deepEqual(await page.evaluate(()=>window.fixtureQuestion),question);
      if(process.env.SCREENSHOT_DIR && surface==='learning') await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/learning-${width}.png`,fullPage:true,animations:'disabled'});
      await page.close();
    }
    console.log(`PASS ${width}px unsaved/save/reopen editor, Learning and graded Practice: semantic tables, safe markup, source offsets and contained scroll`);
  }
  assert.deepEqual(errors,[]);
  assert.ok(calls.every(c=>c.path==='/api/admin/question-tags' || c.method==='PATCH' && c.path==='/api/exams/exam/questions/table-fixture'));
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
