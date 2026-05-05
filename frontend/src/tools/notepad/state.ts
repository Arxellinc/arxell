export interface NotepadToolStateSlice {
  notepadOpenTabs: string[];
  notepadActiveTabId: string | null;
  notepadPathByTabId: Record<string, string | null>;
  notepadTitleByTabId: Record<string, string>;
  notepadContentByTabId: Record<string, string>;
  notepadSavedContentByTabId: Record<string, string>;
  notepadDirtyByTabId: Record<string, boolean>;
  notepadLoadingByTabId: Record<string, boolean>;
  notepadSavingByTabId: Record<string, boolean>;
  notepadReadOnlyByTabId: Record<string, boolean>;
  notepadSizeByTabId: Record<string, number>;
  notepadNextUntitledIndex: number;
  notepadFindOpen: boolean;
  notepadFindQuery: string;
  notepadReplaceQuery: string;
  notepadFindCaseSensitive: boolean;
  notepadLineWrap: boolean;
  notepadError: string | null;
  notepadUnsavedModalTabId: string | null;
}
