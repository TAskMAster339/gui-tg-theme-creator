const hexColor = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const identifier = /^[A-Za-z0-9_]+$/;
const metadataPrefix = "// @theme-field ";
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
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(metadataPrefix)) {
      continue;
    }
    const field: unknown = JSON.parse(line.slice(metadataPrefix.length));
    if (!Array.isArray(field) || field.length !== 2
      || typeof field[0] !== "string" || !identifier.test(field[0])
      || typeof field[1] !== "string" || fields.has(field[0])) {
      throw new Error("Некорректное дополнительное поле палитры.");
    }
    fields.set(field[0], field[1]);
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

  declaration(key: string): string | undefined {
    return this.fields.get(key) ?? this.defaults.get(key);
  }

  restoreColor(key: string, original: Palette): Palette {
    const fields = new Map(this.fields);
    const value = original.fields.get(key);
    if (value === undefined) {
      fields.delete(key);
    } else {
      fields.set(key, value);
    }
    return new Palette(this.defaults, fields);
  }

  withColor(key: string, value: string): Palette {
    if (!this.defaults.has(key) || !hexColor.test(value)) {
      throw new Error("Введите цвет в формате #RRGGBB или #RRGGBBAA.");
    }
    const fields = new Map(this.fields);
    fields.set(key, value.toUpperCase());
    return new Palette(this.defaults, fields);
  }

  toThemeText(): string {
    const lines: string[] = [];
    const emitted = new Set<string>();
    const fields = new Map(this.fields);
    // Telegram expects at least one color declaration in a usable palette.
    if (![...fields.keys()].some((key) => this.defaults.has(key))) {
      fields.set("windowBg", this.color("windowBg"));
    }
    for (const key of fields.keys()) {
      const path = new Set<string>();
      let current = key;
      while (!emitted.has(current) && !path.has(current)) {
        const value = fields.get(current);
        if (value === undefined) {
          if (this.defaults.has(current)) {
            lines.push(`${current}: ${this.color(current)};`);
            emitted.add(current);
          }
          break;
        }
        path.add(current);
        if (cloudFields.has(current) || !identifier.test(value)) {
          break;
        }
        current = value;
      }
      for (const name of [...path].reverse()) {
        const value = fields.get(name)!;
        const native = !cloudFields.has(name) && (hexColor.test(value) || identifier.test(value));
        lines.push(native ? `${name}: ${value};` : metadataPrefix + JSON.stringify([name, value]));
        emitted.add(name);
      }
    }
    return lines.join("\n") + "\n";
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
      const value = this.declaration(current);
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
