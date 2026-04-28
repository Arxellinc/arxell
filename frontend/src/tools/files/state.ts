import type { FilesListDirectoryEntry } from "../../contracts";

export interface FilesColumnWidths {
  name: number;
  type: number;
  size: number;
  modified: number;
}

export interface FilesDeleteUndoDirSnapshot {
  kind: "dir";
  path: string;
}

export interface FilesDeleteUndoFileSnapshot {
  kind: "file";
  path: string;
  content: string;
}

export type FilesDeleteUndoSnapshot = FilesDeleteUndoDirSnapshot | FilesDeleteUndoFileSnapshot;

export interface FilesDeleteUndoEntry {
  deletedAtMs: number;
  snapshots: FilesDeleteUndoSnapshot[];
}

export interface FilesToolStateSlice {
  filesRootPath: string | null;
  filesScopeRootPath: string | null;
  filesRootSelectorOpen: boolean;
  filesSelectedPath: string | null;
  filesSelectedEntryPath: string | null;
  filesOpenTabs: string[];
  filesActiveTabPath: string | null;
  filesContentByPath: Record<string, string>;
  filesSavedContentByPath: Record<string, string>;
  filesDirtyByPath: Record<string, boolean>;
  filesLoadingFileByPath: Record<string, boolean>;
  filesSavingFileByPath: Record<string, boolean>;
  filesReadOnlyByPath: Record<string, boolean>;
  filesSizeByPath: Record<string, number>;
  filesExpandedByPath: Record<string, boolean>;
  filesEntriesByPath: Record<string, FilesListDirectoryEntry[]>;
  filesLoadingByPath: Record<string, boolean>;
  filesColumnWidths: Partial<FilesColumnWidths>;
  filesSidebarWidth: number;
  filesSidebarCollapsed: boolean;
  filesFindOpen: boolean;
  filesFindQuery: string;
  filesReplaceQuery: string;
  filesFindCaseSensitive: boolean;
  filesLineWrap: boolean;
  filesSelectedPaths: string[];
  filesContextMenuOpen: boolean;
  filesContextMenuX: number;
  filesContextMenuY: number;
  filesContextMenuTargetPath: string | null;
  filesContextMenuTargetIsDir: boolean;
  filesContextMenuPointerInside?: boolean;
  filesClipboardMode: "copy" | "cut" | null;
  filesClipboardPaths: string[];
  filesDeleteUndoStack: FilesDeleteUndoEntry[];
  filesConflictModalOpen: boolean;
  filesConflictName: string;
  filesSelectionAnchorPath: string | null;
  filesSelectionDragActive: boolean;
  filesSelectionJustDragged: boolean;
  filesSelectionGesture: "single" | "toggle" | "range" | null;
  filesError: string | null;
}
