// Synthetic browser test. No provider account, command or user project is used.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const chrome = process.env.TAXCLI_CHROME || path.join(process.env.PROGRAMFILES || "C:/Program Files", "Google/Chrome/Application/chrome.exe");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "taxcli-comparison-browser-"));
const browser = spawn(chrome, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: true });
let seq = 0, buffer = "";
const pending = new Map();
browser.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const response = JSON.parse(raw), task = pending.get(response.id);
    if (task) { pending.delete(response.id); response.error ? task.reject(response.error) : task.resolve(response.result); }
  }
});
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
}
const deadline = setTimeout(() => { console.error("Comparison browser test timed out"); browser.kill(); process.exitCode = 1; }, 45000);
(async () => {
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  const evaluate = async (expression) => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error(`Timed out: ${expression}`);
  };
  const assertSingleConversation = async () => {
    const expected = await evaluate("window.__conversationCountBefore + 1");
    assert.equal(await evaluate("conversationsByProject.get(baseProjectKey()).length"), expected);
    assert.equal(await evaluate(`document.querySelectorAll('[data-project-conversation="project-1"]').length`), expected);
  };
  // Share the existing synthetic Workbench API and expose only its fake listeners.
  const fixture = fs.readFileSync(path.join(__dirname, "smoke-workbench.cjs"), "utf8")
    .match(/await page\.addInitScript\(\(\) => \{([\s\S]*?)\n  \}\);/)[1]
    .replace("window.__smokeEvents = events;", "window.__smokeEvents = events; window.__comparisonListeners = listeners;");
  await cdp("Page.enable", {}, sessionId);
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{${fixture}})();` }, sessionId);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp("Page.navigate", { url: pathToFileURL(path.resolve(__dirname, "../src/index.html")).href }, sessionId);
  await until("typeof startMultiAiComparison === 'function' && document.querySelector('#projectPath').value && typeof comparisonProgress !== 'undefined'");
  await evaluate(`(async () => {
    multiAiSelection = [{engineId:'codex',model:'gpt-6'},{engineId:'codex',model:'test-model'}];
    await openMultiAiModal();
    updateMultiAiSelectionSummary();
  })()`);
  assert.deepEqual(await evaluate(`(() => {
    const card = document.querySelector('[data-multi-engine="codex"]');
    const stale = card.querySelector('[data-multi-model="gpt-6"]');
    const live = card.querySelector('[data-multi-model="test-model"]');
    return {staleDisabled:stale.disabled,staleChecked:stale.checked,liveDisabled:live.disabled,liveChecked:live.checked,selected:selectedMultiAiVariantsFromEditor().map(m=>m.model)};
  })()`), {staleDisabled:true,staleChecked:false,liveDisabled:false,liveChecked:true,selected:['test-model']});
  await evaluate(`(async () => {
    multiAiSelection = [];
    await openMultiAiModal();
  })()`);
  assert.equal(await evaluate(`!!document.querySelector('[data-multi-engine="codex"] [data-multi-model="gpt-6"]')`), false);
  await evaluate(`(async () => {
    multiAiSelection = [{engineId:'opencode',model:'opencode/nemotron-3-ultra-free'},{engineId:'opencode',model:'test-model'}];
    availableModels.opencode = [{id:'opencode/nemotron-3-ultra-free'}];
    await openMultiAiModal();
    updateMultiAiSelectionSummary();
  })()`);
  assert.deepEqual(await evaluate(`(() => {
    const card = document.querySelector('[data-multi-engine="opencode"]');
    const stale = card.querySelector('[data-multi-model="opencode/nemotron-3-ultra-free"]');
    return {disabled:stale.disabled,checked:stale.checked,models:availableModels.opencode.map(m=>m.id)};
  })()`), {disabled:true,checked:false,models:['test-model','test-model-2']});
  await evaluate("closeModal('multiAiModal')");
  await evaluate(`(() => {
    const original = window.agentHub;
    window.__comparisonStarts = [];
    window.__comparisonCleanups = [];
    window.__comparisonFinishes = {};
    window.__emitComparison = (event) => {
      if (event.type === 'finished') window.__comparisonFinishes[event.runId] = event;
      for (const callback of window.__comparisonListeners) callback(event);
    };
    const overrides = {
      selectProject: async (id) => ({project:(await original.listProjects()).projects.find(p=>p.id===id)}),
      prepareParallelWorkspaces: async ({projectPath, variants}) => {
        if (window.__failPrepare) throw new Error('Fixture baseline failure');
        return {batchId:'fixture-batch', variants:variants.map((v,i)=>({...v, projectPath:projectPath+'/.taxcli/comparisons/fixture/'+(i+1)}))};
      },
      materializeParallelWorkspace: async () => true,
      cleanupParallelWorkspace: async (p) => { window.__comparisonCleanups.push(p.variantId); return {cleaned:true}; },
      stopAgent: async (runId) => window.__emitComparison({runId,type:'finished',code:null}),
      startAgent: async (payload) => {
        window.__comparisonStarts.push(payload);
        if (window.__failStarts && payload.workbenchRole !== 'judge') throw new Error('Fixture provider authentication failure');
        const runId = payload.runId;
        window.__emitComparison({runId,type:'started'});
        if (payload.workbenchRole === 'judge') setTimeout(() => {
          window.__emitComparison({runId,type:'output',event:{kind:'json',data:{type:'item.completed',item:{type:'agent_message',text:JSON.stringify({winner:'variant-1',evaluations:[{variantId:'variant-1',quality:90}]})}}}});
          window.__emitComparison({runId,type:'finished',code:0});
        }, 30);
        return {runId};
      },
      workbenchRequest: async (action,payload) => {
        if (action === 'run-tests' && window.__failTests) throw new Error('Fixture test runner failure');
        if (action === 'arena-failure') {
          const data = await original.workbenchRequest('list');
          Object.assign(data.arenas[0].variants.find(v=>v.variantId===payload.variantId),{status:payload.status||'failed',error:payload.error});
          return data.arenas[0];
        }
        const result = await original.workbenchRequest(action,payload);
        if (action === 'arena-result') {
          const finish = window.__comparisonFinishes[payload.runId];
          result.variants.find(v=>v.variantId===payload.variantId).status = finish.code===0 ? 'completed' : finish.code==null ? 'cancelled' : 'failed';
        }
        return result;
      }
    };
    window.agentHub = new Proxy(original,{get:(target,key)=>overrides[key]||target[key]});
    multiAiSelection = [{engineId:'codex',model:'fixture-model-1'},{engineId:'claude',model:'fixture-model-2'}];
    localStorage.setItem('agenthub:arena-judge', JSON.stringify({engineId:'codex',model:'fixture-judge'}));
    window.__startComparison = () => {
      window.__conversationCountBefore = (conversationsByProject.get(baseProjectKey()) || []).length;
      window.__comparisonDone = startMultiAiComparison({prompt:'Synthetic comparison task'});
    };
    window.__startComparison();
  })()`);
  await until("window.__comparisonStarts.length === 1");
  const initial = await evaluate(`(() => ({visible:!document.querySelector('#comparisonProgress').hidden,cards:document.querySelectorAll('.comparison-candidate').length,states:[...document.querySelectorAll('.comparison-candidate')].map(n=>n.dataset.status),text:document.querySelector('#conversation').textContent,conversations:conversationsByProject.get(baseProjectKey()).length,path:window.__comparisonStarts[0].projectPath}))()`);
  assert.equal(initial.visible, true); assert.equal(initial.cards, 3);
  assert.deepEqual(initial.states, ["running", "queued", "queued"]);
  assert.equal(initial.conversations, await evaluate("window.__conversationCountBefore + 1"));
  await assertSingleConversation();
  assert.equal(await evaluate("document.querySelectorAll('#conversation .message.user').length"), 1);
  assert.match(initial.text, /Synthetic comparison task/);
  assert.match(initial.path, /\.taxcli\/comparisons/);
  const liveShot = await cdp("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync(path.join(os.tmpdir(), "taxcli-comparison-live.png"), Buffer.from(liveShot.data, "base64"));
  assert.equal(await evaluate("document.querySelector('#comparisonProgress').getBoundingClientRect().top >= 0"), true);
  await evaluate(`window.__emitComparison({runId:window.__comparisonStarts[0].runId,type:'output',event:{kind:'json',data:{type:'item.completed',item:{type:'agent_message',text:'Live first model response'}}}})`);
  await until("document.querySelector('#conversation').textContent.includes('Live first model response')");
  await evaluate(`window.__emitComparison({runId:window.__comparisonStarts[0].runId,type:'approval-request',requestId:'fixture-approval',engineId:'codex',approvalMode:'auto_edit',command:'echo fixture'})`);
  assert.equal(await evaluate("document.querySelector('.comparison-candidate').dataset.status"), "approval");
  await evaluate(`window.__emitComparison({runId:window.__comparisonStarts[0].runId,type:'approval-resolved',requestId:'fixture-approval'})`);
  await evaluate(`document.querySelectorAll('.comparison-candidate')[1].querySelector('button').click()`);
  await until("activeConversationId() === [...conversationsByProject.get(baseProjectKey())][0].id");
  assert.match(await evaluate("document.querySelector('#conversation').textContent"), /Sırada/);
  await evaluate(`window.__emitComparison({runId:window.__comparisonStarts[0].runId,type:'finished',code:0})`);
  await until("window.__comparisonStarts.length === 2");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.comparison-candidate')].map(n=>n.dataset.status)"), ["completed", "running", "queued"]);
  await evaluate("openSidebarConversation('fixture-project-0')");
  assert.equal(await evaluate("document.querySelector('#comparisonProgress').hidden"), true);
  await evaluate(`window.__emitComparison({runId:window.__comparisonStarts[1].runId,type:'error',message:'Fixture provider timed out'});window.__emitComparison({runId:window.__comparisonStarts[1].runId,type:'finished',code:1})`);
  await until("!multiAiPreparing");
  assert.equal(await evaluate("document.querySelector('#projectPath').value.includes('Fixture')"), true);
  await evaluate("openSidebarConversation('project-1')");
  assert.equal(await evaluate("document.querySelector('#comparisonProgress').hidden"), false);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.comparison-candidate')].map(n=>n.dataset.status)"), ["completed", "failed", "completed"]);
  assert.equal(await evaluate("conversationsByProject.get(baseProjectKey()).length"), initial.conversations);
  assert.equal(await evaluate("new Set(window.__comparisonStarts.map(p=>p.conversationId)).size"), 1);
  assert.equal(await evaluate("document.querySelectorAll('#conversation [data-comparison-variant-id]').length"), 3);
  const stored = await evaluate("readLocalHistory().filter(m=>m.role==='assistant').map(m=>({variant:m.comparisonVariantId,label:m.comparisonLabel,record:!!m.recordId}))");
  assert.deepEqual(stored.map(m=>m.variant), ['variant-1','variant-2','judge']);
  assert.ok(stored.every(m=>m.label && m.record));
  await evaluate("activateConversation('main')");
  assert.equal(await evaluate("document.querySelector('#comparisonProgress').hidden"), true);
  await evaluate("parkedConversations.delete(projectKey(document.querySelector('#projectPath').value, conversationsByProject.get(baseProjectKey())[0].id)); activateConversation(conversationsByProject.get(baseProjectKey())[0].id)");
  assert.equal(await evaluate("document.querySelector('#comparisonProgress').hidden"), false);
  assert.equal(await evaluate("document.querySelectorAll('#conversation [data-comparison-variant-id]').length"), 3);
  assert.equal(await evaluate("document.querySelectorAll('#conversation .comparison-model-label').length"), 3);
  await evaluate("window.TaxCliWorkbench.judgeArena('fixture-arena')");
  await assertSingleConversation();
  assert.equal(await evaluate("new Set(window.__comparisonStarts.map(p=>p.conversationId)).size"), 1);
  assert.match(await evaluate("document.querySelectorAll('.comparison-activity')[1].textContent"), /Fixture provider timed out/);
  assert.equal(await evaluate("document.querySelector('#workspaceView').classList.contains('active')"), true);
  assert.deepEqual(await evaluate("window.__comparisonCleanups"), ["variant-1", "variant-2"]);
  await evaluate(`document.querySelector('.comparison-candidate .comparison-actions button:nth-child(2)').click()`);
  await until("document.querySelector('.wb-detail') !== null");
  assert.match(await evaluate("document.querySelector('.wb-detail').textContent"), /Hedef proje: C:\\TestProject/);
  await evaluate(`showView('workspace');window.__failStarts=true;window.__comparisonStarts=[];window.__startComparison()`);
  await until("!multiAiPreparing");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.comparison-candidate')].map(n=>n.dataset.status)"), ["failed", "failed", "cancelled"]);
  assert.equal(await evaluate("window.__comparisonStarts.some(p=>p.workbenchRole==='judge')"), false);
  await assertSingleConversation();
  await evaluate(`window.__failStarts=false;window.__failPrepare=true;window.__startComparison()`);
  await until("!multiAiPreparing");
  assert.match(await evaluate("document.querySelector('#comparisonProgress header').textContent"), /Fixture baseline failure/);
  await assertSingleConversation();
  await evaluate(`window.__failPrepare=false;window.__failTests=true;window.__comparisonStarts=[];window.__startComparison()`);
  await until("window.__comparisonStarts.length === 1");
  await evaluate(`window.__emitComparison({runId:window.__comparisonStarts[0].runId,type:'finished',code:0})`);
  await until("window.__comparisonStarts.length === 2");
  await evaluate(`window.__emitComparison({runId:window.__comparisonStarts[1].runId,type:'finished',code:0})`);
  await until("!multiAiPreparing");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.comparison-candidate')].map(n=>n.dataset.status)"), ["failed", "failed", "cancelled"]);
  assert.match(await evaluate("document.querySelector('.comparison-activity').textContent"), /Fixture test runner failure/);
  await assertSingleConversation();
  assert.equal(await evaluate("window.__comparisonStarts.some(p=>p.workbenchRole==='judge')"), false);
  await evaluate(`window.__failTests=false;window.__comparisonStarts=[];window.__comparisonCleanups=[];window.__startComparison()`);
  await until("window.__comparisonStarts.length === 1");
  await evaluate("document.querySelector('#stopMultiAi').click()");
  await until("!multiAiPreparing");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.comparison-candidate')].map(n=>n.dataset.status)"), ["cancelled", "cancelled", "cancelled"]);
  assert.equal(await evaluate("document.querySelector('#sendButton').disabled"), false);
  await assertSingleConversation();
  assert.deepEqual(await evaluate("window.__comparisonCleanups"), ["variant-1", "variant-2"]);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 480, height: 850, deviceScaleFactor: 1, mobile: false }, sessionId);
  for (const theme of ["dark", "zinc", "midnight", "light"]) {
    await evaluate(`document.body.className='theme-${theme}'`);
    assert.equal(await evaluate("(()=>{const p=document.querySelector('#comparisonProgress');return p.scrollWidth<=p.clientWidth+1 && p.getBoundingClientRect().height>30})()"), true);
  }
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  await evaluate("document.body.className='theme-zinc'");
  const shot = await cdp("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync(path.join(os.tmpdir(), "taxcli-comparison-progress.png"), Buffer.from(shot.data, "base64"));
  console.log("PASS: one sidebar conversation per comparison, shared model/judge history and reload, judge retry, live states/output, failed providers/tests, preparation failure, cancellation, project targeting and four themes at narrow width");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  clearTimeout(deadline); browser.kill();
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("taxcli-comparison-browser-")) {
    setTimeout(() => fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }), 300).unref();
  }
});
