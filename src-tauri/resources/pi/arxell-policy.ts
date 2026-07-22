import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PATH_TOOLS = new Set(["read", "write", "edit"]);
const PROTECTED_SEGMENTS = new Set([".git", ".pi", ".env", ".ssh"]);
const PROTECTED_NAMES = new Set([
  "credentials",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_ed25519",
  ".npmrc",
  ".pypirc"
]);

const DESTRUCTIVE_BASH_PATTERNS = [
  /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r|--recursive)\b/i,
  /\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f|checkout\s+--\s+\.)/i,
  /\b(?:sudo|su)\b/i,
  /\b(?:chmod|chown)\b/i,
  /\b(?:mkfs|fdisk|parted|shutdown|reboot|poweroff)\b/i,
  /\bdd\s+\b/i,
  /\bkill(?:all)?\s+-9\b/i,
  /\b(?:npm|pnpm|yarn|cargo)\s+publish\b/i,
  /\bcurl\b[^\n|]*\|\s*(?:ba)?sh\b/i,
  /\bwget\b[^\n|]*\|\s*(?:ba)?sh\b/i,
  /(?:^|\s)(?:python\d*|node|ruby|perl)\s+(?:-c|-e)\b/i
];

const PROTECTED_BASH_PATTERNS = [
  /(?:^|[\\/\s"'])\.git(?:[\\/\s"']|$)/i,
  /(?:^|[\\/\s"'])\.env(?:\.[^\\/\s"']+)?(?:[\\/\s"']|$)/i,
  /(?:^|[\\/\s"'])\.ssh(?:[\\/\s"']|$)/i,
  /(?:^|[\\/\s"'])(?:credentials(?:\.json)?|secrets\.json|id_rsa|id_ed25519)(?:[\\/\s"']|$)/i,
  /\.(?:pem|key|p12|pfx)(?:[\s"']|$)/i
];

const BOUNDARY_ESCAPE_PATTERNS = [
  /(?:^|[\s;&|])(?:cd|pushd|popd)\b/i,
  /(?:^|[\s"'])\.\.(?:[\\/]|$)/,
  /(?:^|[\s"'])~(?:[\\/]|$)/,
  /\$(?:\{)?(?:HOME|USERPROFILE|APPDATA|XDG_[A-Z_]+)(?:\})?/i,
  /%(?:USERPROFILE|APPDATA|LOCALAPPDATA)%/i,
  /(?:^|[\s"'=])[A-Za-z]:[\\/]/,
  /(?:^|[\s"'=])\/(?:etc|home|root|Users|private|var|tmp|opt|usr|bin|sbin|dev|proc|sys)(?:[\\/]|\b)/
];

function canonicalRoot(cwd: string): string {
  return fs.realpathSync.native(path.resolve(cwd));
}

function canonicalCandidate(root: string, inputPath: string): string {
  const absolute = path.resolve(root, inputPath);
  let ancestor = absolute;
  const suffix: string[] = [];

  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }

  const canonicalAncestor = fs.realpathSync.native(ancestor);
  return path.resolve(canonicalAncestor, ...suffix);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isProtected(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  const segments = relative.split(path.sep).filter(Boolean);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const name = lowerSegments.at(-1) ?? "";

  if (lowerSegments.some((segment) => PROTECTED_SEGMENTS.has(segment))) return true;
  if (PROTECTED_NAMES.has(name)) return true;
  if (name.startsWith(".env.")) return true;
  return /\.(?:pem|key|p12|pfx)$/i.test(name);
}

function pathInput(input: Record<string, unknown>): string | null {
  const value = input.path ?? input.filePath ?? input.file_path;
  return typeof value === "string" && value.trim() ? value : null;
}

export default function arxellPolicy(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (PATH_TOOLS.has(event.toolName)) {
      const requestedPath = pathInput(event.input as Record<string, unknown>);
      if (!requestedPath) {
        return { block: true, reason: "Arxell policy requires an explicit project-relative path." };
      }

      try {
        const root = canonicalRoot(ctx.cwd);
        const candidate = canonicalCandidate(root, requestedPath);
        if (!isInside(root, candidate)) {
          return { block: true, reason: "Arxell policy blocked access outside the approved project folder." };
        }
        if (isProtected(candidate, root)) {
          return { block: true, reason: "Arxell policy blocked a protected project path." };
        }
      } catch {
        return { block: true, reason: "Arxell policy could not validate the requested path." };
      }
      return undefined;
    }

    if (event.toolName !== "bash") return undefined;
    const command = (event.input as Record<string, unknown>).command;
    if (typeof command !== "string" || !command.trim()) {
      return { block: true, reason: "Arxell policy requires an explicit shell command." };
    }

    if (PROTECTED_BASH_PATTERNS.some((pattern) => pattern.test(command))) {
      return { block: true, reason: "Arxell policy blocked shell access to protected project data." };
    }

    if (BOUNDARY_ESCAPE_PATTERNS.some((pattern) => pattern.test(command))) {
      return { block: true, reason: "Arxell policy blocked a command that may leave the approved project folder." };
    }

    if (!DESTRUCTIVE_BASH_PATTERNS.some((pattern) => pattern.test(command))) {
      return undefined;
    }

    if (!ctx.hasUI) {
      return { block: true, reason: "Arxell policy blocked a destructive command without approval UI." };
    }

    const confirmed = await ctx.ui.confirm(
      "Potentially destructive command",
      "Pi requested a command that can modify or remove significant data. Allow it for this run?"
    );
    if (!confirmed) {
      return { block: true, reason: "Arxell policy denied the destructive command." };
    }
    return undefined;
  });
}
