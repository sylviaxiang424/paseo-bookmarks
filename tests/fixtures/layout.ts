import { createWebAdapter } from "../../client/web";
import { en } from "../../client/locales";

const pane = document.querySelector<HTMLElement>("#pane")!;
const scroll = document.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]')!;
const input = document.querySelector<HTMLElement>('[data-testid="message-input-root"]')!;
const context = { serverId: "test-host", workspaceId: "test-workspace", agentId: "test-agent", ownerId: "test-agent" };
Object.assign(scroll, { __reactFiber$fixture: { memoizedProps: context } });
Object.assign(input, { __reactFiber$fixture: { memoizedProps: context } });
pane.style.width = `${Number(new URLSearchParams(location.search).get("width")) || 640}px`;
const text = "A bookmark should leave the original message width, height and reading position unchanged. ".repeat(7);
for (let index = 0; index < 24; index++) {
  const user = index % 3 === 0;
  const row = document.createElement("div");
  row.dataset.historyRowId = row.dataset.messageId = `message-${index}`;
  row.className = "row";
  const column = document.createElement("div"); column.className = "column";
  if (!user) column.appendChild(document.createElement("hr"));
  const body = document.createElement("div"); body.className = user ? "bubble" : "prose";
  const paragraph = document.createElement("p"); paragraph.textContent = index === 23 ? "Short answer." : text;
  body.appendChild(paragraph); column.appendChild(body);
  const copy = document.createElement("button"); copy.textContent = "Copy message";
  column.appendChild(copy); row.appendChild(column); scroll.firstElementChild!.appendChild(row);
  Object.assign(row, { __reactProps$fixture: { children: { props: { item: {
    kind: user ? "user_message" : "assistant_message", id: row.dataset.messageId, text: paragraph.textContent,
    timelineCursor: { seq: index + 1, epoch: "test-epoch" }, timestamp: new Date("2026-01-01"),
  } } } } });
}
let adapter: ReturnType<typeof createWebAdapter>;
let bookmarks: any[] = [];
let toggles = 0;
let hostResizes = 0;
const rows = Array.from(scroll.querySelectorAll<HTMLElement>(".row"));
const observer = new ResizeObserver(() => { hostResizes++; });
for (const row of rows) observer.observe(row);
const frames = async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame); };
const measure = () => ({
  scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, scrollWidth: scroll.scrollWidth,
  rows: rows.map(row => ({ height: row.getBoundingClientRect().height, width: row.firstElementChild!.getBoundingClientRect().width })),
});
Object.assign(window, { layoutFixture: {
  frames, measure,
  get toggles() { return toggles; },
  get resizes() { return hostResizes; },
  async prepare() { scroll.scrollTop = Math.round(scroll.scrollHeight * 0.4); await frames(); return measure(); },
  async mount() {
    adapter = createWebAdapter({ accepts: () => true, context() {}, fork() {}, bookmarks: () => bookmarks,
      title: () => "Layout fixture", t: ((key: keyof typeof en) => en[key]) as any, error: message => { throw new Error(message); }, prompt() {},
      async toggle(_, target) {
        toggles++;
        bookmarks = bookmarks.some(b => b.messageId === target.messageId) ? bookmarks.filter(b => b.messageId !== target.messageId)
          : [...bookmarks, { ...target, id: target.messageId, createdAt: new Date().toISOString() }];
        adapter?.refresh();
      },
    });
    await frames(); return measure();
  },
  async renderAgain() { for (const row of rows) row.firstElementChild!.className = "column"; adapter?.refresh(); await frames(); },
  async resize(width: number) { pane.style.width = `${width}px`; await frames(); },
  async dispose() { adapter?.dispose(); adapter = undefined; await frames(); return measure(); },
} });
