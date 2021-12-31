#!/usr/bin/env node

import type { Arguments } from "yargs";
import watchman from "fb-watchman";
var colors = require("colors");
const readline = require("readline");
import {
  calculateWatchlist,
  createSubscriptionEventEmitter,
  getPackages,
  linkWatchlist,
  logWatchlist,
  watchWatch,
} from "../util/util";

export const handler = (argv: Arguments): void => {
  //watch certain keys:
  const args = argv._;
  const debug = args[1];

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on("keypress", (str, key) => {
    if (key.ctrl && key.name === "c") {
      process.exit();
    } else if (key.name === "l") {
      const watchlist = calculateWatchlist(argv);
      logWatchlist(watchlist);
    } else if (key.name === "f") {
      const args = argv._;
      const { files, packages } = getPackages(args);
      console.log({
        files,
        packages,
      });
    } else {
      console.log(
        `You pressed the "${str}" key, but nothing will happen.`,
        key
      );
    }
  });

  //step 1-12
  const watchlist = calculateWatchlist(argv);

  linkWatchlist(watchlist, "yarn");

  //step 13: run watchman for the watchlist with the handler to copy every changed file to all its destination
  const client = new watchman.Client({
    //watchmanBinaryPath: "/opt/homebrew/bin/watchman",
  });

  client.capabilityCheck(
    { optional: [], required: ["relative_root"] },
    function (error, resp) {
      if (error) {
        // error will be an Error object if the watchman service is not
        // installed, or if any of the names listed in the `required`
        // array are not supported by the server
        console.error(error);
        client.end();
        return;
      }
      console.log(colors.green("Watchman is ok"), resp);

      // Initiate the watch
      watchlist.forEach(watchWatch(client));
      createSubscriptionEventEmitter(client, watchlist, debug);
    }
  );

  //process.exit(0);
};
