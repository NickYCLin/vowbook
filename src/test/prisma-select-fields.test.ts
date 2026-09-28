import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 幾支 server 端模組用手寫的 client 型別（`args: unknown`）呼叫 Prisma，
 * select 寫錯欄位不會被 tsc 擋下，要等真的連上資料庫才炸。這裡直接拿
 * schema.prisma 當事實來源，把 select 欄位逐一比對回去。
 */

type ModelFields = Map<string, string>;

function parseModels(schemaText: string): Map<string, ModelFields> {
  const models = new Map<string, ModelFields>();
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let model: RegExpExecArray | null;
  while ((model = modelPattern.exec(schemaText))) {
    const fields: ModelFields = new Map();
    for (const rawLine of model[2].split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const [name, type] = line.split(/\s+/);
      if (!type || !/^[a-zA-Z_]\w*$/u.test(name)) continue;
      fields.set(name, type.replace(/[?[\]]/gu, ""));
    }
    models.set(model[1], fields);
  }
  return models;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(entryPath));
    else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function closingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** 取出物件字面值這一層的 key 與對應的值文字，巢狀內容原封不動留給呼叫端。 */
function topLevelEntries(block: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  let depth = 0;
  let key = "";
  for (let index = 0; index < block.length; index += 1) {
    const character = block[index];
    if (character === "{" || character === "[" || character === "(") depth += 1;
    else if (character === "}" || character === "]" || character === ")") depth -= 1;
    else if (depth === 0 && character === ":") {
      const valueStart = index + 1;
      let valueDepth = 0;
      let cursor = valueStart;
      for (; cursor < block.length; cursor += 1) {
        const valueCharacter = block[cursor];
        if (valueCharacter === "{" || valueCharacter === "[" || valueCharacter === "(") {
          valueDepth += 1;
        } else if (valueCharacter === "}" || valueCharacter === "]" || valueCharacter === ")") {
          valueDepth -= 1;
        } else if (valueCharacter === "," && valueDepth === 0) break;
      }
      entries.push([key.trim(), block.slice(valueStart, cursor)]);
      key = "";
      index = cursor;
    } else if (depth === 0 && character === ",") key = "";
    else if (depth === 0) key += character;
  }
  return entries;
}

function selectBlock(text: string): string | null {
  const marker = text.search(/\bselect\s*:\s*\{/u);
  if (marker < 0) return null;
  const open = text.indexOf("{", marker + "select".length);
  const close = closingBrace(text, open);
  if (close < 0) return null;
  return text.slice(open + 1, close);
}

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const models = parseModels(readFileSync(schemaPath, "utf8"));
const modelByProperty = new Map(
  [...models.keys()].map((name) => [name[0].toLowerCase() + name.slice(1), name]),
);

function unknownFieldsIn(
  modelName: string,
  block: string,
  location: string,
  found: string[],
): void {
  const fields = models.get(modelName);
  if (!fields) return;
  for (const [key, value] of topLevelEntries(block)) {
    const name = key.replace(/[^\w]/gu, "");
    if (!name) continue;
    if (name === "_count") {
      // _count 底下列的是同一個 model 的關聯欄位，照原本的規則再查一次就好。
      const counted = selectBlock(value);
      if (counted !== null) unknownFieldsIn(modelName, counted, location, found);
      continue;
    }
    const type = fields.get(name);
    if (type === undefined) {
      found.push(`${location}: ${modelName}.${name}`);
      continue;
    }
    const nested = selectBlock(value);
    if (nested !== null && models.has(type)) {
      unknownFieldsIn(type, nested, location, found);
    }
  }
}

describe("Prisma select 欄位", () => {
  it("每個 select 的欄位都存在於 schema.prisma", () => {
    const unknown: string[] = [];
    const callPattern =
      /\.(\w+)\.(findMany|findUnique|findFirst|findUniqueOrThrow|findFirstOrThrow|update|updateMany|create|upsert)\(\s*\{/gu;

    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      let call: RegExpExecArray | null;
      while ((call = callPattern.exec(source))) {
        const modelName = modelByProperty.get(call[1]);
        if (!modelName) continue;
        const open = source.indexOf("{", call.index + call[0].length - 1);
        const close = closingBrace(source, open);
        if (close < 0) continue;
        const block = selectBlock(source.slice(open, close + 1));
        if (block === null) continue;
        const line = source.slice(0, call.index).split("\n").length;
        const location = `${path.relative(process.cwd(), file)}:${line}`;
        unknownFieldsIn(modelName, block, location, unknown);
      }
    }

    expect(unknown).toEqual([]);
  });

  it("認得出 schema 沒有的欄位", () => {
    const found: string[] = [];
    unknownFieldsIn("Guest", " vegetarianCount: true, partySize: true ", "fixture", found);
    expect(found).toEqual(["fixture: Guest.vegetarianCount"]);
  });
});
