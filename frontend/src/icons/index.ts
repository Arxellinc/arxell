import bot from "./bot.svg?raw";
import brain from "./brain.svg?raw";
import circleCheckBig from "./circle-check-big.svg?raw";
import chevronLeft from "./chevron-left.svg?raw";
import columns2 from "./columns-2.svg?raw";
import edit from "./edit.svg?raw";
import fileBadge from "./file-badge.svg?raw";
import fileBraces from "./file-braces.svg?raw";
import fileCode from "./file-code.svg?raw";
import fileArchive from "./file-archive.svg?raw";
import fileImage from "./file-image.svg?raw";
import fileKey from "./file-key.svg?raw";
import fileSpreadsheet from "./file-spreadsheet.svg?raw";
import fileTerminal from "./file-terminal.svg?raw";
import fileText from "./file-text.svg?raw";
import fileType from "./file-type.svg?raw";
import folder from "./folder.svg?raw";
import gitCompareArrows from "./git-compare-arrows.svg?raw";
import globe from "./globe.svg?raw";
import history from "./history.svg?raw";
import image from "./image.svg?raw";
import layoutPanelLeft from "./layout-panel-left.svg?raw";
import list from "./list.svg?raw";
import menu from "./menu.svg?raw";
import messageSquare from "./message-square.svg?raw";
import messagesSquare from "./messages-square.svg?raw";
import mic from "./mic.svg?raw";
import minus from "./minus.svg?raw";
import monitor from "./monitor.svg?raw";
import moon from "./moon.svg?raw";
import newIcon from "./new.svg?raw";
import network from "./network.svg?raw";
import octagonPause from "./octagon-pause.svg?raw";
import packageSearch from "./package-search.svg?raw";
import play from "./play.svg?raw";
import plug from "./plug.svg?raw";
import plus from "./plus.svg?raw";
import proportions from "./proportions.svg?raw";
import settings from "./settings.svg?raw";
import slidersHorizontal from "./sliders-horizontal.svg?raw";
import squareCheckBig from "./square-check-big.svg?raw";
import squareTerminal from "./square-terminal.svg?raw";
import sun from "./sun.svg?raw";
import trash2 from "./trash-2.svg?raw";
import triangleAlert from "./triangle-alert.svg?raw";
import volume2 from "./volume-2.svg?raw";
import speech from "./speech.svg?raw";
import square from "./square.svg?raw";
import wrench from "./wrench.svg?raw";
import cpu from "./cpu.svg?raw";
import audioLines from "./audio-lines.svg?raw";
import search from "./search.svg?raw";
import databaseZap from "./database-zap.svg?raw";
import table2 from "./table-2.svg?raw";
import save from "./save.svg?raw";
import saveAll from "./save-all.svg?raw";
import fileOutput from "./file-output.svg?raw";
import folderOpen from "./folder-open.svg?raw";
import copy from "./copy.svg?raw";
import copyPlus from "./copy-plus.svg?raw";
import filePlus from "./file-plus.svg?raw";
import files from "./files.svg?raw";
import x from "./x.svg?raw";
import replace from "./replace.svg?raw";
import botMessageSquare from "./bot-message-square.svg?raw";
import refreshCw from "./refresh-cw.svg?raw";
import info from "./info.svg?raw";
import code from "./code.svg?raw";
import eye from "./eye.svg?raw";
import squareCheck from "./square-check.svg?raw";
import squareDashed from "./square-dashed.svg?raw";
import ellipsisVertical from "./ellipsis-vertical.svg?raw";
import separatorHorizontal from "./separator-horizontal.svg?raw";
import separatorVertical from "./separator-vertical.svg?raw";
import panelRightClose from "./panel-right-close.svg?raw";
import panelLeftOpen from "./panel-left-open.svg?raw";
import circleQuestionMark from "./circle-question-mark.svg?raw";
import database from "./database.svg?raw";
import bookOpenText from "./book-open-text.svg?raw";
import undo from "./undo.svg?raw";
import redo from "./redo.svg?raw";
import dollarSign from "./dollar-sign.svg?raw";
import percent from "./percent.svg?raw";
import hash from "./hash.svg?raw";
import calendar from "./calendar.svg?raw";
import calendarClock from "./calendar-clock.svg?raw";
import bold from "./bold.svg?raw";
import italic from "./italic.svg?raw";
import strikethrough from "./strikethrough.svg?raw";
import listFilterPlus from "./list-filter-plus.svg?raw";
import panelTop from "./panel-top.svg?raw";
import link from "./link.svg?raw";

const ICON_SVGS = {
  bot,
  brain,
  "circle-check-big": circleCheckBig,
  "chevron-left": chevronLeft,
  "columns-2": columns2,
  edit,
  "book-open-text": bookOpenText,
  "file-badge": fileBadge,
  "file-braces": fileBraces,
  "file-code": fileCode,
  "file-archive": fileArchive,
  "file-image": fileImage,
  "file-key": fileKey,
  "file-spreadsheet": fileSpreadsheet,
  "file-terminal": fileTerminal,
  "file-text": fileText,
  "file-type": fileType,
  database,
  folder,
  "git-compare-arrows": gitCompareArrows,
  globe,
  history,
  image,
  "layout-panel-left": layoutPanelLeft,
  list,
  menu,
  "message-square": messageSquare,
  "messages-square": messagesSquare,
  mic,
  minus,
  monitor,
  moon,
  new: newIcon,
  network,
  "octagon-pause": octagonPause,
  "package-search": packageSearch,
  play,
  plug,
  plus,
  proportions,
  settings,
  "sliders-horizontal": slidersHorizontal,
  "square-check-big": squareCheckBig,
  "square-terminal": squareTerminal,
  sun,
  search,
  save,
  "save-all": saveAll,
  "file-output": fileOutput,
  "folder-open": folderOpen,
  copy,
  "copy-plus": copyPlus,
  "file-plus": filePlus,
  files,
  x,
  replace,
  "trash-2": trash2,
  "triangle-alert": triangleAlert,
  "volume-2": volume2,
  speech,
  square,
  cpu,
  wrench,
  audioLines,
  "database-zap": databaseZap,
  "table-2": table2,
  "bot-message-square": botMessageSquare,
  "refresh-cw": refreshCw,
  info,
  code,
  eye,
  "square-check": squareCheck,
  "square-dashed": squareDashed,
  "ellipsis-vertical": ellipsisVertical,
  "separator-horizontal": separatorHorizontal,
  "separator-vertical": separatorVertical,
  "panel-right-close": panelRightClose,
  "panel-left-open": panelLeftOpen,
  "circle-question-mark": circleQuestionMark,
  undo,
  redo,
  "dollar-sign": dollarSign,
  percent,
  hash,
  calendar,
  "calendar-clock": calendarClock,
  bold,
  italic,
  strikethrough,
  "list-filter-plus": listFilterPlus,
  "panel-top": panelTop,
  link
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
  const raw = ICON_SVGS[name] ?? ICON_SVGS.wrench;

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
