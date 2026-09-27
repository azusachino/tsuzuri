#!/usr/bin/env node
import { parseArgs } from "node:util";
import pkg from "tsuzuri/package.json" with { type: "json" };
import { TOOLS } from "./tools.ts";

const USAGE = `tsuzuri-tools ${pkg.version}: tsuzuri's agent tool definitions

usage: tsuzuri-tools [--json]

Lists each tool with the operation it runs and whether it reads, adds, or changes notes.
--json prints the definitions a tool-calling model takes: name, operation, description, inputSchema, and annotations.`;

function parse() {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    }).values;
  } catch (error) {
    console.error(`tsuzuri-tools: ${(error as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
}

const opts = parse();
if (opts.help) {
  console.log(USAGE);
} else {
  const definitions = TOOLS.map(({ run: _, ...definition }) => definition);
  if (opts.json) {
    console.log(JSON.stringify(definitions, null, 2));
  } else {
    for (const { name, operation, annotations, description } of definitions) {
      const effect = annotations.readOnlyHint ? "reads" : annotations.destructiveHint ? "changes" : "adds";
      console.log(`${name}\t${operation}\t${effect}\t${description}`);
    }
  }
}
