import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bookmarkId, emptySession, sessionSchema, summarize, type BookmarkInput, type BookmarkSession } from "../shared/bookmarks";

const fileSchema = z.object({ version: z.literal(1), sessions: z.record(z.string(), sessionSchema) });
type FileState = z.infer<typeof fileSchema>;

// Serialize mutations and rename a complete private file, so concurrent clicks
// and a plugin reload cannot truncate the saved bookmarks.
export class BookmarkStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly file = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "plugin-data", "paseo-bookmarks", "bookmarks.json")) {}

  private async read(): Promise<FileState> {
    try {
      const data = fileSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
      data.sessions = Object.assign(Object.create(null), data.sessions);
      for (const session of Object.values(data.sessions)) for (const entry of session.bookmarks) entry.summary = summarize(entry.summary) || entry.summary;
      return data;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sessions: Object.create(null) };
      throw new Error("BOOKMARKS_READ_FAILED");
    }
  }
  private async write(data: FileState) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, this.file);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  private transact(ownerId: string, update?: (session: BookmarkSession, data: FileState) => void): Promise<BookmarkSession> {
    const task = this.queue.then(async () => {
      const data = await this.read();
      const session = data.sessions[ownerId] ?? emptySession();
      if (update) {
        update(session, data);
        data.sessions[ownerId] = session;
        await this.write(data);
      }
      return sessionSchema.parse(session);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  list(ownerId: string) { return this.transact(ownerId); }
  save(ownerId: string, input: BookmarkInput) {
    return this.transact(ownerId, (session) => {
      const id = bookmarkId(input);
      const existing = session.bookmarks.find((entry) => entry.id === id);
      if (existing) Object.assign(existing, input);
      else session.bookmarks.push({ ...input, id, createdAt: new Date().toISOString() });
      session.bookmarks.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.seq - b.seq);
    });
  }
  remove(ownerId: string, id: string) {
    return this.transact(ownerId, (session) => { session.bookmarks = session.bookmarks.filter((entry) => entry.id !== id); });
  }
  inherit(ownerId: string, sourceAgentId: string, accepted: boolean) {
    return this.transact(ownerId, (session, data) => {
      if (session.inheritance) return;
      if (ownerId === sourceAgentId) throw new Error("BOOKMARKS_SELF_INHERITANCE");
      session.inheritance = { sourceAgentId, accepted };
      if (!accepted) return;
      for (const source of data.sessions[sourceAgentId]?.bookmarks ?? []) {
        if (!session.bookmarks.some((entry) => entry.id === source.id)) session.bookmarks.push({ ...source, inheritedFrom: sourceAgentId });
      }
      session.bookmarks.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.seq - b.seq);
    });
  }
  bind(draftId: string, agentId: string) {
    return this.transact(agentId, (session, data) => {
      const draftOwner = `draft:${draftId}`;
      const draft = data.sessions[draftOwner];
      if (!draft) return;
      for (const entry of draft.bookmarks) if (!session.bookmarks.some((saved) => saved.id === entry.id)) session.bookmarks.push(entry);
      if (!session.inheritance && draft.inheritance) session.inheritance = draft.inheritance;
      delete data.sessions[draftOwner];
    });
  }
}
