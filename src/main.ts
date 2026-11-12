import bindings from "../catalog/bindings.tsv?raw";
import palette from "../catalog/palette.tsv?raw";
import extraFields from "../catalog/fields.tsv?raw";
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

const catalogBindings = bindings.trimEnd().split("\n").slice(1).map((row) => {
  const [key, component, state, property, description, source, implementation] = row.split("\t");
  return { key, component, state, property, description, source, implementation };
});
const unreadDotKeys = new Map(catalogBindings
  .filter(({ component }) => component === "unread-dot")
  .map(({ state, key }) => [state, key]));

function sourceUrl(source: string): string {
  const [path, line] = source.split(":");
  const libPrefix = "Telegram/lib_ui/";
  if (path.startsWith(libPrefix)) {
    return `https://github.com/desktop-app/lib_ui/blob/42c6f1e88db81e6d9e8006f3e7b1c3ba39f9cac4/${path.slice(libPrefix.length)}#L${line}`;
  }
  return `https://github.com/telegramdesktop/tdesktop/blob/157f5cfc85e2dd1fa67f129a5e31a81db5ddeb19/${path}#L${line}`;
}

const state = getElement<HTMLSelectElement>("state");
const chatRow = getElement("chat-row");
const colorKey = getElement("color-key");
const colorValue = getElement("color-value");
const swatch = getElement("swatch");
const unreadDot = getElement("unread-dot");

const badgeState = getElement<HTMLSelectElement>("badge-state");
for (const option of state.options) {
  badgeState.add(new Option(option.text, option.value));
}
const examples = [...document.querySelectorAll<HTMLElement>(".component-example")].map((card) => ({
  card,
  properties: card.querySelector<HTMLDListElement>(".binding-properties")!,
  bindings: catalogBindings.filter(({ component }) => component === card.dataset.component),
}));

function updateExamples(colors: Palette) {
  for (const example of examples) {
    const selected = example.card.dataset.component === "unread-badge" ? badgeState.value : "normal";
    example.properties.replaceChildren();
    for (const binding of example.bindings.filter(({ state }) => state === selected)) {
      const color = colors.color(binding.key);
      example.card.style.setProperty(`--example-${binding.property}`, color);
      const label = document.createElement("dt");
      label.textContent = binding.description;
      const value = document.createElement("dd");
      const swatch = document.createElement("span");
      swatch.className = "binding-swatch";
      swatch.style.backgroundColor = color;
      swatch.setAttribute("aria-hidden", "true");
      const link = document.createElement("a");
      link.href = sourceUrl(binding.source);
      link.textContent = binding.key;
      link.target = "_blank";
      link.rel = "noopener";
      value.append(swatch, link, document.createTextNode(color));
      example.properties.append(label, value);
    }
  }
}

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
  updateExamples(colors);
}

state.addEventListener("change", updatePreview);
badgeState.addEventListener("change", updatePreview);
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


const paletteCatalog = getElement<HTMLDetailsElement>("palette-catalog");
paletteCatalog.addEventListener("toggle", () => {
  const list = getElement("catalog-keys");
  if (!paletteCatalog.open || list.childElementCount) {
    return;
  }
  for (const key of defaults.keys()) {
    const term = document.createElement("dt");
    term.textContent = key;
    const description = document.createElement("dd");
    const matches = catalogBindings.filter((binding) => binding.key === key);
    if (!matches.length) {
      description.textContent = "Привязка пока не подтверждена";
    }
    for (const binding of matches) {
      const line = document.createElement("div");
      const link = document.createElement("a");
      link.href = sourceUrl(binding.source);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = binding.description;
      const status = binding.implementation === "-" ? ", пример пока не добавлен" : "";
      line.append(link, document.createTextNode(` (${binding.component}, ${binding.state})${status}`));
      description.append(line);
    }
    list.append(term, description);
  }
  for (const row of extraFields.trimEnd().split("\n").slice(1)) {
    const [key, , description] = row.split("\t");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = key;
    detail.textContent = description;
    list.append(term, detail);
  }
});
