import type { PluginClientContext, PluginButtonIconProps, PluginButtonRegistration, PluginText } from "@getpaseo/plugin/client";
import { messages } from "./client/messages";
import { BookmarkRuntime } from "./client/runtime";
import { BookmarkBridge, BookmarkPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  const runtime = new BookmarkRuntime(client);
  const lifetime = new AbortController();
  const headers = new Map<string, PluginButtonRegistration<PluginText>>();
  const Icon = (props: PluginButtonIconProps) => <BookmarkBridge {...props} runtime={runtime} />;
  const stopPanel = client.addWorkspacePanel({ id: "bookmarks", title: messages.message("bookmarks"), icon: "Bookmark", locations: ["explorer"], Component: (props) => <BookmarkPanel {...props} runtime={runtime} /> });
  const stopCommand = client.addCommandCenterItem({ id: "open-bookmarks", title: messages.message("open"), icon: "Bookmark", context: "workspace", keywords: ["bookmark", "书签", "收藏"], onSelect({ workspace }) { runtime.openPanel(workspace.id); } });
  const register = (agent: { id: string; workspaceId?: string | null; title?: string | null }) => {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    runtime.setTitles([agent]);
    const workspaceId = agent.workspaceId;
    if (!headers.has(workspaceId)) headers.set(workspaceId, client.addHeaderButton({ id: "bookmarks", workspaceId, button: { title: messages.message("open"), label: messages.message("bookmarks"), icon: Icon, behavior: { kind: "action", onPress: () => runtime.openPanel(workspaceId) } } }));
  };
  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
    if (lifetime.signal.aborted) { void subscription.release(); return; }
    let generation = 0;
    subscription.subscribe({
      snapshot: (first) => {
        const run = ++generation;
        for (const { agent } of first.entries) register(agent);
        void (async () => {
          let page: { entries: typeof first.entries; pageInfo: typeof first.pageInfo } = first;
          while (page.pageInfo.hasMore && page.pageInfo.nextCursor && !lifetime.signal.aborted && run === generation) {
            page = await client.paseo.agents.list({ page: { cursor: page.pageInfo.nextCursor, limit: 100 }, signal: lifetime.signal });
            if (!lifetime.signal.aborted && run === generation) for (const { agent } of page.entries) register(agent);
          }
        })().catch(() => undefined);
      },
      update: (message) => {
        if (message.type === "agent_update" && message.payload.kind === "upsert") register(message.payload.agent);
      },
    });
  }).catch((error) => { if (!lifetime.signal.aborted) console.error("Bookmark directory observation failed", error); });
  return () => {
    lifetime.abort(); runtime.dispose(); stopPanel(); stopCommand();
    for (const header of headers.values()) header.remove();
  };
}
