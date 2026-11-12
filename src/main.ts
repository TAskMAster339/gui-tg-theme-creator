import bindings from "../catalog/bindings.tsv?raw";
import palette from "../catalog/palette.tsv?raw";
import coverage from "../catalog/coverage.tsv?raw";
import extraFields from "../catalog/fields.tsv?raw";
import { Palette, readDefaults } from "./palette.ts";
import { exportTheme, readTheme, type ImportedTheme } from "./theme.ts";
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
let currentPalette = basePalette;

const catalogBindings = bindings.trimEnd().split("\n").slice(1).map((row) => {
  const [key, component, state, property, description, source, implementation] = row.split("\t");
  return { key, component, state, property, description, source, implementation };
});
const paletteComments = new Map(coverage.trimEnd().split("\n").slice(1).map((row) => {
  const [key, , comment] = row.split("\t");
  return [key, comment];
}));

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
const badgeState = getElement<HTMLSelectElement>("badge-state");
for (const option of state.options) {
  badgeState.add(new Option(option.text, option.value));
}

interface ColorControl {
  key: string;
  label: HTMLElement;
  value: HTMLElement;
  picker: HTMLInputElement;
  hex: HTMLInputElement;
}

const examples = [...document.querySelectorAll<HTMLElement>(".component-example")].map((card) => ({
  card,
  properties: card.querySelector<HTMLDListElement>(".binding-properties")!,
  targets: [...card.querySelectorAll<HTMLElement>("[data-property]")],
  state: card.querySelector("select"),
  bindings: catalogBindings.filter(({ component }) => component === card.dataset.component),
  controls: new Map<string, ColorControl>(),
}));

function updatePreview() {
  const suffix = state.value.endsWith("active") ? "Active" : state.value.endsWith("hover") ? "Over" : "";
  chatRow.style.backgroundColor = currentPalette.color(`dialogsBg${suffix}`);
  chatRow.style.color = currentPalette.color(`dialogsNameFg${suffix}`);
  chatRow.style.setProperty("--message-color", currentPalette.color(`dialogsTextFg${suffix}`));
  chatRow.style.setProperty("--time-color", currentPalette.color(`dialogsDateFg${suffix}`));
  for (const example of examples) {
    for (const [property, control] of example.controls) {
      const color = currentPalette.color(control.key);
      example.card.style.setProperty(`--example-${property}`, color);
      control.picker.value = color.slice(0, 7);
      control.hex.value = color;
      control.hex.setCustomValidity("");
    }
  }
}

function applyColor(key: string, value: string) {
  if (currentPalette.color(key) === value.toUpperCase()) {
    return;
  }
  currentPalette = currentPalette.withColor(key, value);
  getElement<HTMLButtonElement>("reset-theme").disabled = false;
  updatePreview();
  updateCatalogEditor();
}

function createColorInputs(key: string, label: string) {
  const picker = document.createElement("input");
  picker.type = "color";
  picker.setAttribute("aria-label", `Палитра — ${label}`);
  const hex = document.createElement("input");
  hex.type = "text";
  hex.className = "hex-input";
  hex.maxLength = 9;
  hex.spellcheck = false;
  hex.setAttribute("aria-label", `HEX — ${label}`);
  picker.addEventListener("input", () => {
    const alpha = currentPalette.color(key).slice(7);
    applyColor(key, picker.value + alpha);
  });
  const commitHex = () => {
    try {
      applyColor(key, hex.value.trim());
    } catch (error) {
      hex.setCustomValidity(error instanceof Error ? error.message : "Некорректный цвет.");
      hex.reportValidity();
    }
  };
  hex.addEventListener("input", () => hex.setCustomValidity(""));
  hex.addEventListener("change", commitHex);
  hex.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      commitHex();
    }
  });
  return { picker, hex };
}

function renderControls(example: typeof examples[number]) {
  example.controls.clear();
  example.properties.replaceChildren();
  const selected = example.state?.value ?? "normal";
  for (const binding of example.bindings.filter(({ state }) => state === selected)) {
    const label = document.createElement("dt");
    label.textContent = binding.description;
    const value = document.createElement("dd");
    const link = document.createElement("a");
    link.href = sourceUrl(binding.source);
    link.textContent = binding.key;
    link.target = "_blank";
    link.rel = "noopener";
    const { picker, hex } = createColorInputs(binding.key, binding.description);
    value.append(link, picker, hex);
    example.properties.append(label, value);
    example.controls.set(binding.property, { key: binding.key, label, value, picker, hex });
  }
  for (const target of example.targets) {
    const control = example.controls.get(target.dataset.property ?? "");
    if (control) {
      target.setAttribute("aria-label", control.label.textContent ?? "");
    }
  }
}

for (const example of examples) {
  renderControls(example);
  example.state?.addEventListener("change", () => {
    renderControls(example);
    updatePreview();
  });
  for (const target of example.targets) {
    target.tabIndex = 0;
    target.setAttribute("role", "button");
    const selectProperty = (event: Event) => {
      const control = example.controls.get(target.dataset.property ?? "");
      if (!control) {
        return;
      }
      event.stopPropagation();
      for (const item of example.controls.values()) {
        item.value.classList.toggle("selected-property", item === control);
      }
      control.hex.focus();
      control.hex.select();
    };
    target.addEventListener("click", selectProperty);
    target.addEventListener("keydown", (event) => {
      if (event.target === target && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        selectProperty(event);
      }
    });
  }
}
updatePreview();

const fileInput = getElement<HTMLInputElement>("theme-file");
const resetTheme = getElement<HTMLButtonElement>("reset-theme");
const exportButton = getElement<HTMLButtonElement>("export-theme");
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
  exportButton.disabled = true;
  resetTheme.disabled = true;
  themeStatus.textContent = "Читаем файл темы…";
  try {
    activeTheme = await readTheme(file, defaults);
    currentPalette = activeTheme.palette;
    updatePreview();
    updateCatalogEditor();
    showThemeFields();
    themeStatus.textContent = `Открыта тема «${file.name}».`;
  } catch (error) {
    themeStatus.textContent = error instanceof Error ? error.message : "Не удалось открыть тему.";
  } finally {
    fileInput.value = "";
    fileInput.disabled = false;
    exportButton.disabled = false;
    resetTheme.disabled = currentPalette === basePalette;
  }
});

exportButton.addEventListener("click", async () => {
  const invalidColor = document.querySelector<HTMLInputElement>(".hex-input:invalid");
  if (invalidColor) {
    invalidColor.reportValidity();
    return;
  }
  exportButton.disabled = true;
  fileInput.disabled = true;
  const imported = activeTheme;
  try {
    const file = await exportTheme(currentPalette, imported);
    const originalName = imported?.source instanceof File ? imported.source.name : "telegram";
    const name = originalName.replace(/\.(tdesktop-theme|tdesktop-palette|zip|txt)$/i, "");
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}-edited.tdesktop-theme`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    themeStatus.textContent = `Подготовлен файл «${link.download}».`;
  } catch (error) {
    themeStatus.textContent = error instanceof Error ? error.message : "Не удалось сохранить тему.";
  } finally {
    fileInput.disabled = false;
    exportButton.disabled = false;
  }
});

resetTheme.addEventListener("click", () => {
  activeTheme = undefined;
  currentPalette = basePalette;
  resetTheme.disabled = true;
  themeStatus.textContent = "Используется базовая палитра Telegram Desktop.";
  updatePreview();
  showThemeFields();
  updateCatalogEditor();
});


const paletteCatalog = getElement<HTMLDetailsElement>("palette-catalog");
const catalogEditor = getElement("catalog-editor");
const catalogColor = getElement("catalog-color");
const catalogRestore = getElement<HTMLButtonElement>("catalog-restore");
let catalogSelection: (ReturnType<typeof createColorInputs> & { key: string }) | undefined;

function purpose(key: string): string {
  const comment = paletteComments.get(key);
  return catalogBindings.find((binding) => binding.key === key)?.description
    ?? (comment === "-" ? "" : comment ?? "");
}

function updateCatalogEditor() {
  if (!catalogSelection) {
    return;
  }
  const { key, picker, hex } = catalogSelection;
  const original = activeTheme?.palette ?? basePalette;
  const color = currentPalette.color(key);
  getElement("catalog-original").textContent = original.declaration(key) ?? "";
  getElement("catalog-current").textContent = currentPalette.declaration(key) ?? "";
  getElement("catalog-resolved").textContent = color;
  picker.value = color.slice(0, 7);
  hex.value = color;
  hex.setCustomValidity("");
  catalogRestore.disabled = original.fields.get(key) === currentPalette.fields.get(key);
}

function selectCatalogKey(key: string) {
  catalogSelection = { key, ...createColorInputs(key, key) };
  getElement("catalog-key").textContent = key;
  getElement("catalog-purpose").textContent = purpose(key) || "Назначение ещё проверяется.";
  catalogColor.replaceChildren(catalogSelection.picker, catalogSelection.hex);
  catalogEditor.hidden = false;
  updateCatalogEditor();
  catalogSelection.hex.focus();
  catalogSelection.hex.select();
}

catalogRestore.addEventListener("click", () => {
  if (catalogSelection) {
    currentPalette = currentPalette.restoreColor(catalogSelection.key, activeTheme?.palette ?? basePalette);
    updatePreview();
    updateCatalogEditor();
    catalogSelection.hex.focus();
  }
});

paletteCatalog.addEventListener("toggle", () => {
  const list = getElement("catalog-keys");
  if (!paletteCatalog.open || list.childElementCount) {
    return;
  }
  for (const key of defaults.keys()) {
    const term = document.createElement("dt");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "catalog-key-button";
    button.textContent = key;
    button.addEventListener("click", () => selectCatalogKey(key));
    term.append(button);
    const description = document.createElement("dd");
    const matches = catalogBindings.filter((binding) => binding.key === key);
    if (!matches.length) {
      description.textContent = purpose(key) || "Привязка пока не подтверждена";
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
  filterSearch();
});

const search = getElement<HTMLInputElement>("component-search");

function filterSearch() {
  const query = search.value.trim().toLocaleLowerCase();
  let visible = 0;
  for (const example of examples) {
    const title = example.card.querySelector(".component-header")?.textContent ?? "";
    const matches = example.bindings.some(({ key, description }) =>
      key.toLocaleLowerCase().includes(query) || description.toLocaleLowerCase().includes(query));
    example.card.hidden = !title.toLocaleLowerCase().includes(query) && !matches;
    if (!example.card.hidden) {
      visible++;
    }
  }
  getElement("no-components").hidden = visible !== 0;
  let catalogMatches = 0;
  for (const term of document.querySelectorAll<HTMLElement>("#catalog-keys dt")) {
    const detail = term.nextElementSibling as HTMLElement;
    const text = `${term.textContent} ${detail.textContent}`.toLocaleLowerCase();
    term.hidden = detail.hidden = !text.includes(query);
    catalogMatches += Number(!term.hidden);
  }
  getElement("no-catalog-keys").hidden = catalogMatches > 0;
}

search.addEventListener("input", () => {
  if (search.value.trim()) {
    paletteCatalog.open = true;
  }
  filterSearch();
});
