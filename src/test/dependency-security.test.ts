import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import postcss from "postcss";
import sharp from "sharp";
import { SourceMapConsumer, SourceMapGenerator } from "source-map-js";
import { describe, expect, it } from "vitest";

const requireDependency = createRequire(import.meta.url);
const SourceMapConsumerFromJSON = requireDependency("source-map-js").SourceMapConsumer as
  new (sourceMap: string) => SourceMapConsumer;

describe("patched dependency compatibility", () => {
  it("locks every affected installed package to the reviewed patch", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    for (const [name, version] of Object.entries({
      next: "16.4.3",
      sharp: "0.35.5",
      "source-map-js": "1.2.2",
      undici: "7.29.1",
      "brace-expansion": "5.0.12",
    })) {
      const installed = Object.entries(lock.packages).filter(([location]) =>
        location.endsWith(`/node_modules/${name}`) || location === `node_modules/${name}`,
      );
      expect(installed.length, name).toBeGreaterThan(0);
      for (const [location, dependency] of installed) {
        expect(dependency.version, location).toBe(version);
      }
    }
    expect(sharp.versions.sharp).toBe("0.35.5");
  });

  it("preserves indexed source-map offsets and original source lookup", () => {
    const generator = new SourceMapGenerator({ file: "receipt.css" });
    generator.addMapping({
      generated: { line: 1, column: 0 },
      original: { line: 3, column: 2 },
      source: "receipt-input.css",
    });
    generator.setSourceContent("receipt-input.css", ".receipt { color: brown; }");
    const consumer = new SourceMapConsumerFromJSON(JSON.stringify({
      version: 3,
      sections: [{ offset: { line: 2, column: 0 }, map: generator.toJSON() }],
    }));
    expect(consumer.originalPositionFor({ line: 3, column: 1 })).toMatchObject({
      source: "receipt-input.css",
      line: 3,
      column: 2,
    });
    expect(consumer.sourceContentFor("receipt-input.css")).toContain(".receipt");
  });

  it("rejects oversized indexed-map offsets before expanding mappings", () => {
    expect(() => new SourceMapConsumerFromJSON(JSON.stringify({
      version: 3,
      sections: [{
        offset: { line: 10_000_001, column: 0 },
        map: { version: 3, sources: [], names: [], mappings: "" },
      }],
    }))).toThrow("Section offset line must not exceed");
  });

  it("generates a reopenable PostCSS map for the production CSS chain", () => {
    const result = postcss([]).process(".receipt { color: brown; }", {
      from: "receipt-input.css",
      to: "receipt.css",
      map: { inline: false },
    });
    expect(result.css).toContain("color: brown");
    expect(result.map).toBeDefined();
    const consumer = new SourceMapConsumer(result.map!.toJSON());
    expect(consumer.originalPositionFor({ line: 1, column: 0 }).source).toBe(
      "receipt-input.css",
    );
  });

  it("preserves brace expansion and the existing jsdom HTTP dependency API", () => {
    const { expand } = requireDependency("brace-expansion") as {
      expand: (pattern: string) => string[];
    };
    expect(expand("src/{app,domain}/**/*.{ts,tsx}")).toEqual([
      "src/app/**/*.ts",
      "src/app/**/*.tsx",
      "src/domain/**/*.ts",
      "src/domain/**/*.tsx",
    ]);
    const undici = requireDependency("undici") as {
      fetch: unknown;
      Headers: new (headers: Record<string, string>) => { get(name: string): string | null };
    };
    expect(typeof undici.fetch).toBe("function");
    expect(new undici.Headers({ "content-type": "application/json" }).get("content-type"))
      .toBe("application/json");
  });
});
