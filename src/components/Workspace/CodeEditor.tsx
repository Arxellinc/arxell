import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useWorkspace } from "../../hooks/useWorkspace";

interface CodeEditorProps {
  path: string;
  content: string;
  language: string;
  wordWrap?: boolean;
  onChange?: (value: string) => void;
}

export interface CodeEditorHandle {
  undo: () => void;
  redo: () => void;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { path, content, language, wordWrap = false, onChange }: CodeEditorProps,
  ref
) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const { updateTabContent } = useWorkspaceStore();
  const { saveFile } = useWorkspace();

  const handleMount = (ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed;
    // Ctrl/Cmd+S to save (KeyCode 49 = KeyS, KeyMod.CtrlCmd = 2048)
    ed.addCommand(2048 | 49, () => {
      saveFile(path, ed.getValue());
    });
  };

  const handleChange = (value: string | undefined) => {
    if (value === undefined) return;
    updateTabContent(path, value);
    onChange?.(value);
  };

  useImperativeHandle(ref, () => ({
    undo: () => {
      editorRef.current?.trigger("toolbar", "undo", null);
    },
    redo: () => {
      editorRef.current?.trigger("toolbar", "redo", null);
    },
  }), []);

  return (
    <Editor
      className="workspace-code-editor"
      height="100%"
      language={language}
      value={content}
      theme="vs-dark"
      onMount={handleMount}
      onChange={handleChange}
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontLigatures: true,
        lineHeight: 1.6,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        padding: { top: 16, bottom: 16 },
        lineNumbers: "on",
        glyphMargin: false,
        folding: true,
        renderLineHighlight: "gutter",
        bracketPairColorization: { enabled: true },
        wordWrap: wordWrap ? "on" : "off",
        tabSize: 2,
        insertSpaces: true,
        automaticLayout: true,
      }}
    />
  );
});
