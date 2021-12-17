#!/usr/bin/env node

import type { Arguments } from "yargs";
import { FileType, Watch } from "../util/types";
import watchman from "fb-watchman";
var colors = require("colors");
const readline = require("readline");

import fs from "fs";
import path from "path";
import {
  // keepHighestVersion,
  calculateWatchlist,
  logWatchlist,
} from "../util/util";

export const handler = (argv: Arguments): void => {
  //watch certain keys:
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on("keypress", (str, key) => {
    if (key.ctrl && key.name === "c") {
      process.exit();
    } else if (key.name === "l") {
      const watchlist = calculateWatchlist(argv);
      logWatchlist(watchlist);
    } else {
      console.log(
        `You pressed the "${str}" key, but nothing will happen.`,
        key
      );
    }
  });

  //step 1-12
  const watchlist = calculateWatchlist(argv);

  //step 13: run watchman for the watchlist with the handler to copy every changed file to all its destination
  const client = new watchman.Client({
    watchmanBinaryPath: "/opt/homebrew/bin/watchman",
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
      // resp will be an extended version response:
      // {'version': '3.8.0', 'capabilities': {'relative_root': true}}
      console.log(colors.green("Watchman is ok"), resp);

      // Initiate the watch
      watchlist.map((watch) => {
        createWatchmanConfig(watch);

        client.command(["watch-project", watch.src], function (error, resp) {
          if (error) {
            console.error(colors.red("Error initiating watch:"), error);
            return;
          }

          // It is considered to be best practice to show any 'warning' or
          // 'error' information to the user, as it may suggest steps
          // for remediation
          if ("warning" in resp) {
            console.log(
              colors.yellow("Warning initiating watch: "),
              resp.warning
            );
          }

          // `watch-project` can consolidate the watch for your
          // dir_of_interest with another watch at a higher level in the
          // tree, so it is very important to record the `relative_path`
          // returned in resp

          console.log(
            colors.green("New watch:"),
            "watch established on ",
            resp.relative_path
              ? path.join(resp.watch, resp.relative_path)
              : resp.watch
          );

          return make_subscription(
            client,
            resp.watch,
            resp.relative_path,
            watch.dests
          );
        });
      });

      createSubscriptionEventEmitter(client, watchlist);
    }
  );

  //process.exit(0);
};
// `watch` is obtained from `resp.watch` in the `watch-project` response.
// `relative_path` is obtained from `resp.relative_path` in the
// `watch-project` response.
function make_subscription(
  client: watchman.Client,
  watch: string,
  relative_path: string,
  dests: { destinationFolder: string; dependencyName: string }[]
) {
  const sub = {
    // Match any `.js` file in the dir_of_interest
    expression: ["allof", ["match", "*.*"]],
    // Which fields we're interested in
    fields: ["name", "size", "mtime_ms", "exists", "type"],
    relative_root: undefined as undefined | string,
  };

  if (relative_path) {
    sub.relative_root = relative_path;
  }

  const subName = `papapackage:${watch}${
    relative_path ? `:${relative_path}` : ""
  }`;

  client.command(["subscribe", watch, subName, sub], function (error, resp) {
    if (error) {
      // Probably an error in the subscription criteria
      console.error(
        colors.red("Error subscribing"),
        "Failed to subscribe: ",
        error
      );
      return;
    }
    console.log(
      colors.green("New subscribtion"),
      "subscription " + resp.subscribe + " established"
    );
  });

  return subName;

  // Subscription results are emitted via the subscription event.
  // Note that this emits for all subscriptions.  If you have
  // subscriptions with different `fields` you will need to check
  // the subscription name and handle the differing data accordingly.
  // `resp`  looks like this in practice:
  //
  // { root: '/private/tmp/foo',
  //   subscription: 'mysubscription',
  //   files: [ { name: 'node_modules/fb-watchman/index.js',
  //       size: 4768,
  //       exists: true,
  //       type: 'f' } ] }
}

const createWatchmanConfig = (watch: Watch) => {
  const mustIgnore = ["node_modules", ".git"];
  const watchmanConfigPath = path.join(watch.src, ".watchmanconfig");

  try {
    const buffer = fs.readFileSync(watchmanConfigPath);

    //@ts-ignore
    const json = JSON.parse(buffer);
  } catch (e) {
    // create file
    console.log(
      colors.green("Created config: "),
      "created watchmanconfig file to ignore node_modules and .git"
    );

    fs.writeFileSync(
      watchmanConfigPath,
      JSON.stringify({ ignore_dirs: ["node_modules", ".git"] })
    );
  }
};
const createSubscriptionEventEmitter = (
  client: watchman.Client,
  watchlist: Watch[]
) => {
  client.on("subscription", function (resp) {
    const [appName, rootPath, relativePath] = resp.subscription.split(":");

    if (!rootPath) return;

    const fullPath = relativePath
      ? path.join(rootPath, relativePath)
      : rootPath;

    const watch = watchlist.find((w) => w.src === fullPath);

    if (watch) {
      if (rootPath !== resp.root) {
        console.log(colors.red("invalid rootpath"), rootPath, resp.root);
      }

      const filteredFiles = resp.files.filter(
        (f: FileType) => !f.name.includes("node_modules/")
      );

      console.log(
        colors.green("Subscribed"),
        `Copying ${filteredFiles.length} file(s) to ${watch.dests.length} destination(s)`,
        filteredFiles.map((f: FileType) => f.name),
        watch.dests.map((d) => d.destinationFolder)
      );

      filteredFiles.forEach(function (file: FileType) {
        // convert Int64 instance to javascript integer
        const mtime_ms = +file.mtime_ms;

        // console.log(
        //   "file changed: " + resp.root + "/" + file.name,
        //   mtime_ms,
        //   "should copy to",
        //   dests
        // );

        watch.dests.map((dest) => {
          const from = path.join(fullPath, file.name);
          const to = path.join(
            dest.destinationFolder,
            "node_modules",
            dest.dependencyName,
            file.name
          );
          // if (resp.relative_path) {
          //   console.log({
          //     relative: resp.relative_path,
          //     rootWithRelative,
          //     from,
          //     to,
          //   });
          // }

          const folders = to.split("/");
          folders.pop();
          const folder = folders.join("/");

          if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, {
              recursive: true,
            });
          }

          // console.log({
          //   from,
          //   fromExists: fs.existsSync(from),
          //   to,
          //   toExists: fs.existsSync(to),
          // });

          fs.copyFileSync(from, to);
          //console.log({ from, to });
        });
      });
    }
  });
};
