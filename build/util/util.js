"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFolder = exports.getDependenciesList = exports.unique = exports.chooseFolder = exports.keepHighestVersion = exports.isHigherVersion = exports.getRelevantPackageInfo = exports.getRelevantWatchlistInfo = exports.findPackageDependencyPair = exports.searchRecursiveSync = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function searchRecursiveSync(dir, ignore, match) {
    const files = fs_1.default.readdirSync(dir, { withFileTypes: true });
    return files
        .filter((file) => !ignore.includes(file.name))
        .map((file) => {
        if (file.isDirectory()) {
            return searchRecursiveSync(path_1.default.join(dir, file.name), ignore, match);
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
exports.searchRecursiveSync = searchRecursiveSync;
const findPackageDependencyPair = (dependencyPackagesNames) => (p) => {
    return {
        package: p,
        dependencies: unique((0, exports.getDependenciesList)([], p), String).filter((dependency) => dependencyPackagesNames.includes(dependency)),
    };
};
exports.findPackageDependencyPair = findPackageDependencyPair;
const getRelevantWatchlistInfo = (object) => {
    const dests = object.dests.map((dest) => (0, exports.getFolder)(dest.path));
    const name = object.src.name;
    const version = object.src.version;
    const destPackages = dests.map((dest) => {
        return {
            dest,
            currentPackageInfo: (0, exports.getRelevantPackageInfo)(path_1.default.join(dest, "node_modules", name, "package.json")),
        };
    });
    return {
        src: (0, exports.getFolder)(object.src.path),
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
exports.getRelevantWatchlistInfo = getRelevantWatchlistInfo;
const onlyCopyIfCurrentVersionIsLower = (version) => (object) => {
    return object.currentVersion && version
        ? (0, exports.isHigherVersion)(version, object.currentVersion)
        : true;
};
const getRelevantPackageInfo = (path) => {
    let fileBuffer;
    try {
        fileBuffer = fs_1.default.readFileSync(path);
    }
    catch (e) {
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
exports.getRelevantPackageInfo = getRelevantPackageInfo;
/**
 * is higher or the same version
 */
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
exports.isHigherVersion = isHigherVersion;
const keepHighestVersion = (packages, current) => {
    const previous = packages.find((p) => p.name === current.name);
    return previous
        ? (0, exports.isHigherVersion)(previous.version, current.version)
            ? packages //discard current because previous is higher
            : packages.filter((p) => p.name === previous.name).concat([current]) //discard previous and keep current because current is higher
        : packages.concat([current]); //there is no previous so just add the current
};
exports.keepHighestVersion = keepHighestVersion;
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
exports.chooseFolder = chooseFolder;
function unique(a, getId) {
    var seen = {};
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
exports.unique = unique;
const getDependenciesList = (concatDependencies, p) => {
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
exports.getDependenciesList = getDependenciesList;
const getFolder = (path) => {
    const folders = path.split("/");
    folders.pop();
    return folders.join("/");
};
exports.getFolder = getFolder;
