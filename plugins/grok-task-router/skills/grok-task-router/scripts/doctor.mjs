#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cli = process.env.GROK_ROUTER_CLI || join(homedir(), ".grok", "bin", "grok");

try {
  accessSync(cli, constants.X_OK);
  console.log(`Grok CLI：${cli}`);
  console.log(execFileSync(cli, ["version"], { encoding: "utf8" }).trim());
  console.log(execFileSync(cli, ["models"], { encoding: "utf8", timeout: 30000 }).trim());
  console.log("诊断完成：CLI 可执行且账户能够读取模型列表。");
} catch (error) {
  console.error(`诊断失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
