import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { gemPixels, kyubeyPixels, outline, type Px } from "./sprites";

const digest = (px: Px) => createHash("sha1").update(Buffer.from(px.flat().flat())).digest("hex");

// SHA-1 of the old app's sprites (gem_pixels / kyubey_pixels), so the gems look exactly as they did
const PYTHON: Record<string, string> = {
  "0 null": "2cd84a569ec2f3f4fb4063d59e167b7e7333a245", "0 h": "8414b98a3e65090301cd34a3ee42db81b56ef1c5",
  "0 v": "9843223c1add6aac599e958f2f1f6a1ef2a60343", "0 wrapped": "ac875fd9dcbbcd57fc89eabdcf26bd8c0b3f368c",
  "1 null": "ae3b4bc340ad4d004637bf9137acb9f508392f48", "1 h": "e50ecc1dce270cf8eead6b5c768d6a1a4295330f",
  "1 v": "03dc23df0bb18a761211c307b549cd1d4c38e0df", "1 wrapped": "4110f8e7aeba3a9a407aa67629cb0f825903d79f",
  "2 null": "2ad7e5decd4e1e6734d1ca750c6a326ede41b8d1", "2 h": "2f6f5b9e8ec4841d20be707171035d760e47ae13",
  "2 v": "10b9ecb74b13c52e447c561fcd171f4cfa7616f2", "2 wrapped": "6dcddf2dd0057a5b29990053ce1c3bcfdf12f38b",
  "3 null": "c18abd7608dba8773abb32b34c59c04ebdb6a58a", "3 h": "0bc08bfc547ac0c03b20e371d27ab0a936892b54",
  "3 v": "2b51d295748e55cd69c1062ec01a9abf468f5aa0", "3 wrapped": "6376c41f9149b4151221863920bb9404e082fa71",
  "4 null": "b549ebba7535e0945d461997eb3bb443bec773eb", "4 h": "37cd0e044ee6d004e514aa88687368bd268837eb",
  "4 v": "36d47a9d9900e3aeec0f03442c34f76477615a69", "4 wrapped": "889384f63be398f87feb9367f940ef639cee26c2",
};

test("gems match the old app pixel for pixel", () => {
  for (const [key, sha] of Object.entries(PYTHON)) {
    const [k, sp] = key.split(" ");
    expect(digest(gemPixels(Number(k), sp === "null" ? null : (sp as "h")) ), key).toBe(sha);
  }
});

test("kyubey", () => {
  expect(digest(outline(kyubeyPixels(), [40, 36, 48]))).toBe("6330e53305a7f45ea9572d0af30dd730bd35a104");
});
