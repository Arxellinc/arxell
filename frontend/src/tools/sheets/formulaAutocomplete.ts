export interface FormulaFunctionItem {
  name: string;
  signature: string;
  description: string;
}

export const SUPPORTED_FORMULA_FUNCTIONS: FormulaFunctionItem[] = [
  { name: "ABS", signature: "ABS(value)", description: "Absolute value" },
  { name: "AI", signature: "AI(prompt, [range])", description: "Generate text with the selected AI model" },
  { name: "AND", signature: "AND(logical1, logical2, ...)", description: "True if all arguments are true" },
  { name: "AVERAGE", signature: "AVERAGE(value1, value2, ...)", description: "Average of numeric values" },
  { name: "AVERAGEIF", signature: "AVERAGEIF(range, criterion, [average_range])", description: "Average values matching a criterion" },
  { name: "CONCAT", signature: "CONCAT(value1, value2, ...)", description: "Join text values together" },
  { name: "COUNT", signature: "COUNT(value1, value2, ...)", description: "Count numeric values" },
  { name: "COUNTIF", signature: "COUNTIF(range, criterion)", description: "Count values matching a criterion" },
  { name: "DATE", signature: "DATE(year, month, day)", description: "Create a date serial value" },
  { name: "DAY", signature: "DAY(date)", description: "Day from a date" },
  { name: "FIND", signature: "FIND(search_for, text_to_search, [starting_at])", description: "Find text position" },
  { name: "HOUR", signature: "HOUR(time)", description: "Hour from a date or time" },
  { name: "IF", signature: "IF(condition, value_if_true, value_if_false)", description: "Conditional branch" },
  { name: "IFERROR", signature: "IFERROR(value, [value_if_error])", description: "Fallback when a formula errors" },
  { name: "INT", signature: "INT(value)", description: "Round down to integer" },
  { name: "ISBLANK", signature: "ISBLANK(value)", description: "True if value is blank" },
  { name: "ISERROR", signature: "ISERROR(value)", description: "True if expression errors" },
  { name: "ISNUMBER", signature: "ISNUMBER(value)", description: "True if value is numeric" },
  { name: "ISTEXT", signature: "ISTEXT(value)", description: "True if value is text" },
  { name: "LEFT", signature: "LEFT(text, [number_of_characters])", description: "Characters from the left" },
  { name: "LEN", signature: "LEN(text)", description: "Text length" },
  { name: "LOWER", signature: "LOWER(text)", description: "Lowercase text" },
  { name: "MAX", signature: "MAX(value1, value2, ...)", description: "Largest numeric value" },
  { name: "MEDIAN", signature: "MEDIAN(value1, value2, ...)", description: "Median numeric value" },
  { name: "MID", signature: "MID(text, starting_at, extract_length)", description: "Characters from the middle" },
  { name: "MIN", signature: "MIN(value1, value2, ...)", description: "Smallest numeric value" },
  { name: "MINUTE", signature: "MINUTE(time)", description: "Minute from a date or time" },
  { name: "MOD", signature: "MOD(dividend, divisor)", description: "Remainder after division" },
  { name: "MONTH", signature: "MONTH(date)", description: "Month from a date" },
  { name: "NOT", signature: "NOT(value)", description: "Logical negation" },
  { name: "NOW", signature: "NOW()", description: "Current date and time" },
  { name: "OR", signature: "OR(logical1, logical2, ...)", description: "True if any argument is true" },
  { name: "POWER", signature: "POWER(base, exponent)", description: "Raise to a power" },
  { name: "PROPER", signature: "PROPER(text)", description: "Title-case text" },
  { name: "REPLACE", signature: "REPLACE(text, position, length, new_text)", description: "Replace text by position" },
  { name: "RIGHT", signature: "RIGHT(text, [number_of_characters])", description: "Characters from the right" },
  { name: "ROUND", signature: "ROUND(value, [places])", description: "Round to nearest" },
  { name: "ROUNDDOWN", signature: "ROUNDDOWN(value, [places])", description: "Round toward zero" },
  { name: "ROUNDUP", signature: "ROUNDUP(value, [places])", description: "Round away from zero" },
  { name: "SECOND", signature: "SECOND(time)", description: "Second from a date or time" },
  { name: "SQRT", signature: "SQRT(value)", description: "Square root" },
  { name: "SUBSTITUTE", signature: "SUBSTITUTE(text, search_for, replace_with, [occurrence])", description: "Replace matching text" },
  { name: "SUM", signature: "SUM(value1, value2, ...)", description: "Sum numeric values" },
  { name: "SUMIF", signature: "SUMIF(range, criterion, [sum_range])", description: "Sum values matching a criterion" },
  { name: "TEXT", signature: "TEXT(value, format)", description: "Format a value as text" },
  { name: "TODAY", signature: "TODAY()", description: "Current date" },
  { name: "TRIM", signature: "TRIM(text)", description: "Trim repeated whitespace" },
  { name: "UPPER", signature: "UPPER(text)", description: "Uppercase text" },
  { name: "VALUE", signature: "VALUE(text)", description: "Parse text into a number" },
  { name: "YEAR", signature: "YEAR(date)", description: "Year from a date" }
];

export interface FormulaAutocompleteBinding {
  destroy: () => void;
  refresh: () => void;
  close: () => void;
}

export function attachFormulaAutocomplete(
  input: HTMLInputElement,
  onExternalInput?: () => void
): FormulaAutocompleteBinding {
  const popup = document.createElement("div");
  popup.style.cssText = [
    "position:fixed",
    "display:none",
    "min-width:240px",
    "max-width:360px",
    "max-height:220px",
    "overflow:auto",
    "z-index:1000",
    "border:1px solid var(--line)",
    "border-radius:6px",
    "background:var(--panel)",
    "box-shadow:0 8px 20px rgba(0,0,0,0.18)",
    "padding:4px"
  ].join(";");
  document.body.appendChild(popup);

  let matches: FormulaFunctionItem[] = [];
  let activeIndex = 0;

  const close = (): void => {
    popup.style.display = "none";
    matches = [];
    activeIndex = 0;
  };

  const refresh = (): void => {
    const caret = input.selectionStart ?? input.value.length;
    const match = currentFormulaPrefix(input.value, caret);
    if (!match) {
      close();
      return;
    }
    matches = SUPPORTED_FORMULA_FUNCTIONS.filter((item) => item.name.startsWith(match.prefix.toUpperCase()));
    if (!matches.length) {
      close();
      return;
    }
    activeIndex = Math.min(activeIndex, matches.length - 1);
    renderPopup(match);
  };

  const applySelection = (item: FormulaFunctionItem): void => {
    const caret = input.selectionStart ?? input.value.length;
    const match = currentFormulaPrefix(input.value, caret);
    if (!match) return;
    const inserted = `${item.name}()`;
    input.value = `${input.value.slice(0, match.start)}${inserted}${input.value.slice(caret)}`;
    const nextCaret = match.start + item.name.length + 1;
    input.setSelectionRange(nextCaret, nextCaret);
    onExternalInput?.();
    refresh();
    close();
    input.focus();
  };

  const renderPopup = (match: { start: number; prefix: string }): void => {
    popup.replaceChildren(
      ...matches.map((item, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.style.cssText = [
          "display:grid",
          "width:100%",
          "gap:2px",
          "padding:6px 8px",
          "border:none",
          "border-radius:4px",
          "text-align:left",
          "background:" + (index === activeIndex ? "var(--active-bg)" : "transparent"),
          "color:var(--ink)",
          "cursor:pointer"
        ].join(";");
        const title = document.createElement("span");
        title.style.cssText = "font-size:var(--text-sm);font-weight:600;";
        title.textContent = item.name;
        const signature = document.createElement("span");
        signature.style.cssText = "font-size:var(--text-xs);color:var(--muted);";
        signature.textContent = item.signature;
        option.append(title, signature);
        option.addEventListener("mousedown", (event) => {
          event.preventDefault();
          activeIndex = index;
          applySelection(item);
        });
        return option;
      })
    );
    const rect = input.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 4}px`;
    popup.style.display = "block";
  };

  const onInput = (): void => refresh();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (popup.style.display === "none") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % matches.length;
      refresh();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + matches.length) % matches.length;
      refresh();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const item = matches[activeIndex];
      if (item) applySelection(item);
      return;
    }
    if (event.key === "Escape") {
      close();
    }
  };
  const onBlur = (): void => {
    window.setTimeout(close, 120);
  };

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", onBlur);

  return {
    destroy: () => {
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("blur", onBlur);
      popup.remove();
    },
    refresh,
    close
  };
}

function currentFormulaPrefix(value: string, caret: number): { start: number; prefix: string } | null {
  if (!value.startsWith("=") || caret < 1) return null;
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(?:^|[=,(+\-*/<>\s])([A-Za-z][A-Za-z0-9]*)$/);
  if (!match) return null;
  const prefix = match[1] ?? "";
  if (!prefix) return null;
  return { start: caret - prefix.length, prefix };
}
