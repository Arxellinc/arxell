export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  content: string;
  filePath: string;
}

export interface SkillsSettings {
  autoLoad: boolean;
  permissionDefault: "allow" | "deny" | "ask";
  showDescriptions: boolean;
}

export interface SkillsToolViewState {
  skills: SkillInfo[];
  selectedSkillId: string | null;
  contentById: Record<string, string>;
  dirtyById: Record<string, boolean>;
  savedContentById: Record<string, string>;
  loading: boolean;
  error: string | null;
  sidebarWidth: number;
  sidebarCollapsed?: boolean;
  settingsOpen: boolean;
  settings: SkillsSettings;
  newSkillModalOpen: boolean;
  newSkillName: string;
  newSkillDescription: string;
  confirmDeleteId: string | null;
}

export const DEFAULT_SKILLS_SETTINGS: SkillsSettings = {
  autoLoad: true,
  permissionDefault: "allow",
  showDescriptions: true
};

export const SKILLS_SIDEBAR_DEFAULT_WIDTH = 280;
export const SKILLS_SIDEBAR_MIN_WIDTH = 200;
export const SKILLS_SIDEBAR_MAX_WIDTH = 450;

export const SKILLS_FOLDER = "src-tauri/src/skills";
export const SKILL_ENTRY_FILE = "SKILL.md";

export function parseSkillNameFromContent(content: string): { name: string; description: string } {
  const lines = content.split("\n");
  let name = "";
  let description = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      name = trimmed.slice(2).trim();
      break;
    }
  }

  const descMatch = content.match(/\*\*Use for:\*\*\s*(.+)/);
  if (descMatch && descMatch[1]) {
    description = descMatch[1].trim();
  } else {
    const firstParaMatch = content.match(/\n\n(.+?)\n/);
    if (firstParaMatch && firstParaMatch[1]) {
      description = firstParaMatch[1].slice(0, 200).trim();
    }
  }

  return { name, description };
}

export function extractFrontmatter(content: string): { name: string; description: string; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch && fmMatch[1] !== undefined && fmMatch[2] !== undefined) {
    const frontmatter = fmMatch[1];
    const body = fmMatch[2];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    return {
      name: nameMatch && nameMatch[1] ? nameMatch[1].trim() : "",
      description: descMatch && descMatch[1] ? descMatch[1].trim() : "",
      body
    };
  }

  const { name, description } = parseSkillNameFromContent(content);
  return { name, description, body: content };
}

export function buildSkillContent(name: string, description: string, body: string): string {
  const hasFrontmatter = body.startsWith("---");
  if (hasFrontmatter) {
    return body;
  }
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

export function getInitialSkillsState(): SkillsToolViewState {
  return {
    skills: [],
    selectedSkillId: null,
    contentById: {},
    dirtyById: {},
    savedContentById: {},
    loading: false,
    error: null,
    sidebarWidth: SKILLS_SIDEBAR_DEFAULT_WIDTH,
    sidebarCollapsed: false,
    settingsOpen: false,
    settings: { ...DEFAULT_SKILLS_SETTINGS },
    newSkillModalOpen: false,
    newSkillName: "",
    newSkillDescription: "",
    confirmDeleteId: null
  };
}