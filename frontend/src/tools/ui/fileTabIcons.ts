import type { IconName } from "../../icons";

const SPREADSHEET_EXTENSIONS = new Set(["csv", "tsv", "xlsx", "xls", "ods"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "rst"]);
const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "go",
  "java",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hpp",
  "cs",
  "php",
  "rb",
  "swift",
  "kt",
  "kts",
  "scala",
  "lua",
  "r",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "xml"
]);
const STRUCTURED_DATA_EXTENSIONS = new Set(["json", "yaml", "yml", "toml", "ini"]);
const TERMINAL_EXTENSIONS = new Set(["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"]);
const DATABASE_EXTENSIONS = new Set(["sql", "db", "sqlite", "sqlite3"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tif", "tiff"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"]);
const KEY_EXTENSIONS = new Set(["pem", "key", "crt", "csr", "pub"]);
const TEXT_EXTENSIONS = new Set(["txt", "log", "text"]);

export function resolveFileTabIcon(pathOrName: string | null | undefined, fallback: IconName = "file-type"): IconName {
  const extension = getFileExtension(pathOrName);
  if (!extension) return fallback;
  if (SPREADSHEET_EXTENSIONS.has(extension)) return "file-spreadsheet";
  if (MARKDOWN_EXTENSIONS.has(extension)) return "book-open-text";
  if (DATABASE_EXTENSIONS.has(extension)) return "database";
  if (IMAGE_EXTENSIONS.has(extension)) return "file-image";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "file-archive";
  if (KEY_EXTENSIONS.has(extension)) return "file-key";
  if (TERMINAL_EXTENSIONS.has(extension)) return "file-terminal";
  if (STRUCTURED_DATA_EXTENSIONS.has(extension)) return "file-braces";
  if (TEXT_EXTENSIONS.has(extension)) return "file-text";
  if (CODE_EXTENSIONS.has(extension)) return "file-code";
  return fallback;
}

function getFileExtension(pathOrName: string | null | undefined): string | null {
  if (!pathOrName) return null;
  const normalized = pathOrName.replaceAll("\\", "/");
  const fileName = normalized.split("/").pop() ?? normalized;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return null;
  return fileName.slice(dotIndex + 1).toLowerCase();
}
