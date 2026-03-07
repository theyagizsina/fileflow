import { describe, test, expect } from "bun:test";
import { Classifier } from "./classifier";

interface Rule {
  name: string;
  type: "pattern" | "extension";
  match: string[];
  destination: string;
}

const testRules: Rule[] = [
  {
    name: "Screenshots",
    type: "pattern",
    match: ["Screenshot*", "Screen Shot*"],
    destination: "W:\\Media\\Screenshots",
  },
  {
    name: "Videos",
    type: "extension",
    match: [".mp4", ".mkv"],
    destination: "W:\\Media\\Videos",
  },
  {
    name: "Images",
    type: "extension",
    match: [".jpg", ".png"],
    destination: "W:\\Media\\Images",
  },
];

describe("Classifier", () => {
  const classifier = new Classifier(testRules);

  test("matches filename pattern", () => {
    const result = classifier.classify("Screenshot_2026-03-08.png");
    expect(result?.ruleName).toBe("Screenshots");
  });

  test("pattern takes priority over extension", () => {
    const result = classifier.classify("Screenshot_2026.png");
    expect(result?.ruleName).toBe("Screenshots");
  });

  test("matches by extension", () => {
    const result = classifier.classify("movie.mp4");
    expect(result?.ruleName).toBe("Videos");
    expect(result?.destination).toBe("W:\\Media\\Videos");
  });

  test("extension matching is case-insensitive", () => {
    const result = classifier.classify("photo.JPG");
    expect(result?.ruleName).toBe("Images");
  });

  test("returns null for no match", () => {
    const result = classifier.classify("random.xyz");
    expect(result).toBeNull();
  });

  test("first match wins", () => {
    const rules: Rule[] = [
      { name: "First", type: "extension", match: [".txt"], destination: "A:\\" },
      { name: "Second", type: "extension", match: [".txt"], destination: "B:\\" },
    ];
    const c = new Classifier(rules);
    expect(c.classify("file.txt")?.ruleName).toBe("First");
  });
});
