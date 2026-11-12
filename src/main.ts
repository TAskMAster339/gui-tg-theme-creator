import bindings from "../catalog/bindings.tsv?raw";
import palette from "../catalog/palette.tsv?raw";
import { Palette, readDefaults } from "./palette.ts";
import { readTheme, type ImportedTheme } from "./theme.ts";
import "./style.css";

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

const defaults = readDefaults(palette);
const basePalette = new Palette(defaults);
let activeTheme: ImportedTheme | undefined;

const unreadDotKeys = new Map(
  bindings.trimEnd().split("\n").slice(1)
    .map((row) => row.split("\t"))
    .filter(([, component, , property]) => component === "unread-dot" && property === "background")
    .map(([key, , state]) => [state, key]),
);

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
  const colors = activeTheme?.palette ?? basePalette;
  const color = colors.color(key);
  const suffix = state.value.endsWith("active") ? "Active" : state.value.endsWith("hover") ? "Over" : "";
  chatRow.style.backgroundColor = colors.color(`dialogsBg${suffix}`);
  chatRow.style.color = colors.color(`dialogsNameFg${suffix}`);
  chatRow.style.setProperty("--message-color", colors.color(`dialogsTextFg${suffix}`));
  chatRow.style.setProperty("--time-color", colors.color(`dialogsDateFg${suffix}`));
  colorKey.textContent = key;
  colorValue.textContent = color;
  swatch.style.backgroundColor = color;
  unreadDot.style.backgroundColor = color;
}

state.addEventListener("change", updatePreview);
updatePreview();

const fileInput = getElement<HTMLInputElement>("theme-file");
const resetTheme = getElement<HTMLButtonElement>("reset-theme");
const themeStatus = getElement("theme-status");
const themeDetails = getElement<HTMLDetailsElement>("theme-details");
const themeFields = getElement("theme-fields");

function showThemeFields() {
  themeFields.replaceChildren();
  const extras = new Map(
    [...(activeTheme?.palette.fields ?? [])].filter(([key]) => !defaults.has(key)),
  );
  if (activeTheme?.wallpaper) {
    extras.set("Файл обоев", activeTheme.wallpaper.name);
  }
  for (const [key, value] of extras) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = key;
    description.textContent = value;
    themeFields.append(term, description);
  }
  themeDetails.hidden = !extras.size;
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }
  fileInput.disabled = true;
  resetTheme.disabled = true;
  themeStatus.textContent = "Читаем файл темы…";
  try {
    activeTheme = await readTheme(file, defaults);
    updatePreview();
    showThemeFields();
    themeStatus.textContent = `Открыта тема «${file.name}».`;
  } catch (error) {
    themeStatus.textContent = error instanceof Error ? error.message : "Не удалось открыть тему.";
  } finally {
    fileInput.value = "";
    fileInput.disabled = false;
    resetTheme.disabled = !activeTheme;
  }
});

resetTheme.addEventListener("click", () => {
  activeTheme = undefined;
  resetTheme.disabled = true;
  themeStatus.textContent = "Используется базовая палитра Telegram Desktop.";
  updatePreview();
  showThemeFields();
});
