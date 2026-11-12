import { describe, expect, test } from "vitest";
import { headerAt, noteMarks, visibleTags } from "./markup";

const inner = (t: string, ms: { innerStart: number; innerEnd: number }[]) => ms.map((m) => t.slice(m.innerStart, m.innerEnd));

describe("note markup", () => {
  test("headers", () => {
    const text = "<head>Shopping<head>\nmilk\n<head> Work </head>\n<head>no end\n<head><head>";
    const { heads } = noteMarks(text);
    expect(inner(text, heads)).toEqual(["Shopping", " Work "]);
    expect(text.slice(heads[0].start, heads[0].end)).toBe("<head>Shopping<head>");
  });
  test("a header stays on one line", () => expect(noteMarks("<head>a\nb<head>").heads).toEqual([]));
  test("bold", () => {
    const text = "buy *milk* and *two eggs* * not * a*b*c **";
    expect(inner(text, noteMarks(text).bolds)).toEqual(["milk", "two eggs"]);
  });
  test("bullets are not bold", () => expect(noteMarks("* one\n* two\n").bolds).toEqual([]));
  test("tags show only where the cursor is", () => {
    const text = "x *b* <head>H<head>";
    const m = noteMarks(text);
    expect(visibleTags(m, 0)).toEqual([]);
    expect(visibleTags(m, 3).map((x) => x.start)).toEqual([2]);
    expect(visibleTags(m, 5).map((x) => x.start)).toEqual([2]);   // just after the closing *
    expect(visibleTags(m, 12).map((x) => x.start)).toEqual([6]);
  });
  test("header at line", () => {
    const text = "<head>A<head>\nx\n<head>B<head>";
    expect(headerAt(noteMarks(text).heads, 1)).toBe(16);
  });
});
