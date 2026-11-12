import bindings from "../catalog/bindings.tsv?raw";
import palette from "../catalog/palette.tsv?raw";
import "./style.css";

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

const defaults = new Map(
  palette.trimEnd().split("\n").slice(1).map((row) => {
    const [key, , value] = row.split("\t");
    return [key, value];
  }),
);

const unreadDotKeys = new Map(
  bindings.trimEnd().split("\n").slice(1)
    .map((row) => row.split("\t"))
    .filter(([, component, , property]) => component === "unread-dot" && property === "background")
    .map(([key, , state]) => [state, key]),
);

function resolveDefault(key: string): string {
  const visited = new Set<string>();
  while (!visited.has(key)) {
    visited.add(key);
    const declaration = defaults.get(key);
    if (!declaration) {
      break;
    }
    // The first branch is the stock color. The second is Telegram's fallback.
    const value = declaration.split("|", 1)[0].trim();
    if (value.startsWith("#")) {
      return value.toUpperCase();
    }
    key = value;
  }
  throw new Error(`Unresolved default color: ${key}`);
}

const state = getElement<HTMLSelectElement>("state");
const chatRow = getElement("chat-row");
const colorKey = getElement("color-key");
const colorValue = getElement("color-value");
const swatch = getElement("swatch");
const unreadDot = getElement("unread-dot");

function updatePreview() {
  const key = unreadDotKeys.get(state.value);
  if (!key) {
    throw new Error(`Missing unread-dot binding: ${state.value}`);
  }
  const color = resolveDefault(key);
  chatRow.dataset.state = state.value;
  colorKey.textContent = key;
  colorValue.textContent = color;
  swatch.style.backgroundColor = color;
  unreadDot.style.backgroundColor = color;
}

state.addEventListener("change", updatePreview);
updatePreview();
