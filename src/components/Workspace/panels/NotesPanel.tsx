import { StickyNote, Plus, Trash2, FileText, Eye, Edit3 } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "../../../lib/utils";
import { useNotesStore, type Note } from "../../../store/notesStore";
import { PanelWrapper } from "./shared";
import { SplitPaneLayout, SidebarItem, SidebarSearch, SidebarHeader } from "./SplitPaneLayout";

export function NotesPanel() {
  const notes = useNotesStore((s) => s.notes);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const removeNote = useNotesStore((s) => s.deleteNote);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  const selectedNote = notes.find(n => n.id === selectedNoteId);

  const filteredNotes = useMemo(() => notes.filter(note =>
    note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    note.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    note.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  ), [notes, searchQuery]);

  const createNote = () => {
    const newNote = addNote({ title: "New Note", content: "", tags: [] });
    setSelectedNoteId(newNote.id);
    setEditingTitle(newNote.title);
    setEditingContent(newNote.content);
  };

  const saveNote = () => {
    if (!selectedNoteId) return;
    updateNote(selectedNoteId, { title: editingTitle, content: editingContent });
  };

  const deleteNote = (id: string) => {
    removeNote(id);
    if (selectedNoteId === id) {
      setSelectedNoteId(null);
    }
  };

  const selectNote = (note: Note) => {
    setSelectedNoteId(note.id);
    setEditingTitle(note.title);
    setEditingContent(note.content);
  };

  useEffect(() => {
    if (selectedNote) {
      const timeout = setTimeout(saveNote, 500);
      return () => clearTimeout(timeout);
    }
  }, [editingTitle, editingContent, selectedNoteId]);

  useEffect(() => {
    if (!selectedNoteId && notes.length > 0) {
      const newest = notes[0];
      setSelectedNoteId(newest.id);
      setEditingTitle(newest.title);
      setEditingContent(newest.content);
      return;
    }

    if (selectedNoteId && !notes.some((n) => n.id === selectedNoteId)) {
      setSelectedNoteId(null);
      setEditingTitle("");
      setEditingContent("");
    }
  }, [notes, selectedNoteId]);

  // Build JSON data for the collapsible section
  const jsonData = useMemo(() => {
    if (!selectedNote) return null;
    return {
      selected: {
        id: selectedNote.id,
        title: selectedNote.title,
        content_length: selectedNote.content.length,
        tags: selectedNote.tags,
        created_at: selectedNote.createdAt,
        updated_at: selectedNote.updatedAt,
      },
      all_notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        tags: n.tags,
        updated_at: n.updatedAt,
      })),
    };
  }, [selectedNote, notes]);

  // Sidebar content
  const sidebar = (
    <>
      <SidebarSearch
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search notes..."
      />
      <SidebarHeader title="Notes" count={filteredNotes.length} />
      <div className="flex-1 overflow-y-auto">
        {filteredNotes.map(note => (
          <SidebarItem
            key={note.id}
            id={note.id}
            title={note.title || "Untitled"}
            subtitle={`${new Date(note.updatedAt).toLocaleDateString()} · ${note.content.slice(0, 50) || "No content"}`}
            icon={<StickyNote size={11} />}
            selected={selectedNoteId === note.id}
            onClick={() => selectNote(note)}
            actions={
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNote(note.id);
                }}
                className="p-1 rounded hover:bg-line-med text-text-dark hover:text-accent-red transition-colors"
              >
                <Trash2 size={10} />
              </button>
            }
          />
        ))}
      </div>
    </>
  );

  // Main content
  const content = selectedNote ? (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-line-med bg-bg-norm flex-shrink-0">
        <button
          onClick={() => setMode("edit")}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
            mode === "edit"
              ? "bg-line-dark text-text-norm"
              : "text-text-dark hover:text-text-med"
          )}
        >
          <Edit3 size={11} /> Edit
        </button>
        <button
          onClick={() => setMode("preview")}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
            mode === "preview"
              ? "bg-line-dark text-text-norm"
              : "text-text-dark hover:text-text-med"
          )}
        >
          <Eye size={11} /> Preview
        </button>
      </div>

      {/* Title */}
      <input
        type="text"
        value={editingTitle}
        onChange={(e) => setEditingTitle(e.target.value)}
        className="px-4 py-3 bg-transparent text-sm font-medium text-text-norm outline-none border-b border-line-light"
        placeholder="Note title..."
      />

      {/* Content */}
      {mode === "edit" ? (
        <textarea
          value={editingContent}
          onChange={(e) => setEditingContent(e.target.value)}
          className="flex-1 p-4 bg-transparent text-xs text-text-med outline-none resize-none font-mono leading-relaxed"
          placeholder="Write your notes here... (Markdown supported)"
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 minimal-md">
          {editingContent.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {editingContent}
            </ReactMarkdown>
          ) : (
            <p className="text-text-dark italic">No content to preview</p>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 border-t border-line-light text-[10px] text-text-dark flex-shrink-0">
        Last updated: {new Date(selectedNote.updatedAt).toLocaleString()}
      </div>
    </div>
  ) : (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
      <FileText size={24} className="text-text-dark" />
      <p className="text-xs text-text-dark">Select a note or create a new one</p>
    </div>
  );

  return (
    <PanelWrapper
      title={(
        <span className="inline-flex items-center gap-2">
          <span>Notes</span>
          <span className="text-[10px] text-text-dark bg-line-med px-1.5 py-0.5 rounded">
            {notes.length}
          </span>
        </span>
      )}
      icon={<StickyNote size={16} className="text-accent-gold" />}
      actions={
        <button
          onClick={createNote}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
        >
          <Plus size={12} />
          New
        </button>
      }
      fill
    >
      <SplitPaneLayout
        sidebar={sidebar}
        content={content}
        jsonData={jsonData}
        jsonLabel="Notes Data"
        storageKey="arx-notes-sidebar-width"
      />
    </PanelWrapper>
  );
}
