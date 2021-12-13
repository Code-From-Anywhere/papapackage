"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ignore = ["node_modules", ".git"];
const match = "package.json";
function searchRecursiveSync(dir) {
    const files = fs_1.default.readdirSync(dir, { withFileTypes: true });
    return files
        .filter((file) => !ignore.includes(file.name))
        .map((file) => {
        if (file.isDirectory()) {
            return searchRecursiveSync(path_1.default.join(dir, file.name));
        }
        else {
            return file.name === match ? path_1.default.join(dir, file.name) : null;
        }
    })
        .reduce((previous, current) => {
        const newArray = Array.isArray(current)
            ? [...previous, ...current]
            : current !== null
                ? [...previous, current]
                : previous;
        return newArray;
    }, []);
}
const getRelevantPackageInfo = (path) => {
    const fileBuffer = fs_1.default.readFileSync(path);
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
const isHigherVersion = (x, y) => {
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
const keepHighestVersion = (packages, current) => {
    const previous = packages.find((p) => p.name === current.name);
    return previous
        ? isHigherVersion(previous.version, current.version)
            ? packages //discard current because previous is higher
            : packages.filter((p) => p.name === previous.name).concat([current]) //discard previous and keep current because current is higher
        : packages.concat([current]); //there is no previous so just add the current
};
const chooseFolder = (args) => {
    let folder = process.cwd();
    if (args[0]) {
        if (!fs_1.default.existsSync(String(args[0])) ||
            !fs_1.default.lstatSync(String(args[0])).isDirectory()) {
            console.warn("Directory not found:", String(args[0]));
            process.exit(0);
        }
        else {
            folder = String(args[0]);
        }
    }
    return folder;
};
const removeInvalidPackages = (pkg) => {
    return pkg.name && pkg.version;
};
function uniqueStrings(a) {
    var seen = {};
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
const getDependenciesList = (allDependencies, p) => {
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
const handler = (argv) => {
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
    const allDependencies = uniqueStrings(packages.reduce(getDependenciesList, []));
    const dependencyPackages = packages
        .filter((p) => allDependencies.includes(p.name))
        .reduce(keepHighestVersion, []);
    if (debug) {
        console.log("Done", packages.length, packages.map((p) => p.name));
        console.dir(allDependencies, { maxArrayLength: null });
    }
    console.log(dependencyPackages.map((p) => p.path));
    const dependencyPackagesNames = dependencyPackages.map((p) => p.name);
    const dependentPackages = packages
        .map((p) => {
        return {
            package: p,
            dependencies: uniqueStrings(getDependenciesList([], p)).filter((dependency) => dependencyPackagesNames.includes(dependency)),
        };
    })
        .filter((res) => res.dependencies.length > 0);
    console.log(dependentPackages.map((pd) => ({
        package: pd.package.path,
        dependencies: pd.dependencies,
    })));
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
exports.handler = handler;
