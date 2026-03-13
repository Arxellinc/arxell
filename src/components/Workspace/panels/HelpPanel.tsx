import { CircleHelp, RefreshCw, FileText } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { PanelWrapper } from "./shared";
import { SplitPaneLayout, SidebarItem, SidebarSearch, SidebarHeader } from "./SplitPaneLayout";

interface HelpDoc {
  name: string;
  path: string;
  content: string;
}

// Import all markdown files from the docs folder at build time
const docsModules = import.meta.glob<{ default: string }>("../../../../docs/*.md", {
  query: "?raw",
  eager: true,
});

function extractFilename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function getDocTitle(name: string): string {
  // Remove extension and format nicely
  const base = name.replace(/\.md$/i, "");
  // Extract number prefix if exists
  const match = base.match(/^(\d+)_(.+)$/);
  if (match) {
    return match[2].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return base.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Process and sort docs
function processDocs(): HelpDoc[] {
  const docs: HelpDoc[] = Object.entries(docsModules).map(([path, module]) => {
    const name = extractFilename(path);
    return {
      name,
      path,
      content: module.default,
    };
  });

  // Sort by filename (which have numeric prefixes)
  docs.sort((a, b) => a.name.localeCompare(b.name));
  return docs;
}

export function HelpPanel() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const allDocs = useMemo(() => processDocs(), []);

  // Filter docs based on search
  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return allDocs;
    const query = searchQuery.toLowerCase();
    return allDocs.filter(
      (doc) =>
        doc.name.toLowerCase().includes(query) ||
        doc.content.toLowerCase().includes(query)
    );
  }, [allDocs, searchQuery]);

  // Get the selected doc content
  const selectedDoc = useMemo(() => {
    if (!selectedPath) return null;
    return allDocs.find((d) => d.path === selectedPath) ?? null;
  }, [allDocs, selectedPath]);

  // Auto-select the first doc (00_index.md) on mount
  useEffect(() => {
    if (allDocs.length > 0 && !selectedPath) {
      setSelectedPath(allDocs[0].path);
    }
  }, [allDocs, selectedPath]);

  // Build JSON data for the collapsible section
  const jsonData = useMemo(() => {
    if (!selectedDoc) return null;
    return {
      selected: {
        name: selectedDoc.name,
        path: selectedDoc.path,
        title: getDocTitle(selectedDoc.name),
        content_length: selectedDoc.content.length,
      },
      all_docs: allDocs.map((d) => ({
        name: d.name,
        title: getDocTitle(d.name),
        path: d.path,
      })),
    };
  }, [selectedDoc, allDocs]);

  // Sidebar content
  const sidebar = (
    <>
      <SidebarSearch
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search docs..."
      />
      <SidebarHeader title="Documentation" count={filteredDocs.length} />
      <div className="flex-1 overflow-y-auto">
        {filteredDocs.map((doc) => (
          <SidebarItem
            key={doc.path}
            id={doc.path}
            title={getDocTitle(doc.name)}
            subtitle={doc.name}
            icon={<FileText size={11} />}
            selected={selectedPath === doc.path}
            onClick={() => setSelectedPath(doc.path)}
          />
        ))}
      </div>
    </>
  );

  // Main content
  const content = selectedDoc ? (
    <div className="p-4 minimal-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {selectedDoc.content}
      </ReactMarkdown>
    </div>
  ) : (
    <div className="p-4 text-xs text-text-dark italic">
      Select a document from the sidebar to view its contents.
    </div>
  );

  return (
    <PanelWrapper
      title="Help"
      icon={<CircleHelp size={16} className="text-accent-primary" />}
      actions={
        <button
          onClick={() => {
            setSelectedPath(allDocs[0]?.path ?? null);
            setSearchQuery("");
          }}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
          title="Reset to index"
        >
          <RefreshCw size={12} />
          Reset
        </button>
      }
      fill
    >
      <SplitPaneLayout
        sidebar={sidebar}
        content={content}
        jsonData={jsonData}
        jsonLabel="Help Data"
        storageKey="arx-help-sidebar-width"
      />
    </PanelWrapper>
  );
}
