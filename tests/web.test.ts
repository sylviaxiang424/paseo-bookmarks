import { createTestI18n } from "./host-translations";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { bookmarkId, type Bookmark, type BookmarkInput } from "../shared/bookmarks";

test("desktop adapter adds and removes bookmarks, marks the rail, jumps to unloaded rows and cleans up", async () => {
  // Bundle with a small host stub; application code keeps all browser globals
  // inside web.ts and native clients get a no-op adapter.
  const bundled = await build({ entryPoints: ["client/web.ts"], bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "native-host", setup(builder) {
      builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "native-host", namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const Platform = { OS: "web" };' }));
    } }], logLevel: "silent" });
  const compiled: { exports: any } = { exports: {} };
  new Function("module", "exports", "require", bundled.outputFiles[0].text)(compiled, compiled.exports, createRequire(import.meta.url));
  const window = new Window();
  const previousDocument = (globalThis as any).document;
  const previousObserver = (globalThis as any).MutationObserver;
  const previousComputedStyle = (globalThis as any).getComputedStyle;
  (globalThis as any).document = window.document;
  (globalThis as any).MutationObserver = window.MutationObserver;
  (globalThis as any).getComputedStyle = window.getComputedStyle.bind(window);
  // Model browser text measurement at the seam; happy-dom has no layout engine.
  (window.document as any).createRange = () => {
    let node: any;
    return { selectNodeContents(next: any) { node = next; }, getBoundingClientRect() { return node.parentElement.getBoundingClientRect(); } };
  };
  const context = { serverId: "host-a", workspaceId: "workspace-a", agentId: "agent-a", ownerId: "agent-a" };
  const section = window.document.createElement("section");
  const input = window.document.createElement("div"); input.setAttribute("data-testid", "message-input-root");
  const scroll = window.document.createElement("div"); scroll.setAttribute("data-testid", "agent-chat-scroll");
  const rail = window.document.createElement("div"); rail.setAttribute("data-testid", "chat-outline-rail");
  const tick = window.document.createElement("div"); tick.setAttribute("data-testid", "chat-outline-tick-1"); tick.appendChild(window.document.createElement("div")); rail.appendChild(tick);
  section.append(input, scroll, rail); window.document.body.appendChild(section);
  const measurable = (node: any) => {
    node.getClientRects = () => [{ width: 1200, height: 300 }];
    node.getBoundingClientRect = () => ({ width: 1200, height: 300, left: 0, right: 1200, top: 0, bottom: 300 });
  };
  const box = (node: any, left: number, top: number, width: number, height: number) => {
    node.getBoundingClientRect = () => ({ left, top, right: left + width, bottom: top + height, width, height });
  };
  measurable(input); measurable(scroll);
  (input as any).__reactFiber$test = { memoizedProps: context };
  let jumpedSeq = 0, scrolledTo = "";
  const addRow = (id: string, seq: number, role: "user" | "assistant" = "assistant") => {
    const row = window.document.createElement("div"); row.setAttribute("data-history-row-id", id); row.setAttribute("data-message-id", id);
    measurable(row);
    const content = window.document.createElement("div"); content.className = "host-message-content";
    content.style.maxWidth = "1040px"; box(content, 100, 0, 1000, 100);
    const text = `${role === "user" ? "问题" : "回答"} ${seq}`;
    if (role === "assistant") {
      const divider = window.document.createElement("div"); divider.setAttribute("role", "separator");
      box(divider, 100, 10, 1000, 1); content.appendChild(divider);
    }
    const body = window.document.createElement("div"); body.className = "message-body";
    const prose = window.document.createElement("p"); prose.textContent = text;
    if (role === "user") {
      body.style.backgroundColor = "rgb(230,230,232)"; body.style.borderRadius = "16px 2px 16px 16px";
      box(body, 500, 4, 600, 70); box(prose, 516, 20, 568, 40);
    } else { box(body, 100, 30, 1000, 50); box(prose, 100, 30, 100, 50); }
    body.appendChild(prose); content.appendChild(body);
    const footer = window.document.createElement("button"); footer.textContent = "工作了 4m";
    content.appendChild(footer);
    row.appendChild(content);
    (row as any).__reactProps$test = { children: { props: { item: { kind: "plugin", itemKind: `${role}-message`, sourceId: id, data: { text: role === "assistant" ? `---\n\n${text}` : text }, timelineCursor: { epoch: "epoch-a", seq }, timestamp: new Date("2026-11-09") } } } };
    row.scrollIntoView = () => { scrolledTo = id; };
    scroll.appendChild(row); return row;
  };
  const row = addRow("message-2", 2);
  const question = addRow("message-3", 3, "user");
  (scroll as any).__reactFiber$test = { memoizedProps: context, child: { memoizedProps: { onJumpToPrompt: (seq: number) => { jumpedSeq = seq; if (seq === 9 || seq === 10) addRow(`message-${seq}`, seq); } } } };
  let saved: Bookmark[] = [], forks: any[] = [], selectedOwner = "";
  let adapter: any;
  const i18n = createTestI18n();
  adapter = compiled.exports.createWebAdapter({ t: i18n.t, accepts: (ctx: any) => ctx.serverId === "host-a", context(value: any) { selectedOwner = value.ownerId; }, fork(value: any) { forks.push(value); }, bookmarks: () => saved, title: () => "原对话", error(message: string) { throw new Error(message); }, prompt(entries: Bookmark[]) { void adapter.jump(entries[0]); },
    async toggle(_: unknown, target: BookmarkInput) {
      saved = saved.length ? [] : [{ ...target, id: bookmarkId(target), createdAt: new Date().toISOString() }];
      adapter.refresh();
    } });
  const wait = () => new Promise((resolve) => setTimeout(resolve, 300));
  try {
    const button = window.document.querySelector('.pb-message-action[data-pb-message-id="message-2"]')!;
    assert.equal(scroll.querySelector("[data-pb-ui]"), null, "controls never enter the host's measured history tree");
    assert.equal(row.firstElementChild!.className, "host-message-content");
    assert.equal(row.firstElementChild!.getAttribute("style"), "max-width: 1040px;");
    assert.equal(button.getAttribute("aria-label"), "添加书签");
    assert.equal(button.style.top, "17px", "answer control sits just below the leading rule");
    assert.equal(button.style.left, "1108px", "answer control has a gap beside the text column");
    const questionButton = window.document.querySelector('.pb-message-action[data-pb-message-id="message-3"]')!;
    assert.equal(questionButton.style.top, "8px", "question control aligns with the bubble's top");
    assert.equal(questionButton.style.left, "1108px", "question control stays outside the bubble");
    button.click(); await wait();
    assert.equal(saved.length, 1);
    assert.equal(button.getAttribute("aria-label"), "移除书签");
    assert.equal(tick.getAttribute("data-pb-count"), "1");
    assert.equal(tick.children.length, 1, "bookmarks decorate the native pill without adding a second marker");
    assert.equal(tick.textContent, "");
    assert.match(tick.getAttribute("title")!, /回答.*回答 2/, "the summary remains available on hover");
    i18n.setLocale("en"); adapter.refresh(); await wait();
    assert.equal(button.getAttribute("aria-label"), "Remove bookmark");
    assert.equal(questionButton.getAttribute("aria-label"), "Add bookmark");
    assert.match(tick.getAttribute("title")!, /^Answer · 回答 2/);
    assert.equal(saved[0].summary, "回答 2", "switching language preserves the original excerpt");
    i18n.setLocale("zh-CN"); adapter.refresh(); await wait();
    tick.click(); await wait();
    assert.equal(jumpedSeq, 0, "mounted messages do not depend on the outline"); assert.equal(scrolledTo, "message-2");
    const highlight = window.document.querySelector(".pb-message-highlight")!;
    assert.equal(highlight.style.top, "30px", "highlight starts below the separator at y=10");
    assert.equal(highlight.style.height, "50px", "highlight ends before footer controls");
    assert.equal(highlight.style.left, "100px", "highlight stays inside the centered text area");
    assert.equal(highlight.style.width, "1000px", "short text still highlights the whole body container");
    assert.equal(row.hasAttribute("data-pb-highlight"), false, "the full-width row stays undecorated");
    await adapter.jump({ ...saved[0], role: "user", seq: 3, messageId: "message-3", aliases: ["message-3"], summary: "问题 3" });
    const bubbleHighlight = window.document.querySelector(".pb-message-highlight")!;
    assert.equal(bubbleHighlight.style.left, "500px"); assert.equal(bubbleHighlight.style.top, "4px");
    assert.equal(bubbleHighlight.style.width, "600px"); assert.equal(bubbleHighlight.style.height, "70px", "question highlight has no expansion outside the bubble");
    assert.equal(bubbleHighlight.style.borderRadius, "16px 2px 16px 16px", "the bubble's asymmetric corners are preserved");
    const oldBookmark = saved[0];
    assert.equal(await adapter.jump({ ...oldBookmark, seq: 9, messageId: "message-9", aliases: ["message-9"] }), true);
    assert.equal(jumpedSeq, 9); assert.equal(scrolledTo, "message-9");
    // A real long chat has thousands of descendants before the outline's sibling
    // branch. Looking depth-first exhausts the guard before finding its callback.
    const outline = (scroll as any).__reactFiber$test.child;
    let messageTree: any = { memoizedProps: {} };
    const longChat = messageTree;
    for (let index = 0; index < 2100; index++) messageTree = messageTree.child = { memoizedProps: {} };
    const chatRoot: any = { memoizedProps: context, child: { memoizedProps: {}, child: longChat, sibling: outline } };
    (scroll as any).__reactFiber$test = { memoizedProps: context, return: chatRoot };
    assert.equal(await adapter.jump({ ...oldBookmark, seq: 10, messageId: "message-10", aliases: ["message-10"], summary: "回答 10" }), true, "long chats still find the outline callback beside the feed");
    assert.equal(scrolledTo, "message-10");
    button.click(); await wait();
    assert.equal(saved.length, 0); assert.equal(tick.hasAttribute("data-pb-count"), false);
    assert.equal(jumpedSeq, 10, "removing must never jump");
    (input as any).__reactFiber$test = { memoizedProps: { serverId: "host-a", workspaceId: "workspace-a", draftId: "draft-b", attachments: [{ kind: "chat_history", source: { agentId: "agent-a" } }] } };
    adapter.refresh(); await wait();
    assert.equal(forks[0].draftId, "draft-b"); assert.equal(forks[0].sourceAgentId, "agent-a");
    assert.equal(window.document.querySelector(".pb-message-action"), null, "hidden source chat actions are removed while a draft is active");
    const secondInput = window.document.createElement("div"); secondInput.setAttribute("data-testid", "message-input-root"); measurable(secondInput);
    (secondInput as any).__reactFiber$test = { memoizedProps: { serverId: "host-a", workspaceId: "workspace-a", agentId: "agent-c", isPaneFocused: true } };
    section.appendChild(secondInput); adapter.refresh(); await wait();
    assert.equal(selectedOwner, "agent-c", "split view follows the focused pane instead of DOM order");
  } finally {
    adapter.dispose(); i18n.runtime.dispose();
    assert.equal(window.document.querySelector(".pb-message-action"), null);
    assert.equal(window.document.querySelector(".pb-message-highlight"), null);
    assert.equal(row.style.position, "", "the host row's original positioning is untouched");
    assert.equal(window.document.querySelector("[data-pb-ui=overlay]"), null);
    assert.equal(window.document.querySelector(".pb-message-column"), null);
    assert.equal(window.document.querySelector("[data-pb-ui=style]"), null);
    (globalThis as any).document = previousDocument; (globalThis as any).MutationObserver = previousObserver;
    (globalThis as any).getComputedStyle = previousComputedStyle;
    await window.happyDOM.close();
  }
});
