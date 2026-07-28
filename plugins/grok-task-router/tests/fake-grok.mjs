#!/usr/bin/env node

import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_GROK_LOG) appendFileSync(process.env.FAKE_GROK_LOG, `${JSON.stringify(args)}\n`);

if (args[0] === "version" || args.includes("--version")) {
  console.log("grok 0.2.112-test");
  process.exit(0);
}

if (args[0] === "models") {
  console.log("You are logged in with grok.com.\n\nDefault model: grok-4.5\n\nAvailable models:\n  * grok-4.5 (default)");
  process.exit(0);
}

const modelIndex = args.indexOf("--model");
const model = modelIndex >= 0 ? args[modelIndex + 1] : "unknown";
const promptIndex = args.indexOf("-p");
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : "";
const validTools = new Set([
  "read_file", "grep", "list_dir", "run_terminal_cmd", "search_replace", "write_file",
  "web_search", "web_fetch", "x_search", "Agent",
]);
for (const flag of ["--tools", "--disallowed-tools"]) {
  const index = args.indexOf(flag);
  if (index >= 0) {
    for (const tool of args[index + 1].split(",")) {
      if (!validTools.has(tool)) {
        console.error(`测试发现未知内部工具名：${tool}`);
        process.exit(2);
      }
    }
  }
}
console.log(JSON.stringify({
  result: `模拟 Grok 完成。model=${model}; prompt=${prompt.slice(0, 80)}`,
  model,
}));
