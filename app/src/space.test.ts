import { expect, test } from "vitest";
import { humanSize } from "./space";

test("units", () => {
  expect(humanSize(0)).toBe("0 B");
  expect(humanSize(1023)).toBe("1023 B");
  expect(humanSize(1536)).toBe("1.5 KB");
  expect(humanSize(5 * 1024 ** 3)).toBe("5.0 GB");
  expect(humanSize(3 * 1024 ** 5)).toBe("3072.0 TB");
});
