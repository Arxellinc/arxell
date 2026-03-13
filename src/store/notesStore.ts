import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

interface NotesStore {
  notes: Note[];
  addNote: (input?: Partial<Pick<Note, "title" | "content" | "tags">>) => Note;
  addNoteFromResponse: (content: string) => Note;
  updateNote: (id: string, patch: Partial<Pick<Note, "title" | "content" | "tags">>) => void;
  deleteNote: (id: string) => void;
}

const defaultWelcomeNote: Note = {
  id: "welcome-note",
  title: "Welcome to Notes",
  content: "This is a place for the agent to store notes to self. Notes can be searched and accessed later.",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: ["welcome", "help"],
};

function deriveNoteTitleFromResponse(content: string): string {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "Chat Response";
  const compact = firstLine.replace(/\s+/g, " ");
  if (compact.length <= 56) return compact;
  return `${compact.slice(0, 56)}...`;
}

export const useNotesStore = create<NotesStore>()(
  persist(
    (set) => ({
      notes: [defaultWelcomeNote],

      addNote: (input) => {
        const now = new Date().toISOString();
        const note: Note = {
          id: crypto.randomUUID(),
          title: input?.title?.trim() || "New Note",
          content: input?.content ?? "",
          createdAt: now,
          updatedAt: now,
          tags: Array.isArray(input?.tags) ? input.tags : [],
        };
        set((state) => ({ notes: [note, ...state.notes] }));
        return note;
      },

      addNoteFromResponse: (content) => {
        const now = new Date().toISOString();
        const trimmed = content.trim();
        const note: Note = {
          id: crypto.randomUUID(),
          title: deriveNoteTitleFromResponse(trimmed),
          content: trimmed,
          createdAt: now,
          updatedAt: now,
          tags: ["chat-response"],
        };
        set((state) => ({ notes: [note, ...state.notes] }));
        return note;
      },

      updateNote: (id, patch) =>
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id
              ? {
                  ...note,
                  ...patch,
                  title: patch.title !== undefined ? patch.title : note.title,
                  content: patch.content !== undefined ? patch.content : note.content,
                  tags: patch.tags !== undefined ? patch.tags : note.tags,
                  updatedAt: new Date().toISOString(),
                }
              : note
          ),
        })),

      deleteNote: (id) =>
        set((state) => ({ notes: state.notes.filter((note) => note.id !== id) })),
    }),
    {
      name: "arx-notes-v1",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
