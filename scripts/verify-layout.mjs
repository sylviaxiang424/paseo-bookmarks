import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Uses a real browser's layout/focus/scroll behavior; no mocked rectangles.
// Only the host's platform and RPC descriptor modules are substituted.
const bundle = await build({ entryPoints: ["tests/fixtures/layout.ts"], bundle: true, platform: "browser", write: false,
  plugins: [{ name: "host", setup(builder) {
    builder.onResolve({ filter: /^(react-native|@getpaseo\/plugin)$/ }, args => ({ path: args.path, namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, args => ({ contents: args.path === "react-native"
      ? 'export const Platform={OS:"web"};' : 'export const defineRpc=value=>value;' }));
  } }], logLevel: "silent" });
const html = `<!doctype html><meta charset="utf-8"><title>Bookmark layout regression</title>
<style>
*{box-sizing:border-box}body{margin:0;font:16px/24px system-ui}#pane{margin:20px;max-width:calc(100vw - 40px)}
[data-testid=agent-chat-scroll]{width:100%;height:480px;overflow-x:hidden;overflow-y:auto;overflow-anchor:none;scrollbar-width:none}
.content{display:flex;flex-direction:column;min-height:100%;padding:16px}
.row{display:flex;flex-direction:column;width:100%;flex-shrink:0}
.column{position:relative;width:100%;max-width:1040px;align-self:center;padding:0 8px}
p{margin:0}hr{height:1px;border:0;background:#ddd;margin:16px 0}
.prose{padding:8px 0}.bubble{margin:12px 0 12px auto;padding:16px;background:#e5e5e8;border-radius:16px 2px 16px 16px;max-width:90%}
.column>button{margin:12px 0 16px}textarea{width:100%;height:60px}button{font:inherit}
</style><main id="pane"><div data-testid="agent-chat-scroll"><div class="content"></div></div>
<div data-testid="message-input-root"><textarea aria-label="Message composer"></textarea></div></main><script src="/fixture.js"></script>`;
const server = createServer((request, response) => {
  const script = request.url === "/fixture.js";
  response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
  response.end(script ? bundle.outputFiles[0].contents : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const cli = process.env.TABBIT_CLI || join(homedir(), ".local/bin/tabbit-cli");
const task = "书签布局回归";
const run = (args, input) => new Promise((resolve, reject) => {
  const child = spawn(cli, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
  child.on("error", reject); child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stdout || stderr)));
  child.stdin.end(input);
});
const program = `
const results=[];
try {
for(const width of [360,640,1280]){
  await page.goto(${JSON.stringify(url)}+'?width='+width,{waitUntil:'load'});
  const before=await page.evaluate(()=>layoutFixture.prepare());
  const after=await page.evaluate(()=>layoutFixture.mount());
  const stable=JSON.stringify(before)===JSON.stringify(after);
  results.push({width,stable,before,after});
  if(!${process.argv.includes("--diagnose")}){
    expect(after).toEqual(before);
    let expectedToggles=0;
    for(const id of ['message-9','message-10']){
    const clickBefore=await page.evaluate(async id=>{
      document.querySelector('[data-message-id="'+id+'"]').scrollIntoView({block:'start'});
      await layoutFixture.frames();return layoutFixture.measure();
    },id);
    const visible=await page.locator('[data-message-id="'+id+'"]').evaluate(row=>{
      const r=row.getBoundingClientRect();return {id:row.getAttribute('data-message-id'),x:r.left+30,y:r.top+20};
    });
    const button=page.locator('.pb-message-action[data-pb-message-id="'+visible.id+'"]');
    await page.getByRole('textbox',{name:'Message composer'}).focus();
    await page.mouse.move(visible.x,visible.y);
    const controlBounds=await button.evaluate(button=>{
      const row=document.querySelector('[data-message-id="'+button.dataset.pbMessageId+'"]');
      const body=row.querySelector('.bubble,.prose');
      const range=document.createRange();range.selectNodeContents(body.querySelector('p').firstChild);
      const right=body.matches('.bubble')?body.getBoundingClientRect().right:Math.max(...Array.from(range.getClientRects(),r=>r.right));
      return {left:button.getBoundingClientRect().left,right,style:button.getAttribute('style'),toolbar:button.parentElement.getAttribute('style'),rowTop:row.getBoundingClientRect().top};
    });
    if(controlBounds.left<controlBounds.right) throw new Error(JSON.stringify(controlBounds));
    await button.click();
    await page.waitForFunction(count=>layoutFixture.toggles===count,++expectedToggles);
    await expect(page.getByRole('textbox',{name:'Message composer'})).toBeFocused();
    await page.evaluate(()=>layoutFixture.renderAgain());
    expect(await page.evaluate(()=>layoutFixture.measure())).toEqual(clickBefore);
    await button.focus(); await button.press('Enter');
    await page.waitForFunction(count=>layoutFixture.toggles===count,++expectedToggles);
    expect(await page.evaluate(()=>layoutFixture.measure())).toEqual(clickBefore);
    await page.getByRole('textbox',{name:'Message composer'}).focus();
    await page.mouse.move(10,10);
    expect(await button.evaluate(node=>getComputedStyle(node).pointerEvents)).toEqual('none');
    }
    // Fixed controls must track scroll and pane resizing, without modifying the feed.
    await page.evaluate(async()=>{const s=document.querySelector('[data-testid="agent-chat-scroll"]');s.scrollTop+=137;await layoutFixture.frames();});
    expect(await page.locator('.pb-message-overlay').evaluate(node=>node.scrollTop)).toEqual(0);
    expect(await page.locator('[data-testid="agent-chat-scroll"] [data-pb-ui]').count()).toEqual(0);
    // A host dialog must stay above the controls, without changing history sizes.
    await page.evaluate(async()=>{const modal=document.createElement('div');modal.setAttribute('role','dialog');modal.textContent='Host dialog';document.body.appendChild(modal);layoutFixture.renderAgain();await layoutFixture.frames();});
    await expect(page.locator('.pb-message-overlay')).toBeHidden();
    await page.locator('[role="dialog"]').evaluate(node=>node.remove());
    await page.evaluate(()=>layoutFixture.renderAgain());
    await expect(page.locator('.pb-message-overlay')).toBeVisible();
    await page.evaluate(()=>layoutFixture.resize(480));
    const resized=await page.evaluate(()=>layoutFixture.measure());
    const without=await page.evaluate(()=>layoutFixture.dispose());
    expect(without).toEqual(resized);
    const resizes=await page.evaluate(()=>layoutFixture.resizes);
    await page.evaluate(()=>layoutFixture.mount());
    expect(await page.evaluate(()=>layoutFixture.measure())).toEqual(without);
    expect(await page.evaluate(()=>layoutFixture.resizes)).toEqual(resizes);
    await page.evaluate(()=>layoutFixture.dispose());
    expect(await page.locator('[data-pb-ui]').count()).toEqual(0);
  } else await page.evaluate(()=>layoutFixture.dispose());
}
return results.map(({width,stable,before,after})=>({width,stable,columnWidth:[before.rows[0].width,after.rows[0].width],scrollHeight:[before.scrollHeight,after.scrollHeight],scrollTop:[before.scrollTop,after.scrollTop]}));
} finally { await page.close(); }
`;
try {
  const output = await run(["nodejs", "--task", task, "--request-id", `layout-${randomUUID()}`, "--timeout-ms", "60000"], program);
  const result = JSON.parse(output);
  console.log(JSON.stringify(result.result?.value ?? result, null, 2));
} finally {
  await run(["finish", "--task", task]).catch(() => {});
  server.close();
  server.closeAllConnections();
}
