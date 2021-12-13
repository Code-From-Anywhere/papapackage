import type { Arguments, CommandBuilder } from "yargs";
import fs from "fs";
import path from "path";

type PackageObject = {
  [key: string]: string;
};

type Package = {
  path: string;
  name?: string;
  version?: string;
  private?: boolean;
  author?: string;
  dependencies?: PackageObject;
  devDependencies: PackageObject;
  peerDependencies: PackageObject;
};

const ignore = ["node_modules", ".git"];
const match = "package.json";
function searchRecursiveSync(dir: string): string[] {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  return files
    .filter((file) => !ignore.includes(file.name))
    .map((file) => {
      if (file.isDirectory()) {
        return searchRecursiveSync(path.join(dir, file.name));
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

const getRelevantPackageInfo = (path: string): Package => {
  const fileBuffer = fs.readFileSync(path);
  //@ts-ignore
  const json = JSON.parse(fileBuffer);

  return {
    path,
    name: json.name,
    version: json.version,
    private: json.private,
    author: json.author,
    dependencies: json.dependencies,
    devDependencies: json.devDependencies,
    peerDependencies: json.peerDependencies,
  };
};

const isHigherVersion = (x: string, y: string) => {
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

const keepHighestVersion = (packages: Package[], current: Package) => {
  const previous = packages.find((p) => p.name === current.name);

  return previous
    ? isHigherVersion(previous.version!, current.version!)
      ? packages //discard current because previous is higher
      : packages.filter((p) => p.name === previous.name).concat([current]) //discard previous and keep current because current is higher
    : packages.concat([current]); //there is no previous so just add the current
};

const chooseFolder = (args: (string | number)[]) => {
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

const removeInvalidPackages = (pkg: Package) => {
  return pkg.name && pkg.version;
};

function uniqueStrings(a: string[]): string[] {
  var seen: { [key: string]: 1 } = {};
  var out = [];
  var len = a.length;
  var j = 0;

  for (var i = 0; i < len; i++) {
    var item = a[i];
    if (seen[item] !== 1) {
      seen[item] = 1;
      out[j++] = item;
    }
  }
  return out;
}

const getDependenciesList = (allDependencies: string[], p: Package) => {
  const dependencies = p.dependencies ? Object.keys(p.dependencies) : [];
  const devDependencies = p.devDependencies
    ? Object.keys(p.devDependencies)
    : [];
  const peerDependencies = p.peerDependencies
    ? Object.keys(p.peerDependencies)
    : [];
  return [
    ...allDependencies,
    ...dependencies,
    ...devDependencies,
    ...peerDependencies,
  ];
};

export const handler = (argv: Arguments): void => {
  const command = argv.$0;
  const args = argv._;
  const debug = args[1];
  //step 1: get the folder to run this command from
  const folder = chooseFolder(args);

  //step 2: recursively search all directories except for certain ignored directories for package.json files
  const files = searchRecursiveSync(folder);

  const packages = files
    .map(getRelevantPackageInfo)
    .filter(removeInvalidPackages);

  const allDependencies = uniqueStrings(
    packages.reduce(getDependenciesList, [])
  );

  const dependencyPackages = packages
    .filter((p) => allDependencies.includes(p.name!))
    .reduce(keepHighestVersion, []);

  if (debug) {
    console.log(
      "Done",
      packages.length,
      packages.map((p) => p.name)
    );

    console.dir(allDependencies, { maxArrayLength: null });
  }

  console.log(dependencyPackages.map((p) => p.path));

  const dependencyPackagesNames = dependencyPackages.map((p) => p.name);

  const dependentPackages = packages
    .map((p) => {
      return {
        package: p,
        dependencies: uniqueStrings(getDependenciesList([], p)).filter(
          (dependency) => dependencyPackagesNames.includes(dependency)
        ),
      };
    })
    .filter((res) => res.dependencies.length > 0);

  console.log(
    dependentPackages.map((pd) => ({
      package: pd.package.path,
      dependencies: pd.dependencies,
    }))
  );

  /*
  GREAT START!

  However, I need something like this:

  {
    [path]: dependents[]
  }

  Because then, I can just create a dryduck.json based on these files (or include a similar script into papapackage)

  */

  process.exit(0);
};
