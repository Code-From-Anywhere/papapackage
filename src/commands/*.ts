import type { Arguments } from "yargs";
import { Package } from "../util/types";
import watchman from "fb-watchman";
import fs from "fs";
import path from "path";
import {
  chooseFolder,
  getDependenciesList,
  searchRecursiveSync,
  unique,
  getFolder,
  getRelevantPackageInfo,
  findPackageDependencyPair,
  getRelevantWatchlistInfo,
  // keepHighestVersion,
} from "../util/util";

export const handler = (argv: Arguments): void => {
  const command = argv.$0;
  const args = argv._;
  const debug = args[1];
  //step 1: get the folder to run this command from
  const folder = chooseFolder(args);

  //step 2: recursively search all directories except for certain ignored directories for package.json files
  const ignore = ["node_modules", ".git"];
  const match = "package.json";
  const files = searchRecursiveSync(folder, ignore, match);

  //step 3: now that we got all package.json's, fetch their data
  const packages = files
    .map(getRelevantPackageInfo)
    .filter(Boolean) as Package[];

  //step 4: get all dependencies of all packages
  const depList = packages.reduce(getDependenciesList, []);
  const allDependencies = unique(depList, String);

  //step 5: search for packages that are included in all dependencies and only keep their highest version
  const dependencyPackages = packages.filter(
    (p) => p.name && allDependencies.includes(p.name)
  );
  if (debug) {
    console.log({ files, packagesLength: packages.length });

    //console.dir(allDependencies, { maxArrayLength: null });
    console.log(dependencyPackages.map((p) => p.name));
  }

  //step 6: find dependencies for all packages
  const dependencyPackagesNames = dependencyPackages.map((p) => p.name);
  const dependentPackages = packages
    .map(findPackageDependencyPair(dependencyPackagesNames))
    .filter((res) => res.dependencies.length > 0);

  //step 7: find srcDestPairs
  const srcDestPairs = dependentPackages
    .map((dp) => {
      const dest = dp.package;
      const watchlistPartly = dp.dependencies.map((dependency) => ({
        src: dependencyPackages.find((p) => p.name === dependency)!,
        //.reduce(keepHighestVersion, [])[0],
        dest,
      }));
      return watchlistPartly;
    })
    .reduce((previous, current) => {
      return [...previous, ...current];
    }, []);

  //step 8: find all dests for one src, for all unique src's
  const srcDestsPairs = unique(
    srcDestPairs,
    (srcDestPair) => srcDestPair.src.path
  ).map(({ src }) => {
    return {
      src,
      dests: srcDestPairs
        .filter((srcDest) => srcDest.src.name === src.name)
        .map((srcDest) => srcDest.dest),
    };
  });

  //step 9: we just need the folders
  const watchlist = srcDestsPairs.map(getRelevantWatchlistInfo);

  //TODO: add step 10-12 later, as it's probably not needed
  //step 10: safe last time papapackage was running and check the last time every dependency has had changes in non-ignored folders
  //step 11: remove current dest/node_modules/dependency folder
  //step 12: copy src folder to dest/node_modules/dependency
  console.dir(watchlist, { depth: 10 });

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
      console.log(resp);

      // Initiate the watch
      watchlist.map((watch) => {
        const mustIgnore = ["node_modules", ".git"];
        const watchmanConfigPath = path.join(watch.src, ".watchmanconfig");

        try {
          const buffer = fs.readFileSync(watchmanConfigPath);

          //@ts-ignore
          const json = JSON.parse(buffer);
        } catch (e) {
          // create file
          console.log(
            "created watchmanconfig file to ignore node_modules and .git"
          );

          fs.writeFileSync(
            watchmanConfigPath,
            JSON.stringify({ ignore_dirs: ["node_modules", ".git"] })
          );
        }

        client.command(["watch-project", watch.src], function (error, resp) {
          if (error) {
            console.error("Error initiating watch:", error);
            return;
          }

          // It is considered to be best practice to show any 'warning' or
          // 'error' information to the user, as it may suggest steps
          // for remediation
          if ("warning" in resp) {
            console.log("warning: ", resp.warning);
          }

          // `watch-project` can consolidate the watch for your
          // dir_of_interest with another watch at a higher level in the
          // tree, so it is very important to record the `relative_path`
          // returned in resp

          console.log(
            "watch established on ",
            resp.watch,
            " relative_path",
            resp.relative_path
          );

          make_subscription(
            client,
            resp.watch,
            resp.relative_path,
            watch.dests
          );
        });
      });
    }
  );

  //process.exit(0);
};

type FileType = {
  // ["name", "size", "mtime_ms", "exists", "type"]
  name: string;
  size: number;
  mtime_ms: number;
  exists: boolean;
  type: string;
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

  const subName = `papapackage${watch + (relative_path || "")}`;
  client.command(["subscribe", watch, subName, sub], function (error, resp) {
    if (error) {
      // Probably an error in the subscription criteria
      console.error("failed to subscribe: ", error);
      return;
    }
    console.log("subscription " + resp.subscribe + " established");
  });

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
  client.on("subscription", function (resp) {
    if (resp.subscription !== subName) return;

    resp.files.forEach(function (file: FileType) {
      // convert Int64 instance to javascript integer
      const mtime_ms = +file.mtime_ms;

      if (!file.name.includes("node_modules/")) {
        // console.log(
        //   "file changed: " + resp.root + "/" + file.name,
        //   mtime_ms,
        //   "should copy to",
        //   dests
        // );

        dests.map((dest) => {
          const from = path.join(resp.root, file.name);
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

          console.log({
            from,
            fromExists: fs.existsSync(from),
            to,
            toExists: fs.existsSync(to),
          });

          //fs.copyFileSync(from, to);
          //console.log({ from, to });
        });
      }
    });
  });
}
