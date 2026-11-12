const hexColor = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const identifier = /^[A-Za-z0-9_]+$/;
const cloudFields = new Set(["name", "shortname", "wallpaper"]);

export function readDefaults(catalog: string): ReadonlyMap<string, string> {
  return new Map(catalog.trimEnd().split("\n").slice(1).map((row) => {
    const [key, , declaration] = row.split("\t");
    return [key, declaration.split("|", 1)[0].trim()];
  }));
}

export function parsePalette(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  // Keep line breaks for the cloud editor's newline-delimited format.
  const source = text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:\r\n])\/\/[^\r\n]*/gm, "$1")
    .replace(/(^|[;\r\n])[ \t]*([A-Za-z0-9_]+)\s*:\s*/g, "$1$2:");
  for (const entry of source.split(/[;\r\n]+/)) {
    if (!entry.trim()) {
      continue;
    }
    const match = /^\s*([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/.exec(entry);
    if (!match || !match[2].trim()) {
      throw new Error(`Некорректная запись палитры: ${entry.trim().slice(0, 80)}`);
    }
    const [, key, value] = match;
    if (fields.has(key)) {
      throw new Error(`Ключ «${key}» указан дважды.`);
    }
    fields.set(key, value);
  }
  if (!fields.size) {
    throw new Error("Палитра пуста.");
  }
  return fields;
}

export class Palette {
  private readonly colors = new Map<string, string>();

  private readonly defaults: ReadonlyMap<string, string>;
  readonly fields: ReadonlyMap<string, string>;

  constructor(defaults: ReadonlyMap<string, string>, fields: ReadonlyMap<string, string> = new Map()) {
    this.defaults = defaults;
    this.fields = fields;
    for (const [key, value] of fields) {
      if (defaults.has(key) || (!cloudFields.has(key) && hexColor.test(value))) {
        this.color(key);
      }
    }
  }

  color(key: string): string {
    const path = new Set<string>();
    let current = key;
    let color = this.colors.get(current);
    while (!color) {
      if (path.has(current)) {
        throw new Error(`Циклическая ссылка: ${[...path, current].join(" → ")}.`);
      }
      path.add(current);
      const value = this.fields.get(current) ?? this.defaults.get(current);
      if (!value || cloudFields.has(current)) {
        throw new Error(`Цвет «${key}» ссылается на неизвестный ключ «${current}».`);
      }
      if (hexColor.test(value)) {
        color = value.toUpperCase();
      } else {
        if (!identifier.test(value)) {
          throw new Error(`Некорректное значение цвета «${current}»: ${value.slice(0, 80)}.`);
        }
        current = value;
        color = this.colors.get(current);
      }
    }
    for (const name of path) {
      this.colors.set(name, color);
    }
    return color;
  }
}
