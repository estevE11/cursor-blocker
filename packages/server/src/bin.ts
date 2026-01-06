#!/usr/bin/env node

import { startServer } from "./index.js";
import { DEFAULT_PORT } from "@cursor-blocker/shared";

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`
Cursor Blocker - Block distracting sites unless Cursor AI is actively generating code

Usage:
  npx cursor-blocker [options]

Options:
  --port      Server port (default: ${DEFAULT_PORT})
  --help      Show this help message

Examples:
  npx cursor-blocker
  npx cursor-blocker --port 9000
`);
}

async function main(): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  // Parse port
  let port = DEFAULT_PORT;
  const portIndex = args.indexOf("--port");
  if (portIndex !== -1 && args[portIndex + 1]) {
    const parsed = parseInt(args[portIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      port = parsed;
    } else {
      console.error("Invalid port number");
      process.exit(1);
    }
  }

  startServer(port);
}

main();
