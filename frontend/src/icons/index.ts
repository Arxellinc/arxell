import bot from "./bot.svg?raw";
import brain from "./brain.svg?raw";
import chevronLeft from "./chevron-left.svg?raw";
import columns2 from "./columns-2.svg?raw";
import folder from "./folder.svg?raw";
import history from "./history.svg?raw";
import layoutPanelLeft from "./layout-panel-left.svg?raw";
import list from "./list.svg?raw";
import menu from "./menu.svg?raw";
import messageSquare from "./message-square.svg?raw";
import messagesSquare from "./messages-square.svg?raw";
import mic from "./mic.svg?raw";
import monitor from "./monitor.svg?raw";
import moon from "./moon.svg?raw";
import packageSearch from "./package-search.svg?raw";
import play from "./play.svg?raw";
import plus from "./plus.svg?raw";
import proportions from "./proportions.svg?raw";
import settings from "./settings.svg?raw";
import slidersHorizontal from "./sliders-horizontal.svg?raw";
import squareTerminal from "./square-terminal.svg?raw";
import sun from "./sun.svg?raw";
import trash2 from "./trash-2.svg?raw";
import volume2 from "./volume-2.svg?raw";
import wrench from "./wrench.svg?raw";
import cpu from "./cpu.svg?raw";
import audioLines from "./audio-lines.svg?raw";

const ICON_SVGS = {
  bot,
  brain,
  "chevron-left": chevronLeft,
  "columns-2": columns2,
  folder,
  history,
  "layout-panel-left": layoutPanelLeft,
  list,
  menu,
  "message-square": messageSquare,
  "messages-square": messagesSquare,
  mic,
  monitor,
  moon,
  "package-search": packageSearch,
  play,
  plus,
  proportions,
  settings,
  "sliders-horizontal": slidersHorizontal,
  "square-terminal": squareTerminal,
  sun,
  "trash-2": trash2,
  "volume-2": volume2,
  cpu,
  wrench,
  audioLines
} as const;

export type IconName = keyof typeof ICON_SVGS;
export type IconSize = 16 | 24;
export type IconTone = "light" | "dark";

export function iconHtml(
  name: IconName,
  opts?: {
    size?: IconSize;
    tone?: IconTone;
    label?: string;
    className?: string;
  }
): string {
  const size = opts?.size ?? 16;
  const tone = opts?.tone ?? "dark";
  const label = opts?.label ?? "";
  const extra = opts?.className ? ` ${opts.className}` : "";
  const raw = ICON_SVGS[name];

  return `<span class="icon icon-${size} icon-${tone}${extra}" aria-hidden="${label ? "false" : "true"}" ${label ? `aria-label="${escapeHtml(label)}"` : ""}>${raw}</span>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
