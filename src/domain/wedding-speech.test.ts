import { describe, expect, it } from "vitest";
import {
  estimateSpeechSeconds,
  normalizeWeddingSpeechContent,
  parseWeddingSpeech,
  WEDDING_SPEECH_TEMPLATES,
  WeddingSpeechValidationError,
} from "./wedding-speech";

describe("wedding speech domain", () => {
  it("accepts only the groom and bride speeches", () => {
    expect(parseWeddingSpeech("GROOM_PARENTS")).toBe("GROOM_PARENTS");
    expect(parseWeddingSpeech("BRIDE_PARENTS")).toBe("BRIDE_PARENTS");
    expect(() => parseWeddingSpeech("OTHER")).toThrow(WeddingSpeechValidationError);
  });

  it("keeps line breaks but trims trailing spaces and blank edges", () => {
    expect(normalizeWeddingSpeechContent("\r\n 爸、媽  \r\n\r\n謝謝你們 \n")).toBe(
      "爸、媽\n\n謝謝你們",
    );
    expect(normalizeWeddingSpeechContent("   \n ")).toBeNull();
    expect(normalizeWeddingSpeechContent(undefined)).toBeNull();
  });

  it("rejects speeches longer than the limit", () => {
    expect(() => normalizeWeddingSpeechContent("字".repeat(3001))).toThrow(
      "致詞稿最多 3000 個字。",
    );
  });

  it("estimates reading time in five-second steps", () => {
    expect(estimateSpeechSeconds("字".repeat(220))).toBe(60);
    expect(estimateSpeechSeconds("短")).toBe(5);
    expect(estimateSpeechSeconds(WEDDING_SPEECH_TEMPLATES.BRIDE_PARENTS)).toBeGreaterThan(30);
  });
});
