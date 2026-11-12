import { unzipSync } from "fflate";
import { Palette, parsePalette } from "./palette.ts";

const paletteFiles = ["colors.tdesktop-theme", "colors.tdesktop-palette"];
const wallpaperFiles = ["background.jpg", "background.png", "tiled.jpg", "tiled.png"];
const paletteLimit = 1024 * 1024;
const wallpaperLimit = 4 * paletteLimit;
const fileLimit = 5 * paletteLimit;

export interface ImportedTheme {
  palette: Palette;
  source: Blob;
  paletteText: string;
  wallpaper?: { name: string; bytes: Uint8Array };
}

export async function readTheme(
  source: Blob,
  defaults: ReadonlyMap<string, string>,
): Promise<ImportedTheme> {
  if (source.size > fileLimit) {
    throw new Error("Файл темы превышает 5 МиБ.");
  }
  let content = new Uint8Array(await source.arrayBuffer());
  let wallpaper: ImportedTheme["wallpaper"];
  if (content[0] === 0x50 && content[1] === 0x4b) {
    const names = new Map<string, string>();
    let files: ReturnType<typeof unzipSync>;
    try {
      files = unzipSync(content, {
        filter(file) {
          const name = file.name.toLowerCase();
          const isPalette = paletteFiles.includes(name);
          if (!isPalette && !wallpaperFiles.includes(name)) {
            return false;
          }
          if (names.has(name)) {
            throw new Error(`Имя «${file.name}» повторяется.`);
          }
          const limit = isPalette ? paletteLimit : wallpaperLimit;
          if (Math.max(file.originalSize, file.size) > limit) {
            throw new Error(`«${file.name}» превышает допустимый размер.`);
          }
          names.set(name, file.name);
          return true;
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      throw new Error(`Не удалось прочитать ZIP-архив. ${detail}`.trim());
    }
    const paletteName = paletteFiles.map((name) => names.get(name))
      .find((name) => name && files[name].length);
    if (!paletteName) {
      throw new Error("В ZIP-архиве нет палитры colors.tdesktop-theme или colors.tdesktop-palette.");
    }
    content = new Uint8Array(files[paletteName]);
    const wallpaperName = wallpaperFiles.map((name) => names.get(name)).find(Boolean);
    if (wallpaperName) {
      wallpaper = { name: wallpaperName, bytes: files[wallpaperName] };
    }
  }
  if (content.length > paletteLimit) {
    throw new Error("Палитра превышает 1 МиБ.");
  }
  let paletteText: string;
  try {
    paletteText = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error("Палитра должна быть текстом в кодировке UTF-8.");
  }
  return { palette: new Palette(defaults, parsePalette(paletteText)), source, paletteText, wallpaper };
}
