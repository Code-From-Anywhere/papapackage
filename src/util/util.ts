import fs, { link } from "fs";
import path from "path";
import { Arguments } from "yargs";
import { IGNORE_DIRS, MATCH_FILE } from "./constants";
import type {
  Package,
  WatchmanDest,
  Watch,
  ProjectType,
  LinkingStrategy,
  Link,
  SrcDestsPackagePair,
  Todo,
  LinkingCli,
} from "./types";
import { exec, execSync } from "child_process";

export const hasDependency = (packageJson: Package, dependency: string) => {
  return getAllPackageJsonDependencies(packageJson).includes(dependency);
};

export const getProjectType = (packageJson: any): ProjectType => {
  const hasNext = hasDependency(packageJson, "next");
  const hasExpo = hasDependency(packageJson, "expo");
  const hasReactNative = hasDependency(packageJson, "react-native");
  const hasReact = hasDependency(packageJson, "react");
  const hasExpress = hasDependency(packageJson, "express");

  return hasNext
    ? "next"
    : hasExpo || hasReactNative
    ? "react-native"
    : hasReact
    ? "react"
    : hasExpress
    ? "express"
    : "unknown";
};
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
      dependencies: unique(getAllPackageJsonDependencies(p), String).filter(
        (dependency) => dependencyPackagesNames.includes(dependency)
      ),
    };
  };

export const getLinkingStrategy = (type?: ProjectType): LinkingStrategy => {
  const linkTypes: ProjectType[] = ["next", "react"];

  return type && linkTypes.includes(type) ? "link" : "copy";
};

export const getRelevantWatchlistInfo = (
  object: SrcDestsPackagePair
): Watch => {
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
      .filter((x) => getLinkingStrategy(x.currentPackageInfo?.type) === "copy")
      .map((p) => ({
        currentPackageJsonPath: p.currentPackageInfo?.path,
        currentVersion: p.currentPackageInfo?.version,
        destinationFolder: p.dest,
      }))
      //.filter(onlyCopyIfCurrentVersionIsLower(version)) //TODO: This creates a bug!
      .map((watchmanDest) => ({
        destinationFolder: watchmanDest.destinationFolder,
        dependencyName: name,
      })),
  };
}; //kjlkjkljkl

export const getPackages = (args: (string | number)[]) => {
  //step 1: get the folder to run this command from
  const folder = chooseFolder(args);

  //step 2: recursively search all directories except for certain ignored directories for package.json files
  const files = searchRecursiveSync(folder, IGNORE_DIRS, MATCH_FILE);

  //step 3: now that we got all package.json's, fetch their data
  const packages = files
    .map(getRelevantPackageInfo)
    .filter(Boolean) as Package[];

  return { files, packages };
};

export const getSrcDestsPairs = (argv: Arguments) => {
  const command = argv.$0;
  const args = argv._;
  const debug = args[1];

  console.log({ command, debug });
  //step 1-3
  const { files, packages } = getPackages(args);

  //step 4: get all dependencies of all packages
  const depList = packages.reduce(getDependenciesList, []);
  const allDependencies = unique(depList, String);

  //step 5: search for packages that are included in all dependencies and only keep their highest version
  const dependencyPackages = packages.filter(
    (p) => p.name && allDependencies.includes(p.name)
  );

  if (debug) {
    console.log({ files });
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

  const uniqueSources = unique(
    srcDestPairs,
    (srcDestPair) => srcDestPair.src.path
  ).map((sd) => sd.src);

  //step 8: find all dests for one src, for all unique src's
  const srcDestsPairs: SrcDestsPackagePair[] = uniqueSources.map((src) => {
    const dests = srcDestPairs
      .filter((srcDest) => srcDest.src.name === src.name)
      .map((srcDest) => srcDest.dest);

    return {
      src,
      dests,
    };
  });

  if (debug) {
    console.log("SRCDEST & SRCDESTS");
    console.dir(
      {
        srcDestPairs: srcDestPairs.map((sd) => ({
          src: sd.src.path,
          dest: sd.dest.path,
        })),

        srcDestsPairs: srcDestsPairs.map((sd) => ({
          src: sd.src.path,
          dests: sd.dests.map((d) => d.path),
        })),
      },
      { depth: 999 }
    );
  }

  return srcDestsPairs;
};

export const getRelevantLinkingInfo = (
  packagePair: SrcDestsPackagePair
): Link | null => {
  const dependencyName = packagePair.src.name;
  return dependencyName
    ? {
        src: getFolder(packagePair.src.path),
        dests: packagePair.dests
          .filter((dest) => getLinkingStrategy(dest.type) === "link")
          .map((dest) => ({
            destinationFolder: getFolder(dest.path),
            dependencyName,
          })),
      }
    : null;
};

export function notEmpty<TValue>(
  value: TValue | null | undefined
): value is TValue {
  return value !== null && value !== undefined;
}

export const calculateTodo = (argv: Arguments): Todo => {
  const srcDestsPairs = getSrcDestsPairs(argv);

  //step 9: we just need the folders
  const watchlist: Watch[] = srcDestsPairs
    .map(getRelevantWatchlistInfo)
    .filter((x) => x.dests.length !== 0);
  const linklist: Link[] = srcDestsPairs
    .map(getRelevantLinkingInfo)
    .filter(notEmpty)
    .filter((x) => x.dests.length !== 0);

  //TODO: add step 10-12 later, as it's probably not needed
  //step 10: safe last time papapackage was running and check the last time every dependency has had changes in non-ignored folders
  //step 11: remove current dest/node_modules/dependency folder
  //step 12: copy src folder to dest/node_modules/dependency

  return { watchlist, linklist };
};

export const linkLinklist = (linklist: Link[], cli: LinkingCli): void => {
  const commands = linklist.reduce((commands, link) => {
    return [
      ...commands,
      `cd ${link.src} && ${cli} link`,
      ...link.dests.map(
        (dest) =>
          `cd ${dest.destinationFolder} && ${cli} link ${dest.dependencyName}`
      ),
    ];
  }, [] as string[]);

  commands.forEach((command) => {
    const result = execSync(command);
    console.log({ result: result.toString("utf-8") });
  });
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

export const logLinklist = (linklist: Link[]) => {
  console.dir(
    linklist.map((l) => ({
      src: l.src,
      dests: l.dests,
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
        type: getProjectType(json),
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

export const getAllPackageJsonDependencies = (p: Package): string[] => {
  const dependencies = p.dependencies ? Object.keys(p.dependencies) : [];
  const devDependencies = p.devDependencies
    ? Object.keys(p.devDependencies)
    : [];
  const peerDependencies = p.peerDependencies
    ? Object.keys(p.peerDependencies)
    : [];

  return [...dependencies, ...devDependencies, ...peerDependencies];
};

export const getDependenciesList = (
  concatDependencies: string[],
  p: Package
): string[] => {
  return [...concatDependencies, ...getAllPackageJsonDependencies(p)];
};

export const getFolder = (path: string) => {
  const folders = path.split("/");
  folders.pop();
  return folders.join("/");
};
