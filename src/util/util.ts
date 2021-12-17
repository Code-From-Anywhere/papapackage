import fs from "fs";
import path from "path";
import { Arguments } from "yargs";
import type { Package, WatchmanDest, Watch } from "./types";

/**
 * searches for a match (file) in a base dir, but ignores folders in {ignore}
 */
export function searchRecursiveSync(
  dir: string,
  ignore: string[],
  match: string
): string[] {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  return files
    .filter((file) => !ignore.includes(file.name))
    .map((file) => {
      if (file.isDirectory()) {
        return searchRecursiveSync(path.join(dir, file.name), ignore, match);
      } else {
        return file.name === match ? path.join(dir, file.name) : null;
      }
    })
    .reduce((previous: string[], current) => {
      const newArray = Array.isArray(current)
        ? [...previous, ...current]
        : current !== null
        ? [...previous, current]
        : previous;
      return newArray;
    }, []);
}

export const findPackageDependencyPair =
  (dependencyPackagesNames: (string | undefined)[]) => (p: Package) => {
    return {
      package: p,
      dependencies: unique(getDependenciesList([], p), String).filter(
        (dependency) => dependencyPackagesNames.includes(dependency)
      ),
    };
  };

export const getRelevantWatchlistInfo = (object: {
  src: Package;
  dests: Package[];
}): Watch => {
  const dests = object.dests.map((dest) => getFolder(dest.path));
  const name = object.src.name!;
  const version = object.src.version;
  const destPackages = dests.map((dest) => {
    return {
      dest,
      currentPackageInfo: getRelevantPackageInfo(
        path.join(dest, "node_modules", name, "package.json")
      ),
    };
  });

  return {
    src: getFolder(object.src.path),
    dests: destPackages
      .map((p) => ({
        currentPackageJsonPath: p.currentPackageInfo?.path,
        currentVersion: p.currentPackageInfo?.version,
        destinationFolder: p.dest,
      }))
      .filter(onlyCopyIfCurrentVersionIsLower(version))
      .map((watchmanDest) => ({
        destinationFolder: watchmanDest.destinationFolder,
        dependencyName: name,
      })),
  };
}; //kjlkjkljkl

export const calculateWatchlist = (argv: Arguments) => {
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
  const watchlist: Watch[] = srcDestsPairs.map(getRelevantWatchlistInfo);

  //TODO: add step 10-12 later, as it's probably not needed
  //step 10: safe last time papapackage was running and check the last time every dependency has had changes in non-ignored folders
  //step 11: remove current dest/node_modules/dependency folder
  //step 12: copy src folder to dest/node_modules/dependency

  return watchlist;
};

export const logWatchlist = (watchlist: Watch[]) => {
  console.dir(
    watchlist.map((w) => ({
      src: w.src,
      dests: w.dests.map((dest) => dest.destinationFolder),
    })),
    { depth: 10 }
  );
};

const onlyCopyIfCurrentVersionIsLower =
  (version: string | undefined) => (object: WatchmanDest) => {
    return object.currentVersion && version
      ? isHigherVersion(version, object.currentVersion)
      : true;
  };

export const getRelevantPackageInfo = (path: string): Package | null => {
  let fileBuffer;
  try {
    fileBuffer = fs.readFileSync(path);
  } catch (e) {
    //can't find file
  }
  //@ts-ignore // why doesn't JSON know it can parse a buffer? Touche
  const json = fileBuffer ? JSON.parse(fileBuffer) : null;

  return json
    ? {
        path,
        name: json.name,
        version: json.version,
        private: json.private,
        author: json.author,
        dependencies: json.dependencies,
        devDependencies: json.devDependencies,
        peerDependencies: json.peerDependencies,
      }
    : null;
};

/**
 * is higher or the same version
 */
export const isHigherVersion = (x: string, y: string) => {
  const xArray = x.split(".");
  const yArray = y.split(".");
  const longest = Math.max(xArray.length, yArray.length);

  for (let n = 0; n < longest; n++) {
    if (xArray[n] === yArray[n]) {
      continue;
    }
    return xArray[n] > yArray[n];
  }
  return true;
};

export const keepHighestVersion = (packages: Package[], current: Package) => {
  const previous = packages.find((p) => p.name === current.name);

  return previous
    ? isHigherVersion(previous.version!, current.version!)
      ? packages //discard current because previous is higher
      : packages.filter((p) => p.name === previous.name).concat([current]) //discard previous and keep current because current is higher
    : packages.concat([current]); //there is no previous so just add the current
};

export const chooseFolder = (args: (string | number)[]) => {
  let folder = process.cwd();
  if (args[0]) {
    if (
      !fs.existsSync(String(args[0])) ||
      !fs.lstatSync(String(args[0])).isDirectory()
    ) {
      console.warn("Directory not found:", String(args[0]));
      process.exit(0);
    } else {
      folder = String(args[0]);
    }
  }
  return folder;
};

export function unique<T>(a: T[], getId: (a: T) => string): T[] {
  var seen: { [key: string]: 1 } = {};
  var out = [];
  var len = a.length;
  var j = 0;

  for (var i = 0; i < len; i++) {
    var item = a[i];
    if (seen[getId(item)] !== 1) {
      seen[getId(item)] = 1;
      out[j++] = item;
    }
  }
  return out;
}

export const getDependenciesList = (
  concatDependencies: string[],
  p: Package
) => {
  const dependencies = p.dependencies ? Object.keys(p.dependencies) : [];
  const devDependencies = p.devDependencies
    ? Object.keys(p.devDependencies)
    : [];
  const peerDependencies = p.peerDependencies
    ? Object.keys(p.peerDependencies)
    : [];
  return [
    ...concatDependencies,
    ...dependencies,
    ...devDependencies,
    ...peerDependencies,
  ];
};

export const getFolder = (path: string) => {
  const folders = path.split("/");
  folders.pop();
  return folders.join("/");
};
