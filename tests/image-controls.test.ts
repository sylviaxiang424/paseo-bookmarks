import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { createTestI18n } from "./host-translations";
import { markdownImages } from "../shared/outputs";
import { bookmarkId, sameTarget } from "../shared/bookmarks";

const factory = build({ entryPoints: ["client/web.ts"], bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "host", setup(builder) {
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const Platform = { OS: "web" };' }));
  } }], logLevel: "silent" }).then(built => {
  const module = { exports: {} as any };
  new Function("module", "exports", "require", built.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports;
});

async function fixture(text: string, run: (host: any) => Promise<void>) {
  const { createWebAdapter } = await factory, window = new Window(), i18n = createTestI18n();
  const previous = { document: (globalThis as any).document, MutationObserver: (globalThis as any).MutationObserver };
  Object.assign(globalThis, { document: window.document, MutationObserver: window.MutationObserver });
  const scroll = window.document.createElement("div"), row = window.document.createElement("div"), body = window.document.createElement("div");
  scroll.dataset.testid = "agent-chat-scroll"; row.dataset.historyRowId = row.dataset.messageId = "picture-message"; body.dataset.messageText = "true";
  const context = { serverId: "host", workspaceId: "workspace", agentId: "agent", ownerId: "agent" };
  const item = { kind: "assistant_message", id: "picture-message", text, timelineCursor: { epoch: "epoch", seq: 2 } };
  (scroll as any).__reactFiber$test = { memoizedProps: context };
  (row as any).__reactProps$test = { children: { props: { item } } };
  const measure = (node: any, top: number, width: number, height: number) => {
    node.getClientRects = () => [{ width, height }];
    node.getBoundingClientRect = () => ({ left: 0, right: width, top, bottom: top + height, width, height });
    node.scrollIntoView = () => {};
  };
  measure(scroll, 0, 1000, 800); measure(row, 40, 1000, 300); measure(body, 40, 800, 300);
  scroll.append(row); row.append(body); window.document.body.append(scroll);
  let adapter: any, saved: any[] = [], toggles = 0;
  const render = (next: string) => {
    item.text = next; body.replaceChildren();
    for (const [index, image] of markdownImages(next).entries()) {
      const node = window.document.createElement("img"); node.setAttribute("src", image.source); measure(node, 40 + index * 120, 800, 100); body.append(node);
    }
    adapter?.refresh();
  };
  render(text);
  adapter = createWebAdapter({ hostId: "host", t: i18n.t, accepts: () => true, context() {}, fork() {}, title: () => "Images", bookmarks: () => saved, prompt() {}, error(message: string) { throw Error(message); }, async toggle(_: any, target: any) {
    toggles++; saved = saved.some(entry => sameTarget(entry, target)) ? saved.filter(entry => !sameTarget(entry, target)) : [...saved, { ...target, id: bookmarkId(target), createdAt: "2026-11-20" }]; adapter.refresh();
  } });
  const controls = () => Array.from(window.document.querySelectorAll<HTMLButtonElement>('.pb-message-action'));
  const settle = async (count: number) => {
    for (let i = 0; i < 80 && controls().length !== count; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(controls().length, count);
  };
  try { await run({ adapter, controls, render, settle, saved: () => saved, toggles: () => toggles }); }
  finally { adapter.dispose(); i18n.runtime.dispose(); Object.assign(globalThis, previous); await window.happyDOM.close(); }
}

test("a standalone screenshot has one image bookmark entry instead of an answer and image pair", () => fixture('\n\n![Image](file:///tmp/screenshot.png)\n\n', async ({ controls }) => {
  assert.deepEqual(controls().map((node: any) => node.dataset.pbKind), ["image"]);
}));

test("image-only siblings, including repeated sources, keep independent bookmark entries", () => fixture('![First](file:///tmp/screenshot.png)\n![Second](file:///tmp/screenshot.png)', async ({ controls, saved, toggles }) => {
  assert.equal(controls().length, 2);
  assert.notEqual(controls()[0].dataset.pbImageKey, controls()[1].dataset.pbImageKey);
  controls()[0].click(); controls()[1].click(); await Promise.resolve();
  assert.equal(saved().length, 2); assert.equal(toggles(), 2);
}));

test("mixed prose and pictures retain both the answer and individual image entries", () => fixture('Screenshot explanation.\n\n![Image](file:///tmp/screenshot.png)', async ({ controls }) => {
  assert.deepEqual(controls().map((node: any) => node.dataset.pbKind), ["answer", "image"]);
}));

test("image-only replies without alt text still expose one image entry", () => fixture('![](file:///tmp/screenshot.png)', async ({ controls }) => {
  assert.deepEqual(controls().map((node: any) => node.dataset.pbKind), ["image"]);
}));

test("stream updates add and remove the answer entry without accumulating stale controls", () => fixture('![Image](file:///tmp/screenshot.png)', async ({ controls, render, settle, toggles }) => {
  await settle(1); render('Explanation\n\n![Image](file:///tmp/screenshot.png)'); await settle(2);
  render('![Image](file:///tmp/screenshot.png)'); await settle(1);
  controls()[0].click(); await Promise.resolve(); assert.equal(toggles(), 1);
}));
