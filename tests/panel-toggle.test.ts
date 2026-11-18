import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { createTestI18n, translationModule } from "./host-translations";

const factory = build({ entryPoints: ["client/runtime.ts"], bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "host", setup(builder) {
    builder.onResolve({ filter: /^@getpaseo\/plugin\/client$/ }, () => ({ path: translationModule, external: true }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const Platform = { OS: "web" };' }));
  } }], logLevel: "silent" }).then(built => {
  const module = { exports: {} as any };
  new Function("module", "exports", "require", built.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports;
});

async function fixture(run: (host: any) => void) {
  const { BookmarkRuntime } = await factory, window = new Window(), i18n = createTestI18n();
  const previous = { document: (globalThis as any).document, MutationObserver: (globalThis as any).MutationObserver };
  Object.assign(globalThis, { document: window.document, MutationObserver: window.MutationObserver });
  const document = window.document, sidebar = document.createElement("div"), tab = document.createElement("button"), toggle = document.createElement("button");
  sidebar.dataset.testid = "workspace-explorer-sidebar";
  tab.dataset.testid = "workspace-tab-plugin-bookmarks"; tab.setAttribute("role", "button"); tab.setAttribute("aria-selected", "true");
  toggle.dataset.testid = "workspace-explorer-toggle"; toggle.setAttribute("aria-expanded", "true");
  const tabProps = { serverId: "host-a", workspaceId: "workspace-a", tab: { target: { kind: "plugin", pluginId: "paseo-bookmarks", panelId: "bookmarks" } } };
  const toggleProps = { normalizedServerId: "host-a", normalizedWorkspaceId: "workspace-a" };
  (tab as any).__reactFiber$test = { memoizedProps: tabProps };
  (toggle as any).__reactFiber$test = { memoizedProps: toggleProps };
  for (const node of [tab, toggle]) {
    node.getClientRects = () => node === tab && sidebar.hidden ? [] : [{ width: 100, height: 30 }] as any;
    node.getBoundingClientRect = () => ({ width: 100, height: 30 }) as any;
  }
  sidebar.append(tab); document.body.append(sidebar, toggle);
  let closed = 0, nativeSelections = 0, nativeKeys = 0;
  const show = (selected = true) => { sidebar.hidden = false; toggle.setAttribute("aria-expanded", "true"); tab.setAttribute("aria-selected", String(selected)); };
  toggle.addEventListener("click", () => { closed++; sidebar.hidden = true; toggle.setAttribute("aria-expanded", "false"); });
  tab.addEventListener("click", () => { nativeSelections++; show(); });
  tab.addEventListener("keydown", () => { nativeKeys++; });
  const opened: string[] = [];
  const runtime = new BookmarkRuntime({ i18n: i18n.runtime, openPanel(id: string, options: any) {
    assert.equal(id, "bookmarks"); assert.equal(options.location, "explorer"); opened.push(options.workspaceId); show();
  } });
  runtime.attach(undefined, "host-a");
  try { run({ runtime, window, sidebar, tab, toggle, tabProps, toggleProps, show, opened,
    closed: () => closed, nativeSelections: () => nativeSelections, nativeKeys: () => nativeKeys }); }
  finally { runtime.dispose(); i18n.runtime.dispose(); Object.assign(globalThis, previous); await window.happyDOM.close(); }
}

test("the entry collapses visible bookmarks, reopens a collapsed sidebar and switches from another panel", () => fixture(({ runtime, sidebar, show, opened, closed }) => {
  runtime.togglePanel("workspace-a");
  assert.equal(sidebar.hidden, true); assert.equal(closed(), 1); assert.deepEqual(opened, []);
  runtime.togglePanel("workspace-a");
  assert.equal(sidebar.hidden, false); assert.deepEqual(opened, ["workspace-a"]);
  show(false); runtime.togglePanel("workspace-a");
  assert.equal(closed(), 1); assert.deepEqual(opened, ["workspace-a", "workspace-a"]);
  runtime.openPanel("workspace-a");
  assert.equal(closed(), 1, "automatic opening after save/fork never toggles a visible panel closed");
}));

test("the selected native bookmark tab collapses on repeat click and leaves nested close controls alone", () => fixture(({ window, sidebar, tab, show, closed, nativeSelections }) => {
  show(false); tab.click(); assert.equal(nativeSelections(), 1); assert.equal(closed(), 0);
  tab.click(); assert.equal(sidebar.hidden, true); assert.equal(closed(), 1); assert.equal(nativeSelections(), 1);
  show(); const close = window.document.createElement("button"); close.setAttribute("role", "button"); tab.append(close);
  let removed = false; close.addEventListener("click", (event: any) => { event.stopPropagation(); removed = true; });
  close.click(); assert.equal(removed, true); assert.equal(closed(), 1); assert.equal(sidebar.hidden, false);
}));

test("native tab keyboard gestures remain available to the host's keyboard drag controls", () => fixture(({ window, tab, closed, nativeKeys }) => {
  for (const key of ["Enter", " ", "ArrowRight"]) {
    for (const type of ["keydown", "keyup"]) {
      const event = new window.KeyboardEvent(type, { key, bubbles: true, cancelable: true }); tab.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
    }
  }
  assert.equal(closed(), 0); assert.equal(nativeKeys(), 3);
}));

test("other hosts, workspaces, panels and disposed adapters keep native behavior", () => fixture(({ runtime, tab, tabProps, toggleProps, show, closed, nativeSelections }) => {
  runtime.togglePanel("workspace-b"); assert.equal(closed(), 0);
  show(); toggleProps.normalizedWorkspaceId = "workspace-b"; tab.click(); assert.equal(closed(), 0); assert.equal(nativeSelections(), 1);
  toggleProps.normalizedWorkspaceId = "workspace-a"; tabProps.serverId = "host-b"; tab.click(); assert.equal(closed(), 0);
  tabProps.serverId = "host-a"; tabProps.tab.target.panelId = "different-panel"; tab.click(); assert.equal(closed(), 0);
  tabProps.tab.target.panelId = "bookmarks"; runtime.dispose(); tab.click(); assert.equal(closed(), 0); assert.equal(nativeSelections(), 4);
}));
