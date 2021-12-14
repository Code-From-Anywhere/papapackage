import fs from "fs";
import path from "path";
import type { Package, WatchmanDest } from "./types";

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
}) => {
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
