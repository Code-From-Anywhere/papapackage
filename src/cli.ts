#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { handler as defaultHandler } from "./commands/*";
yargs(hideBin(process.argv))
  .scriptName("papapackage")
  // Use the commands directory to scaffold.
  .commandDir("commands")
  .command("*", "The default command", () => {}, defaultHandler)
  // Enable strict mode.
  // .strict()
  // Useful aliases.
  .alias({ h: "help" }).argv;
