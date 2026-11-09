import type { Translate } from "./messages";
import { Platform } from "react-native";
import { readableText, summarize, type Bookmark, type BookmarkInput } from "../shared/bookmarks";

// Paseo 0.15 has no message-action/outline-decoration API. Keep its desktop
// compatibility boundary here. Never replace a renderer or import host stores.
// The host's own jump callback loads a window around the exact timeline seq,
// including rows absent from the DOM. All metadata is checked before use.
type Bag = Record<string, unknown>;
type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
type TextNode = { textContent: string | null; parentElement: ElementLike | null };
type WebEvent = { stopPropagation(): void; preventDefault(): void; key?: string };
type ElementLike = {
  [key: string]: unknown;
  parentElement: ElementLike | null;
  style: { position: string; cssText: string; setProperty(key: string, value: string): void };
  textContent: string | null;
  className: string;
  id: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelector(selector: string): ElementLike | null;
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
  getClientRects(): ArrayLike<Rect>;
  getBoundingClientRect(): Rect;
  closest(selector: string): ElementLike | null;
  appendChild(child: ElementLike): unknown;
  remove(): void;
  scrollIntoView(options: { block: string; behavior: string }): void;
  addEventListener(name: string, handler: (event: WebEvent) => void, capture?: boolean): void;
  removeEventListener(name: string, handler: (event: WebEvent) => void, capture?: boolean): void;
};
type Browser = {
  document: {
    activeElement?: ElementLike | null;
    body: ElementLike;
    head: ElementLike;
    createElement(tag: string): ElementLike;
    createElementNS(namespace: string, tag: string): ElementLike;
    createTreeWalker(root: ElementLike, show: number): { nextNode(): TextNode | null };
    createRange(): { selectNodeContents(node: TextNode): void; getBoundingClientRect(): Rect };
    querySelectorAll(selector: string): ArrayLike<ElementLike>;
  };
  getComputedStyle(element: ElementLike): { backgroundColor: string; borderRadius: string };
  MutationObserver: new (callback: (records: Array<{ target: ElementLike }>) => void) => {
    observe(node: ElementLike, options: Bag): void;
    disconnect(): void;
  };
};
type Fiber = { return?: Fiber; child?: Fiber; sibling?: Fiber; memoizedProps?: unknown };
export type ChatContext = { serverId: string; workspaceId: string; ownerId: string; agentId?: string; draftId?: string; focused?: boolean };
export type ForkSource = ChatContext & { draftId: string; sourceAgentId: string };
export type WebCallbacks = {
  accepts(context: ChatContext): boolean;
  context(context: ChatContext): void;
  fork(source: ForkSource): void;
  bookmarks(context: ChatContext): readonly Bookmark[];
  toggle(context: ChatContext, bookmark: BookmarkInput): Promise<void>;
  prompt(bookmarks: readonly Bookmark[]): void;
  title(agentId: string): string;
  t: Translate;
  error(message: string): void;
};
const bag = (value: unknown): Bag => value !== null && typeof value === "object" ? value as Bag : {};
const string = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 ? value : undefined;
const fiberOf = (element: ElementLike): Fiber | undefined => {
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
  return key ? element[key] as Fiber : undefined;
};
function ancestorProps(fiber: Fiber | undefined): Bag[] {
  const result: Bag[] = [];
  for (let depth = 0; fiber && depth < 55; depth++, fiber = fiber.return) result.push(bag(fiber.memoizedProps));
  return result;
}
const ancestors = (element: ElementLike) => ancestorProps(fiberOf(element));
function visible(element: ElementLike) {
  return element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0;
}
function contextFrom(propsList: Bag[]): ChatContext | undefined {
  let serverId: string | undefined, workspaceId: string | undefined, agentId: string | undefined, draftId: string | undefined;
  let focused: boolean | undefined;
  for (const props of propsList) {
    serverId ??= string(props.serverId);
    workspaceId ??= string(props.workspaceId) ?? string(bag(props.workspace).id);
    agentId ??= string(props.agentId) ?? string(bag(props.agent).id);
    draftId ??= string(props.draftId);
    if (focused === undefined && typeof props.isPaneFocused === "boolean") focused = props.isPaneFocused;
  }
  if (!serverId || !workspaceId || (!agentId && !draftId)) return;
  return { serverId, workspaceId, ownerId: draftId ? `draft:${draftId}` : agentId!, focused, ...(draftId ? { draftId } : { agentId }) };
}
const contextOf = (element: ElementLike) => contextFrom(ancestors(element));
function rowItem(row: ElementLike): Bag {
  const key = Object.keys(row).find((name) => name.startsWith("__reactProps$"));
  const props = key ? bag(row[key]) : {};
  const direct = bag(bag(props.children).props).item;
  if (direct) return bag(direct);
  // Hosts can wrap StreamRowContent; bounded to this row's React subtree.
  let fiber = fiberOf(row)?.child;
  for (let count = 0; fiber && count < 12; count++, fiber = fiber.child) {
    const item = bag(fiber.memoizedProps).item;
    if (item) return bag(item);
  }
  return {};
}
function outlineProps(element: ElementLike): Bag | undefined {
  const expected = contextOf(element);
  let root = fiberOf(element);
  for (let depth = 0; root && depth < 35; depth++, root = root.return) {
    // The outline is a sibling of the feed. Search breadth-first so a long
    // message/tool subtree cannot exhaust the guard before reaching that sibling.
    const queue = [root];
    for (let index = 0; index < queue.length && index < 1800; index++) {
      const node = queue[index];
      if (!node) continue;
      const props = bag(node.memoizedProps);
      if (typeof props.onJumpToPrompt === "function") {
        const owner = contextFrom(ancestorProps(node));
        if (!owner || (owner.agentId === expected?.agentId && owner.serverId === expected?.serverId)) return props;
      }
      if (node.child) queue.push(node.child);
      if (node !== root && node.sibling) queue.push(node.sibling);
    }
  }
}

function messageViewProps(scroll: ElementLike): Bag | undefined {
  const expected = contextOf(scroll);
  return ancestors(scroll).find((props) => Array.isArray(props.items) && props.agentId === expected?.agentId &&
    (!props.serverId || props.serverId === expected?.serverId) && typeof bag(bag(props.viewportRef).current).scrollToMessage === "function");
}
function matchesTarget(item: Bag, bookmark: Bookmark, rowId?: string | null): boolean {
  const cursor = bag(item.timelineCursor), data = bag(item.data);
  if (cursor.epoch && cursor.epoch !== bookmark.epoch) return false;
  const ids = [rowId, item.id, item.messageId, item.clientMessageId, item.sourceId, data.messageId, data.clientMessageId];
  if (ids.some((id) => typeof id === "string" && [bookmark.messageId, ...bookmark.aliases].includes(id))) return true;
  const kind = item.kind === "plugin" ? String(item.itemKind ?? "") : String(item.kind ?? "");
  const role = /user|prompt/.test(kind) ? "user" : /assistant|reply/.test(kind) ? "assistant" : undefined;
  const text = string(item.text) ?? string(data.messageText) ?? string(data.text);
  return cursor.epoch === bookmark.epoch && cursor.seq === bookmark.seq && role === bookmark.role && Boolean(text && bookmark.summary && summarize(text).startsWith(bookmark.summary.slice(0, 100)));
}
function describe(row: ElementLike, context: ChatContext, promptSeqs: number[], title: string): BookmarkInput | undefined {
  const item = rowItem(row), data = bag(item.data), cursor = bag(item.timelineCursor);
  const kind = item.kind === "plugin" ? string(item.itemKind) ?? "" : string(item.kind) ?? "";
  const role = /user|prompt/.test(kind) ? "user" : /assistant|reply/.test(kind) ? "assistant" : undefined;
  const text = string(item.text) ?? string(data.messageText) ?? string(data.text);
  const seq = cursor.seq, epoch = string(cursor.epoch);
  const aliases = [...new Set([row.getAttribute("data-message-id"), item.messageId, item.clientMessageId, item.sourceId, data.messageId, data.clientMessageId].filter((value): value is string => typeof value === "string" && value.length > 0))];
  if (!context.agentId || !role || !text || typeof seq !== "number" || !epoch || !aliases.length) return;
  const summary = summarize(text);
  if (!summary) return;
  const timestamp = item.timestamp instanceof Date ? item.timestamp.toISOString() : string(item.timestamp) ?? new Date().toISOString();
  return { sourceAgentId: context.agentId, sourceWorkspaceId: context.workspaceId, sourceTitle: title.slice(0, 240), messageId: string(item.messageId) ?? string(data.messageId) ?? aliases[0], aliases: aliases.slice(0, 8), role, seq, epoch, promptSeq: promptSeqs.filter((value) => value <= seq).pop() ?? seq, summary, timestamp };
}

// Read rendered text bounds, rather than the full-width measurement row. This
// excludes Markdown rules and footer controls without replacing any renderer.
function messageSurface(row: ElementLike, role: Bookmark["role"], browser: Browser) {
  const item = rowItem(row), data = bag(item.data);
  const raw = string(item.text) ?? string(data.messageText) ?? string(data.text) ?? "";
  const source = readableText(raw), literal = raw.replace(/\s+/g, " ");
  if (!source) return;
  const walker = browser.document.createTreeWalker(row, 4); // SHOW_TEXT
  const range = browser.document.createRange();
  const nodes: TextNode[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement, text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (parent && text && (source.includes(text) || literal.includes(text)) && !parent.closest('button,[role="button"],[data-pb-ui],[aria-hidden="true"]')) {
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) nodes.push(node);
    }
  }
  const first = nodes[0]?.parentElement;
  if (!first) return;
  let column = first;
  while (column.parentElement && column.parentElement !== row) column = column.parentElement;
  let bubble: ElementLike | undefined;
  if (role === "user") for (let parent: ElementLike | null = first; parent && parent !== column; parent = parent.parentElement) {
    const style = browser.getComputedStyle(parent);
    if (Number.parseFloat(style.borderRadius) > 0 && style.backgroundColor && !/^(?:transparent|rgba\([^)]*,\s*0\))$/.test(style.backgroundColor)) { bubble = parent; break; }
  }
  return { column, nodes, bubble };
}
function surfaceBounds(surface: NonNullable<ReturnType<typeof messageSurface>>, browser: Browser): Rect | undefined {
  if (surface.bubble) return surface.bubble.getBoundingClientRect();
  const range = browser.document.createRange();
  const rects = surface.nodes.map((node) => { range.selectNodeContents(node); return range.getBoundingClientRect(); }).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return;
  const left = Math.min(...rects.map((rect) => rect.left)), right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top)), bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

const CSS = `
.pb-message-column{width:calc(100% - 64px)!important}
.pb-message-tools{position:absolute;inset:0;pointer-events:none}
.pb-message-action{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:26px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--pb-muted);cursor:pointer;opacity:0;transition:opacity .12s,background-color .12s}
.pb-message-action{position:absolute;pointer-events:auto}
[data-history-row-id]:hover>.pb-message-tools>.pb-message-action,.pb-message-tools:focus-within>.pb-message-action,.pb-message-action[aria-pressed=true]{opacity:1}
.pb-message-action:hover{background:color-mix(in srgb,var(--pb-muted) 10%,transparent)}
.pb-message-action:focus-visible{outline:2px solid var(--pb-accent);outline-offset:2px}
.pb-message-action svg{display:block;pointer-events:none}
.pb-message-action[aria-pressed=true]{color:var(--pb-accent)}
.pb-message-highlight{position:absolute;pointer-events:none;border-radius:6px;background-color:color-mix(in srgb,var(--pb-accent) 10%,transparent);animation:pb-bookmark-flash 1.8s ease-out}
@keyframes pb-bookmark-flash{0%,45%{background-color:color-mix(in srgb,var(--pb-accent) 10%,transparent)}100%{background-color:transparent}}
[data-pb-count]>div{background:var(--pb-accent)!important;min-width:16px;min-height:3px;border-radius:999px}
@media(prefers-reduced-motion:reduce){.pb-message-action{transition:none}.pb-message-highlight{animation:none}}
@media(hover:none){.pb-message-action{opacity:1}}
`;

export function createWebAdapter(callbacks: WebCallbacks) {
  if (Platform.OS !== "web") return undefined;
  const browser = globalThis as unknown as Browser;
  if (!browser.document?.body || !browser.MutationObserver) return undefined;
  const document = browser.document;
  const actions = new Map<ElementLike, { toolbar: ElementLike; button: ElementLike; icon: ElementLike; column?: ElementLike; position: string; target: BookmarkInput; context: ChatContext }>();
  const ticks = new Map<ElementLike, { title: string | null; click: (event: WebEvent) => void; entries: readonly Bookmark[] }>();
  let disposed = false, scheduled: ReturnType<typeof setTimeout> | undefined;
  let jumpVersion = 0;
  let highlight: { node: ElementLike; timer: ReturnType<typeof setTimeout> } | undefined;
  const clearHighlight = () => {
    if (!highlight) return;
    clearTimeout(highlight.timer); highlight.node.remove(); highlight = undefined;
  };
  let theme = { accent: "#b7791f", muted: "#6b7280", surface: "#ffffff", border: "#e5e7eb" };
  const style = document.createElement("style");
  style.setAttribute("data-pb-ui", "style"); style.textContent = CSS; document.head.appendChild(style);
  const visibleScrolls = () => Array.from(document.querySelectorAll('[data-testid="agent-chat-scroll"]')).filter(visible);
  const activeScroll = (agentId?: string) => {
    const scrolls = visibleScrolls();
    return agentId ? scrolls.find((node) => contextOf(node)?.agentId === agentId) : scrolls.find((node) => contextOf(node)?.focused === true) ?? scrolls[0];
  };
  const colors = (node: ElementLike) => {
    for (const [name, value] of Object.entries(theme)) node.style.setProperty(`--pb-${name}`, value);
  };
  const clearAction = (row: ElementLike) => {
    const action = actions.get(row);
    if (!action) return;
    action.toolbar.remove();
    if (action.column) action.column.className = action.column.className.replace(/(?:^|\s)pb-message-column(?=\s|$)/g, "").trim();
    if (!action.position && row.style.position === "relative") row.style.position = action.position;
    actions.delete(row);
  };
  const clearTick = (tick: ElementLike) => {
    const state = ticks.get(tick); if (!state) return;
    tick.removeAttribute("data-pb-count");
    if (state.title === null) tick.removeAttribute("title"); else tick.setAttribute("title", state.title);
    tick.removeEventListener("click", state.click, true); ticks.delete(tick);
  };
  const scan = () => {
    if (disposed) return;
    const inputs = Array.from(document.querySelectorAll('[data-testid="message-input-root"]')).filter(visible);
    const focusedInput = document.activeElement?.closest('[data-testid="message-input-root"]');
    const input = inputs.find((node) => contextOf(node)?.focused === true) ?? (focusedInput && visible(focusedInput) ? focusedInput : inputs[0]);
    const inputContext = input ? contextOf(input) : undefined;
    const scroll = activeScroll(inputContext?.agentId);
    const context = input ? contextOf(input) : scroll ? contextOf(scroll) : undefined;
    if (!context || !callbacks.accepts(context)) {
      for (const row of actions.keys()) clearAction(row);
      for (const tick of ticks.keys()) clearTick(tick);
      return;
    }
    callbacks.context(context);
    if (context.draftId && input) {
      for (const props of ancestors(input)) {
        const attachments = Array.isArray(props.attachments) ? props.attachments : [];
        const source = attachments.map(bag).find((entry) => entry.kind === "chat_history" && string(bag(entry.source).agentId));
        if (source) { callbacks.fork({ ...context, draftId: context.draftId, sourceAgentId: String(bag(source.source).agentId) }); break; }
      }
    }
    const current = scroll ? contextOf(scroll) : undefined;
    const seenRows = new Set<ElementLike>(), seenTicks = new Set<ElementLike>();
    if (scroll && current?.agentId && current.serverId === context.serverId && current.workspaceId === context.workspaceId && current.agentId === context.agentId) {
      let railParent: ElementLike | null = scroll;
      for (let depth = 0; railParent && depth < 10 && !railParent.querySelector('[data-testid="chat-outline-rail"]'); depth++) railParent = railParent.parentElement;
      const rail = railParent?.querySelector('[data-testid="chat-outline-rail"]');
      const railTicks = rail ? Array.from(rail.querySelectorAll('[data-testid^="chat-outline-tick-"]')) : [];
      const promptSeqs = railTicks.map((node) => Number(node.getAttribute("data-testid")!.replace("chat-outline-tick-", "")));
      if (!promptSeqs.length) {
        const prompts = outlineProps(scroll)?.prompts;
        if (Array.isArray(prompts)) for (const prompt of prompts) {
          const seq = bag(prompt).seq;
          if (typeof seq === "number" && Number.isFinite(seq)) promptSeqs.push(seq);
        }
      }
      promptSeqs.sort((a, b) => a - b);
      const saved = callbacks.bookmarks(current);
      const seenMessages = new Set<string>();
      for (const row of Array.from(scroll.querySelectorAll("[data-history-row-id][data-message-id]"))) {
        const target = describe(row, current, promptSeqs, callbacks.title(current.agentId));
        if (!target || seenMessages.has(target.messageId)) continue;
        seenMessages.add(target.messageId); seenRows.add(row); colors(row);
        let action = actions.get(row);
        if (!action) {
          const toolbar = document.createElement("div");
          toolbar.className = "pb-message-tools"; toolbar.setAttribute("data-pb-ui", "action-bar");
          const button = document.createElement("button");
          button.className = "pb-message-action"; button.setAttribute("type", "button"); button.setAttribute("data-pb-ui", "action");
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          for (const [name, value] of Object.entries({ width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) icon.setAttribute(name, value);
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", "M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z");
          icon.appendChild(path); button.appendChild(icon); toolbar.appendChild(button);
          const state = { toolbar, button, icon, column: undefined as ElementLike | undefined, position: row.style.position, target, context: current };
          action = state; actions.set(row, state);
          button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void callbacks.toggle(state.context, state.target).catch(() => callbacks.error("BOOKMARKS_SAVE_FAILED")); });
          if (!row.style.position) row.style.position = "relative";
          row.appendChild(toolbar);
        }
        action.target = target; action.context = current;
        const surface = messageSurface(row, target.role, browser);
        if (action.column && action.column !== surface?.column) action.column.className = action.column.className.replace(/(?:^|\s)pb-message-column(?=\s|$)/g, "").trim();
        action.column = surface?.column;
        if (surface && !/(?:^|\s)pb-message-column(?:\s|$)/.test(surface.column.className)) surface.column.className += " pb-message-column";
        const bounds = surface && surfaceBounds(surface, browser), rowBounds = row.getBoundingClientRect();
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          let top = bounds.top - rowBounds.top + (target.role === "user" ? 4 : -4);
          if (target.role === "assistant" && surface) {
            // The leading rule is decorative: place the control below it and
            // keep the following text's own bounds for jump highlighting.
            const rule = Array.from(surface.column.querySelectorAll('hr,[role="separator"],div')).map((node) => ({ node, rect: node.getBoundingClientRect() }))
              .filter(({ node, rect }) => !node.textContent?.trim() && rect.height > 0 && rect.height <= 2.5 && rect.width >= bounds.width * 0.5 && rect.bottom <= bounds.top)
              .sort((a, b) => b.rect.bottom - a.rect.bottom)[0];
            if (rule) top = rule.rect.bottom - rowBounds.top + 6;
          }
          const anchorRight = target.role === "assistant" && surface ? surface.column.getBoundingClientRect().right : bounds.right;
          action.button.style.setProperty("left", `${Math.min(anchorRight - rowBounds.left + 8, rowBounds.width - 26)}px`);
          action.button.style.setProperty("top", `${Math.max(0, top)}px`);
          action.toolbar.style.setProperty("visibility", "visible");
        } else action.toolbar.style.setProperty("visibility", "hidden");
        const selected = saved.some((entry) => entry.sourceAgentId === target.sourceAgentId && (entry.messageId === target.messageId || entry.aliases.some((id) => target.aliases.includes(id))));
        const label = callbacks.t(selected ? "remove" : "add");
        if (action.button.getAttribute("aria-label") !== label) {
          action.button.setAttribute("aria-label", label); action.button.setAttribute("title", label);
          action.button.setAttribute("aria-pressed", String(selected)); action.icon.setAttribute("fill", selected ? "currentColor" : "none");
        }
      }
      for (const tick of railTicks) {
        const seq = Number(tick.getAttribute("data-testid")!.replace("chat-outline-tick-", ""));
        const entries = saved.filter((entry) => entry.sourceAgentId === current.agentId && entry.promptSeq === seq);
        if (!entries.length) continue;
        seenTicks.add(tick); colors(tick);
        let state = ticks.get(tick);
        if (!state) {
          const value = { title: tick.getAttribute("title"), entries, click: (event: WebEvent) => { event.preventDefault(); event.stopPropagation(); callbacks.prompt(value.entries); } };
          tick.addEventListener("click", value.click, true); ticks.set(tick, value); state = value;
        }
        state.entries = entries;
        const title = entries.map((entry) => `${callbacks.t(entry.role === "user" ? "question" : "answer")} · ${entry.summary.slice(0, 120)}`).join("\n");
        tick.setAttribute("data-pb-count", String(entries.length));
        if (tick.getAttribute("title") !== title) tick.setAttribute("title", title);
      }
    }
    for (const row of actions.keys()) if (!seenRows.has(row)) clearAction(row);
    for (const tick of ticks.keys()) if (!seenTicks.has(tick)) clearTick(tick);
  };
  const schedule = () => { if (!disposed && !scheduled) scheduled = setTimeout(() => { scheduled = undefined; scan(); }, 100); };
  const observer = new browser.MutationObserver((records) => {
    if (records.some((record) => !record.target.closest?.("[data-pb-ui]"))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = setInterval(schedule, 700);
  scan();
  return {
    refresh: schedule,
    setTheme(next: typeof theme) { theme = next; schedule(); },
    async jump(bookmark: Bookmark): Promise<boolean> {
      if (disposed) return false;
      const version = ++jumpVersion, deadline = Date.now() + 8000;
      let previousScroll: ElementLike | undefined, positioned: ElementLike | undefined;
      let nextReveal = 0, nextOutline = 0, nextPosition = 0, positionedAt = 0, stablePasses = 0;
      clearHighlight();
      // Navigation, history loading and virtualized lane changes can all replace
      // this DOM node. Resolve the live source viewport on every pass.
      while (!disposed && version === jumpVersion && Date.now() < deadline) {
        const candidates = visibleScrolls().filter((node) => { const context = contextOf(node); return context?.agentId === bookmark.sourceAgentId && callbacks.accepts(context); });
        const scroll = candidates.find((node) => contextOf(node)?.focused === true) ?? candidates[0];
        if (!scroll) { await new Promise<void>((resolve) => setTimeout(resolve, 100)); continue; }
        if (scroll !== previousScroll) {
          previousScroll = scroll; positioned = undefined; stablePasses = 0; nextReveal = nextOutline = nextPosition = 0;
        }
        const mounted = () => Array.from(scroll.querySelectorAll("[data-history-row-id][data-message-id]")).find((row) => matchesTarget(rowItem(row), bookmark, row.getAttribute("data-message-id")));
        const view = messageViewProps(scroll), viewport = bag(bag(view?.viewportRef).current);
        const loaded = view && (view.items as unknown[]).map(bag).find((item) => matchesTarget(item, bookmark));
        let target = mounted();
        if (!target && view && Date.now() >= nextReveal) {
          const id = loaded && (loaded.kind === "plugin" ? string(loaded.sourceId) ?? string(loaded.id) : string(loaded.id));
          if (id) {
            // Chat find's reveal path also expands folded turns, unlike the
            // outline path which only loads the history window.
            try {
              if (typeof view.revealLoadedMessage === "function") view.revealLoadedMessage(id);
              if (typeof viewport.scrollToMessage === "function") viewport.scrollToMessage(id);
            } catch { /* A concurrent unmount is retried against fresh props. */ }
            nextReveal = Date.now() + 800; target = mounted();
          }
        }
        if (!target && !loaded && Date.now() >= nextOutline) {
          const jump = outlineProps(scroll)?.onJumpToPrompt;
          if (typeof jump === "function") {
            try { jump(bookmark.seq); } catch { /* Reacquire the new bridge. */ }
            nextOutline = Date.now() + 1200; target = mounted();
          }
        }
        if (target) {
          const rect = target.getBoundingClientRect(), container = scroll.getBoundingClientRect();
          const inView = rect.height > 0 && rect.bottom > container.top && rect.top < container.bottom;
          if (positioned !== target || (!inView && Date.now() >= nextPosition)) {
            const id = target.getAttribute("data-message-id");
            try {
              if (id && typeof viewport.scrollToMessage === "function") viewport.scrollToMessage(id);
              else target.scrollIntoView({ block: "start", behavior: "auto" });
            } catch { positioned = undefined; await new Promise<void>((resolve) => setTimeout(resolve, 100)); continue; }
            positioned = target; positionedAt = Date.now(); nextPosition = positionedAt + 800; stablePasses = 0;
          } else if (inView && Date.now() - positionedAt >= 100) stablePasses++;
          else stablePasses = 0;
          // Confirm the row remains mounted and visible after React and the
          // native scroll controller have had a chance to settle.
          if (stablePasses < 2) { await new Promise<void>((resolve) => setTimeout(resolve, 100)); continue; }
          clearHighlight();
          const surface = messageSurface(target, bookmark.role, browser), bounds = surface && surfaceBounds(surface, browser);
          const question = bookmark.role === "user";
          // A question may only flash its actual bubble. Never fall back to a
          // text/row rectangle when that bubble cannot be identified.
          if (bounds && (!question || surface?.bubble)) {
            const rowBounds = target.getBoundingClientRect(), layer = document.createElement("div");
            layer.className = "pb-message-highlight"; layer.setAttribute("data-pb-ui", "highlight"); layer.setAttribute("aria-hidden", "true");
            const paddingX = question ? 0 : 6, paddingY = question ? 0 : 4;
            const left = Math.max(0, bounds.left - rowBounds.left - paddingX), right = Math.min(rowBounds.width, bounds.right - rowBounds.left + paddingX);
            layer.style.cssText = `left:${left}px;top:${Math.max(0, bounds.top - rowBounds.top - paddingY)}px;width:${right - left}px;height:${bounds.height + paddingY * 2}px`;
            if (question && surface?.bubble) layer.style.setProperty("border-radius", browser.getComputedStyle(surface.bubble).borderRadius);
            colors(layer); target.appendChild(layer);
            highlight = { node: layer, timer: setTimeout(clearHighlight, 1800) };
          }
          return true;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      return false;
    },
    dispose() {
      disposed = true; observer.disconnect(); clearInterval(timer); if (scheduled) clearTimeout(scheduled);
      jumpVersion++;
      clearHighlight();
      for (const row of actions.keys()) clearAction(row);
      for (const tick of ticks.keys()) clearTick(tick);
      style.remove();
    },
  };
}
