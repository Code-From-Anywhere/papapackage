#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const fb_watchman_1 = __importDefault(require("fb-watchman"));
var colors = require("colors");
const readline = require("readline");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("../util/util");
const handler = (argv) => {
    //watch certain keys:
    const args = argv._;
    const debug = args[1];
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on("keypress", (str, key) => {
        if (key.ctrl && key.name === "c") {
            process.exit();
        }
        else if (key.name === "l") {
            const { watchlist, linklist } = (0, util_1.calculateTodo)(argv);
            (0, util_1.logWatchlist)(watchlist);
            (0, util_1.logLinklist)(linklist);
        }
        else if (key.name === "f") {
            const args = argv._;
            const { files, packages } = (0, util_1.getPackages)(args);
            console.log({
                files,
                packages,
            });
        }
        else {
            console.log(`You pressed the "${str}" key, but nothing will happen.`, key);
        }
    });
    //step 1-12
    const { watchlist, linklist } = (0, util_1.calculateTodo)(argv);
    (0, util_1.linkLinklist)(linklist, "yarn");
    //step 13: run watchman for the watchlist with the handler to copy every changed file to all its destination
    const client = new fb_watchman_1.default.Client({
    //watchmanBinaryPath: "/opt/homebrew/bin/watchman",
    });
    client.capabilityCheck({ optional: [], required: ["relative_root"] }, function (error, resp) {
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
                    console.log(colors.yellow("Warning initiating watch: "), resp.warning);
                }
                // `watch-project` can consolidate the watch for your
                // dir_of_interest with another watch at a higher level in the
                // tree, so it is very important to record the `relative_path`
                // returned in resp
                console.log(colors.green("New watch:"), "watch established on ", resp.relative_path
                    ? path_1.default.join(resp.watch, resp.relative_path)
                    : resp.watch);
                return makeSubscription(client, resp.watch, resp.relative_path, watch.dests);
            });
        });
        createSubscriptionEventEmitter(client, watchlist, debug);
    });
    //process.exit(0);
};
exports.handler = handler;
// `watch` is obtained from `resp.watch` in the `watch-project` response.
// `relative_path` is obtained from `resp.relative_path` in the
// `watch-project` response.
function makeSubscription(client, watch, relative_path, dests) {
    const sub = {
        // Match any `.js` file in the dir_of_interest
        expression: ["allof", ["match", "*.*"]],
        // Which fields we're interested in
        fields: ["name", "size", "mtime_ms", "exists", "type"],
        relative_root: undefined,
    };
    if (relative_path) {
        sub.relative_root = relative_path;
    }
    const subName = `papapackage:${watch}${relative_path ? `:${relative_path}` : ""}`;
    client.command(["subscribe", watch, subName, sub], function (error, resp) {
        if (error) {
            // Probably an error in the subscription criteria
            console.error(colors.red("Error subscribing"), "Failed to subscribe: ", error);
            return;
        }
        console.log(colors.green("New subscribtion"), "subscription " + resp.subscribe + " established");
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
const createWatchmanConfig = (watch) => {
    const mustIgnore = ["node_modules", ".git"];
    const watchmanConfigPath = path_1.default.join(watch.src, ".watchmanconfig");
    try {
        const buffer = fs_1.default.readFileSync(watchmanConfigPath);
        //@ts-ignore
        const json = JSON.parse(buffer);
    }
    catch (e) {
        // create file
        console.log(colors.green("Created config: "), "created watchmanconfig file to ignore node_modules and .git");
        fs_1.default.writeFileSync(watchmanConfigPath, JSON.stringify({ ignore_dirs: ["node_modules", ".git"] }));
    }
};
const createSubscriptionEventEmitter = (client, watchlist, debug) => {
    client.on("subscription", function (resp) {
        //console.log("subscription...", resp);
        const [appName, rootPath, relativePath] = resp.subscription.split(":");
        if (!rootPath) {
            console.log("No rootpath found", resp.subscription);
            return;
        }
        const fullPath = relativePath
            ? path_1.default.join(rootPath, relativePath)
            : rootPath;
        const watch = watchlist.find((w) => w.src === fullPath);
        if (watch) {
            if (rootPath !== resp.root) {
                console.log(colors.red("invalid rootpath"), rootPath, resp.root);
            }
            const filteredFiles = resp.files.filter((f) => !f.name.includes("node_modules/"));
            if (filteredFiles.length === 0) {
                // console.log(
                //   colors.red(
                //     `${fullPath}: ${resp.files.length} watched files but 0 source-files (had ${watch.dests.length} destinations).`
                //   )
                // );
                return;
            }
            console.log(colors.green("Event"), `Copying ${filteredFiles.length} file(s) to ${watch.dests.length} destination(s)`, { fullPath }, colors.yellow("names: "), filteredFiles.map((f) => f.name), colors.blue("destinations: "), watch.dests.map((d) => path_1.default.join(d.destinationFolder, "node_modules", d.dependencyName)));
            filteredFiles.forEach(function (file) {
                // convert Int64 instance to javascript integer
                const mtime_ms = +file.mtime_ms;
                // console.log(
                //   "file changed: " + resp.root + "/" + file.name,
                //   mtime_ms,
                //   "should copy to",
                //   dests
                // );
                watch.dests.map((dest) => {
                    const from = path_1.default.join(fullPath, file.name);
                    const to = path_1.default.join(dest.destinationFolder, "node_modules", dest.dependencyName, file.name);
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
                    if (!fs_1.default.existsSync(folder)) {
                        fs_1.default.mkdirSync(folder, {
                            recursive: true,
                        });
                    }
                    try {
                        fs_1.default.copyFileSync(from, to, fs_1.default.constants.COPYFILE_FICLONE);
                    }
                    catch (error) {
                        console.log(colors.red("copy file error"), {
                            from,
                            fromExists: fs_1.default.existsSync(from),
                            to,
                            toExists: fs_1.default.existsSync(to),
                            error,
                        });
                    }
                    //console.log({ from, to });
                });
            });
        }
        else {
            console.log("Couldnt find watch for ", resp.subscription);
        }
    });
};
