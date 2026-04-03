#!/usr/bin/env node

import("../dist/cli.js")
  .then(({ runCli }) => runCli())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
