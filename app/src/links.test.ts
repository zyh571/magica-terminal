import { describe, expect, test } from "vitest";
import { findLinks, resolvePath } from "./links";

const texts = (line: string) => findLinks(line).map((l) => [l.text, l.kind]);

describe("links", () => {
  test("urls without trailing punctuation", () => {
    expect(texts("see https://a.b/c).")).toEqual([["https://a.b/c", "url"]]);
    expect(texts("www.x.org/p, then")).toEqual([["www.x.org/p", "url"]]);
    expect(texts("ftp://h/f;")).toEqual([["ftp://h/f", "url"]]);
  });
  test("paths", () => {
    expect(texts("see /etc/hosts.")).toEqual([["/etc/hosts", "path"]]);
    expect(texts("~/My/file.txt")).toEqual([["~/My/file.txt", "path"]]);
    expect(texts("a/b")).toEqual([]);
    expect(texts("http://x.y/z")).toEqual([["http://x.y/z", "url"]]);   // not also a path
  });
  test("windows paths", () => {
    expect(texts("path: C:\\Windows\\win.ini")).toEqual([["C:\\Windows\\win.ini", "path"]]);
    expect(texts("see C:/Users/u/a.txt.")).toEqual([["C:/Users/u/a.txt", "path"]]);
    expect(texts("~\\Documents\\notes.md")).toEqual([["~\\Documents\\notes.md", "path"]]);
    expect(texts("D:\\")).toEqual([["D:\\", "path"]]);
    expect(texts("\\section{x} and a\\b")).toEqual([]);   // a backslash alone doesn't make a path
    expect(texts("file:///C:/x")).toEqual([["file:///C:/x", "url"]]);
  });
  test("positions", () => {
    const [l] = findLinks("  /tmp/x y");
    expect([l.start, l.end]).toEqual([2, 8]);
  });
  test("resolving", () => {
    expect(resolvePath("~/x", "/home/u", "/cwd")).toBe("/home/u/x");
    expect(resolvePath("/a/b", "/home/u", "/cwd")).toBe("/a/b");
    expect(resolvePath("~\\x", "C:\\Users\\u", "C:\\cwd")).toBe("C:\\Users\\u\\x");
    expect(resolvePath("C:\\a\\b", "C:\\Users\\u", "C:\\cwd")).toBe("C:\\a\\b");
    expect(resolvePath("c:/a", "C:\\Users\\u", "C:\\cwd")).toBe("c:/a");
  });
});
