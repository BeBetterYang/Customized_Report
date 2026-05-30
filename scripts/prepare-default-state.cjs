const fs = require("fs/promises");
const path = require("path");
const { serializeStateValue } = require("../server/state-security.cjs");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const sourceDir = path.resolve(process.argv[2] || ".app-state");
  const targetDir = path.resolve(process.argv[3] || "default-state");

  if (!(await pathExists(sourceDir))) {
    throw new Error(`源配置目录不存在：${sourceDir}`);
  }

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await fs.mkdir(targetDir, { recursive: true });

  let written = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const key = entry.name.replace(/\.json$/i, "");
    const sourceFile = path.join(sourceDir, entry.name);
    const targetFile = path.join(targetDir, entry.name);
    const value = JSON.parse(await fs.readFile(sourceFile, "utf8"));
    await fs.writeFile(targetFile, JSON.stringify(serializeStateValue(key, value), null, 2), "utf8");
    written += 1;
  }

  console.log(`已生成默认配置：${targetDir}（${written} 个文件）`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
