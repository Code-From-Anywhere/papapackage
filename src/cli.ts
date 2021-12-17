#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { handler as defaultHandler } from "./commands/DEFAULT";
yargs(hideBin(process.argv))
  .scriptName("papapackage")
  .commandDir("commands")
  .command("*", "The default command", () => {}, defaultHandler)
  .alias({ h: "help" }).argv;
