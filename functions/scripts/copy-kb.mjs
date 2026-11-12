// build 時把執行期需要的 kb/*.yaml 複製到 functions/kb-data/（部署只會上傳 functions/ 目錄）
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../kb/", import.meta.url));
const dst = fileURLToPath(new URL("../kb-data/", import.meta.url));
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) {
  if (f.endsWith(".yaml")) cpSync(src + f, dst + f);
}
console.log("kb-data:", readdirSync(dst).join(", "));
