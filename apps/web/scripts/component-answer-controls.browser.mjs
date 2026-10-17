// Actual component editor, parser, preview and draft guard; synthetic loopback data only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { orderPackage, matchPackage } from "../../../docs/proposals/component-authoring/fixtures.mjs";
import { findNodeAtLocation, parseTree } from "jsonc-parser";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readBody } from "./browser-fixture.mjs";
import { normalizeImportFile } from "../../../packages/shared/src/question-components.ts";
const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const engine = process.env.PLAYWRIGHT_BROWSER || "chromium";

const richMatch=structuredClone(matchPackage);
richMatch.questions[0].interaction.right[0].body.push({id:"right-table",type:"table",caption:"Right category table",columns:["Kind","Code"],rows:[["Shared","R1"]]},
 {id:"right-code",type:"code",language:"text",text:"rightCategory()"},
 {id:"right-figure",type:"figure",assetId:"pixel",alt:"Right category pixel"});
const questions=Object.fromEntries(Object.entries({order:orderPackage,match:richMatch}).map(([name,data])=>[name,{
 ...normalizeImportFile(data).questions[0],id:"answer-fixture",examId:"exam",sequenceNumber:1,revision:1,answerRevision:1,answerRevisedAt:null,archivedAt:null
}]));
let row, fail=false, failGet=false, held=null;
const writes=[],reads=[],errors=[],unexpected=[];
const {outputFiles}=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import ComponentQuestionEditor from './src/components/ComponentQuestionEditor';import './src/styles/tokens.css';import './src/styles/app.css';
 const questions=${JSON.stringify(questions)};
 function Fixture(){const [q,setQ]=useState(questions[location.search.includes('match')?'match':'order']),[open,setOpen]=useState(true);
 return <main><button onClick={()=>setOpen(true)}>Open editor</button>{open&&<ComponentQuestionEditor examId="exam" question={q} onClose={()=>setOpen(false)} onSaved={saved=>{setQ(saved);setOpen(false)}}/>}</main>}
 createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`,loader:"tsx",resolveDir:fileURLToPath(new URL("../",import.meta.url))},bundle:true,write:false,outfile:"fixture.js",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'}});
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,"http://fixture"),json=(status,value)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(value));};
 if(url.pathname.startsWith('/api/')){
  if(url.pathname!=="/api/exams/exam/questions/answer-fixture"){unexpected.push(url.pathname);return json(404,{});}
  if(req.method==='GET'){reads.push(row.revision);if(failGet)return json(503,{error:"Synthetic load failure"});return json(200,{question:row});}
  if(req.method!=='PATCH'){unexpected.push(req.method);return json(405,{});}
  const {payload}=await readBody(req);writes.push(payload);
  if(held){const wait=held;wait.arrived.resolve();await wait.gate.promise;}
  if(fail)return json(503,{error:"Synthetic save failure"});
  if(payload.expectedRevision!==row.revision)return json(409,{error:"Question changed",code:"stale_question"});
  row={...row,...payload,revision:row.revision+1};return json(200,{question:row});
 }
 const file=outputFiles.find(f=>f.path.endsWith(url.pathname.slice(1)));
 if(file&&url.pathname!=="/"){res.setHeader("Content-Type",url.pathname.endsWith("css")?"text/css":"text/javascript");return res.end(file.contents);}
 res.setHeader("Content-Type","text/html");res.end('<!doctype html><html lang="en"><head><title>Local answer controls</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body data-pd-theme="light"><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
const mask=raw=>{const n=findNodeAtLocation(parseTree(raw),["questions",0,"scoring","correctAnswers"]);return raw.slice(0,n.offset)+"<answers>"+raw.slice(n.offset+n.length);};
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;
try{
 browser=await playwright[engine].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 console.log(`Answer controls browser: ${engine} ${browser.version()}`);
 const origin=`http://127.0.0.1:${server.address().port}`;
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390});const page=await context.newPage();page.setDefaultTimeout(10000);page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",route=>{
   const url=new URL(route.request().url());
   if(url.origin===origin)return route.continue();
   // Existing app CSS requests Google Fonts. Supply an empty local response;
   // nothing leaves loopback, and any other attempted external request fails.
   if(url.hostname==="fonts.googleapis.com")return route.fulfill({contentType:"text/css",body:""});
   unexpected.push(url.href);return route.abort();
  });
  const editor=page.getByRole("dialog",{name:"Edit component question",exact:true}),field=editor.getByRole("textbox",{name:"Question package JSON",includeHidden:true}),json=editor.getByRole("button",{name:"JSON",exact:true}),visual=editor.getByRole("button",{name:"Answer controls",exact:true});
  const save=editor.getByRole("button",{name:"Save",exact:true}),status=editor.locator(".authoring-save-status"),controls=editor.getByRole("region",{name:"Answer configuration"});
  const source=()=>field.inputValue();
  const start=async kind=>{row=structuredClone(questions[kind]);fail=false;failGet=false;await page.goto(`${origin}/?${kind}`);await field.waitFor();await editor.locator(".question-drawer").evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));};
  await start("order");const initial=await source(),beforeWrites=writes.length;
  await field.evaluate(el=>{window.originalField=el;el.setSelectionRange(30,60,"backward");el.scrollTop=80;});
  const selection=await field.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection,el.scrollTop]);
  await visual.click();assert.equal(await status.textContent(),"No unsaved changes");assert.equal(await source(),initial);assert.equal(writes.length,beforeWrites);
  await json.click();assert.deepEqual(await field.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection,el.scrollTop]),selection);assert.equal(await field.evaluate(el=>el===window.originalField&&el===document.activeElement),true);
  // Native typing, visual answer edit, undo and redo share one browser history.
  const lexical=initial.replace('"points": 1','"points": 1.0000');await field.fill(lexical);
  await field.evaluate(el=>el.setSelectionRange(0,0));await field.pressSequentially(" ");const typed=await source();
  await visual.click();const move=controls.getByRole("button",{name:"Move act up",exact:true});await move.focus();await page.keyboard.press("Enter");
  const moved=await source();assert.deepEqual(JSON.parse(moved).questions[0].scoring.correctAnswers,["act","read","check"]);assert.equal(mask(moved),mask(typed));assert.equal(await controls.getByRole("listitem",{name:"Answer act",exact:true}).evaluate(el=>el===document.activeElement),true);
  assert.equal(await controls.getByRole("listitem",{name:"Answer act",exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),"solid");
  assert.equal(await move.isDisabled(),true);await controls.getByText("act moved to position 1 of 3.",{exact:true}).waitFor();
  await page.keyboard.press("Control+z");assert.equal(await source(),typed,"Visual native undo");
  await page.keyboard.press("Control+z");assert.equal(await source(),lexical,"Older typed edit remains undoable");
  await page.keyboard.press("Control+Shift+z");assert.equal(await source(),typed);await page.keyboard.press("Control+Shift+z");assert.equal(await source(),moved);
  await json.click();await field.press("Control+z");assert.equal(await source(),typed);await field.press("Control+Shift+z");assert.equal(await source(),moved);
  await visual.click();assert.equal(writes.length,beforeWrites);
  // A missing/refused native editing API keeps the exact source and history.
  for(const mode of ["missing","false","throw"]){
   await page.evaluate(mode=>{window.nativeEdit=document.execCommand;document.execCommand=mode==="missing"?undefined:mode==="false"?()=>false:()=>{throw new Error("Synthetic native edit failure")};},mode);
   await controls.getByRole("button",{name:"Move act down",exact:true}).click();assert.equal(await source(),moved);await editor.getByRole("alert").waitFor();
   await page.evaluate(()=>{document.execCommand=window.nativeEdit;});
  }
  await controls.getByRole("button",{name:"Move act down",exact:true}).click();assert.equal(await source(),typed);
  if(width===390)await controls.getByRole("button",{name:"Move act up",exact:true}).tap();else await controls.getByRole("button",{name:"Move act up",exact:true}).click();
  assert.equal(await source(),moved);
  if(process.env.SCREENSHOT_DIR){mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await controls.scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/answer-ordering-${width}.png`});}
  await editor.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Keep editing",exact:true}).click();assert.equal(await source(),moved);
  // Pending, failed and conflicting saves preserve the same raw source.
  fail=true;held={arrived:Promise.withResolvers(),gate:Promise.withResolvers()};await save.click();await held.arrived.promise;
  assert.equal(await visual.isDisabled(),true);assert.equal(await controls.getByRole("button",{name:"Move act down",exact:true}).isDisabled(),true);await page.keyboard.press("Control+s");await page.keyboard.press("Escape");assert.equal(writes.length,beforeWrites+1);
  held.gate.resolve();held=null;await editor.getByRole("alert").filter({hasText:"Synthetic save failure"}).waitFor();assert.equal(await source(),moved);fail=false;
  row.revision++;row.tags=["Remote"];
  await save.click();const keep=editor.getByRole("button",{name:"Load latest and keep my edits",exact:true});await keep.waitFor();failGet=true;await keep.click();await editor.getByRole("alert").filter({hasText:"Synthetic load failure"}).waitFor();assert.equal(await source(),moved);failGet=false;
  await keep.click();await editor.locator(".authoring-rebased").filter({hasText:"Loaded revision 2"}).waitFor();assert.equal(await source(),moved);assert.equal(await controls.isVisible(),true);assert.equal(writes.length,beforeWrites+2);
  row.revision++;await save.click();await keep.waitFor();await keep.click();await editor.locator(".authoring-rebased").filter({hasText:"Loaded revision 3"}).waitFor();
  await save.click();await editor.waitFor({state:"detached"});assert.equal(writes.at(-1).expectedRevision,3);assert.deepEqual(row.correctAnswers,["act","read","check"]);
  await page.getByRole("button",{name:"Open editor",exact:true}).click();await field.waitFor();assert.equal(await status.textContent(),"No unsaved changes");
  // JSON-only gating preserves source, including unknown number/escape tokens.
  const good=await source();for(const raw of [good.replace('"schemaVersion": "2.0"','"schemaVersion": "3.0"'),good.replace('"points": 1','"unknown": 9007199254740993123, "points": 1'),'{"bad":',JSON.stringify({...orderPackage,questions:[...orderPackage.questions,...orderPackage.questions]})]){
   await field.fill(raw);assert.equal(await visual.isDisabled(),true);assert.equal(await source(),raw);await save.click();assert.equal(await editor.getByRole("region",{name:"Question package errors"}).evaluate(el=>el===document.activeElement),true);
  }
  const duplicate=good.replace('"points": 1','"points": 2, "points": 1');await field.fill(duplicate);assert.equal(await visual.isDisabled(),true);assert.equal(await source(),duplicate);
  // Raw duplicate-key save rejection is tested independently in #167 / #168.
  await field.fill(good);await visual.click();assert.equal(await controls.isVisible(),true);
  // Maximum option count and long IDs remain usable at both widths.
  await json.click();const maximum=structuredClone(orderPackage),item=maximum.questions[0];
  item.interaction.options=Array.from({length:20},(_,i)=>({id:`option-${i}-`+'x'.repeat(170),body:[{id:`max-body-${i}`,type:"paragraph",text:`Synthetic maximum option ${i}`}]}));item.scoring.correctAnswers=item.interaction.options.map(o=>o.id);
  await field.fill(JSON.stringify(maximum));const maxSource=await source();await visual.click();assert.equal(await controls.getByRole("listitem").count(),20);
  const last=item.scoring.correctAnswers.at(-1);await controls.getByRole("button",{name:`Move ${last} up`,exact:true}).click();assert.equal(mask(await source()),mask(maxSource));assert.ok(await editor.locator(".question-drawer-body").evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  // Matching options use side-specific actual bodies, including table/code/image.
  await start("match");const matchInitial=await source();await visual.click();
  const left=controls.getByRole("region",{name:"Left items",exact:true}),right=controls.getByRole("region",{name:"Right items",exact:true});
  await left.getByText("First entry",{exact:true}).waitFor();assert.equal(await left.getByText("Shared category",{exact:true}).count(),0);
  await right.getByText("Shared category",{exact:true}).waitFor();await right.getByRole("table",{name:"Right category table"}).waitFor();await right.getByText("rightCategory()",{exact:true}).waitFor();await right.getByRole("img",{name:"Right category pixel"}).waitFor();
  const select=controls.getByRole("combobox",{name:"Right item for same",exact:true});await select.focus();await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");
  const matched=await source();assert.deepEqual(JSON.parse(matched).questions[0].scoring.correctAnswers,['["second","same"]','["same","other"]']);assert.equal(mask(matched),mask(matchInitial));assert.equal(await select.evaluate(el=>el===document.activeElement),true);
  await select.selectOption("same");assert.equal(await source(),matchInitial);assert.equal(await status.textContent(),"No unsaved changes");await select.selectOption("same");assert.equal(await source(),matchInitial);
  await select.selectOption("other");await json.click();await field.press("Control+z");assert.equal(await source(),matchInitial);await field.press("Control+Shift+z");assert.equal(await source(),matched);await visual.click();assert.equal(await select.evaluate(el=>el===document.activeElement),true);
  assert.ok(await editor.locator(".question-drawer-body").evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const control of [select,visual]){const b=await control.boundingBox();assert.ok(b.height>=44);}
  await page.addScriptTag({content:readFileSync(new URL("../../../node_modules/axe-core/axe.min.js",import.meta.url),"utf8")});
  const violations=await page.evaluate(async()=>(await window.axe.run(document.querySelector("dialog"),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations);
  assert.deepEqual(violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
  if(process.env.SCREENSHOT_DIR){mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await controls.scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/answer-matching-${width}.png`});}
  // Confirmed discard clears the shared draft; reopening starts from saved data.
  await editor.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Discard changes",exact:true}).click();await editor.waitFor({state:"detached"});
  await page.getByRole("button",{name:"Open editor",exact:true}).click();await field.waitFor();assert.equal(await source(),matchInitial);await visual.click();await controls.getByRole("combobox",{name:"Right item for same",exact:true}).selectOption("other");
  // Discard-and-load recovery reassesses eligibility when the remote item changes type.
  row.revision++;const savedMatch=structuredClone(row);row.content.interaction={id:"remote-choice",type:"choice",multiple:false,options:row.content.interaction.left};row.correctAnswers=["same"];row.type="single_choice";
  await save.click();await editor.getByRole("button",{name:"Discard my edits",exact:true}).click();await page.getByRole("button",{name:"Discard and load latest",exact:true}).click();await field.waitFor();await editor.locator(".authoring-rebased").filter({hasText:"Loaded revision 2"}).waitFor();assert.equal(await visual.isDisabled(),true);assert.equal(await status.textContent(),"No unsaved changes");assert.equal(await field.evaluate(el=>el===document.activeElement),false,"Recovery announcement retains focus");
  row=savedMatch;await start("match");await visual.click();await controls.getByRole("combobox",{name:"Right item for same",exact:true}).selectOption("other");
  await save.click();await editor.waitFor({state:"detached"});assert.deepEqual(row.correctAnswers,['["second","same"]','["same","other"]']);
  assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 console.log("PASS real editor answer controls at 1440/390px: exact token preservation, side-aware rich content, keyboard/touch, native undo/redo, mode/dirty/focus, failed/pending/conflicting saves and recovery, JSON-only gates, matching semantics, zero learning/external/storage writes. Axe DOM checks only; no screen-reader speech test.");
}finally{held?.gate.resolve();await browser?.close();await new Promise(resolve=>server.close(resolve));}
