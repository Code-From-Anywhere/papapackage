"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFolder = exports.getDependenciesList = exports.getAllPackageJsonDependencies = exports.unique = exports.chooseFolder = exports.keepHighestVersion = exports.isHigherVersion = exports.getRelevantPackageInfo = exports.logLinklist = exports.logWatchlist = exports.linkLinklist = exports.calculateTodo = exports.notEmpty = exports.getRelevantLinkingInfo = exports.getSrcDestsPairs = exports.getPackages = exports.getRelevantWatchlistInfo = exports.getLinkingStrategy = exports.findPackageDependencyPair = exports.searchRecursiveSync = exports.getProjectType = exports.hasDependency = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const child_process_1 = require("child_process");
const hasDependency = (packageJson, dependency) => {
    return (0, exports.getAllPackageJsonDependencies)(packageJson).includes(dependency);
};
exports.hasDependency = hasDependency;
const getProjectType = (packageJson) => {
    const hasNext = (0, exports.hasDependency)(packageJson, "next");
    const hasExpo = (0, exports.hasDependency)(packageJson, "expo");
    const hasReactNative = (0, exports.hasDependency)(packageJson, "react-native");
    const hasReact = (0, exports.hasDependency)(packageJson, "react");
    const hasExpress = (0, exports.hasDependency)(packageJson, "express");
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
exports.getProjectType = getProjectType;
/**
 * searches for a match (file) in a base dir, but ignores folders in {ignore}
 */
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
        dependencies: unique((0, exports.getAllPackageJsonDependencies)(p), String).filter((dependency) => dependencyPackagesNames.includes(dependency)),
    };
};
exports.findPackageDependencyPair = findPackageDependencyPair;
const getLinkingStrategy = (type) => {
    const linkTypes = ["next", "react"];
    return type && linkTypes.includes(type) ? "link" : "copy";
};
exports.getLinkingStrategy = getLinkingStrategy;
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
    //
    return {
        src: (0, exports.getFolder)(object.src.path),
        dests: destPackages
            .filter((x) => (0, exports.getLinkingStrategy)(x.currentPackageInfo?.type) === "copy")
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
};
exports.getRelevantWatchlistInfo = getRelevantWatchlistInfo;
const getPackages = (args) => {
    //step 1: get the folder to run this command from
    const folder = (0, exports.chooseFolder)(args);
    //step 2: recursively search all directories except for certain ignored directories for package.json files
    const files = searchRecursiveSync(folder, constants_1.IGNORE_DIRS, constants_1.MATCH_FILE);
    //step 3: now that we got all package.json's, fetch their data
    const packages = files
        .map(exports.getRelevantPackageInfo)
        .filter(Boolean);
    return { files, packages };
};
exports.getPackages = getPackages;
const getSrcDestsPairs = (argv) => {
    const command = argv.$0;
    const args = argv._;
    const debug = args[1];
    console.log({ command, debug });
    //step 1-3
    const { files, packages } = (0, exports.getPackages)(args);
    //step 4: get all dependencies of all packages
    const depList = packages.reduce(exports.getDependenciesList, []);
    const allDependencies = unique(depList, String);
    //step 5: search for packages that are included in all dependencies and only keep their highest version
    const dependencyPackages = packages.filter((p) => p.name && allDependencies.includes(p.name));
    if (debug) {
        console.log({ files });
        //console.dir(allDependencies, { maxArrayLength: null });
        console.log(dependencyPackages.map((p) => p.name));
    }
    //step 6: find dependencies for all packages
    const dependencyPackagesNames = dependencyPackages.map((p) => p.name);
    const dependentPackages = packages
        .map((0, exports.findPackageDependencyPair)(dependencyPackagesNames))
        .filter((res) => res.dependencies.length > 0);
    //step 7: find srcDestPairs
    const srcDestPairs = dependentPackages
        .map((dp) => {
        const dest = dp.package;
        const watchlistPartly = dp.dependencies.map((dependency) => ({
            src: dependencyPackages.find((p) => p.name === dependency),
            //.reduce(keepHighestVersion, [])[0],
            dest,
        }));
        return watchlistPartly;
    })
        .reduce((previous, current) => {
        return [...previous, ...current];
    }, []);
    const uniqueSources = unique(srcDestPairs, (srcDestPair) => srcDestPair.src.path).map((sd) => sd.src);
    //step 8: find all dests for one src, for all unique src's
    const srcDestsPairs = uniqueSources.map((src) => {
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
        console.dir({
            srcDestPairs: srcDestPairs.map((sd) => ({
                src: sd.src.path,
                dest: sd.dest.path,
            })),
            srcDestsPairs: srcDestsPairs.map((sd) => ({
                src: sd.src.path,
                dests: sd.dests.map((d) => d.path),
            })),
        }, { depth: 999 });
    }
    return srcDestsPairs;
};
exports.getSrcDestsPairs = getSrcDestsPairs;
const getRelevantLinkingInfo = (packagePair) => {
    const dependencyName = packagePair.src.name;
    return dependencyName
        ? {
            src: (0, exports.getFolder)(packagePair.src.path),
            dests: packagePair.dests
                .filter((dest) => (0, exports.getLinkingStrategy)(dest.type) === "link")
                .map((dest) => ({
                destinationFolder: (0, exports.getFolder)(dest.path),
                dependencyName,
            })),
        }
        : null;
};
exports.getRelevantLinkingInfo = getRelevantLinkingInfo;
function notEmpty(value) {
    return value !== null && value !== undefined;
}
exports.notEmpty = notEmpty;
const calculateTodo = (argv) => {
    const srcDestsPairs = (0, exports.getSrcDestsPairs)(argv);
    //step 9: we just need the folders
    const watchlist = srcDestsPairs
        .map(exports.getRelevantWatchlistInfo)
        .filter((x) => x.dests.length !== 0);
    const linklist = srcDestsPairs
        .map(exports.getRelevantLinkingInfo)
        .filter(notEmpty)
        .filter((x) => x.dests.length !== 0);
    //TODO: add step 10-12 later, as it's probably not needed
    //step 10: safe last time papapackage was running and check the last time every dependency has had changes in non-ignored folders
    //step 11: remove current dest/node_modules/dependency folder
    //step 12: copy src folder to dest/node_modules/dependency
    return { watchlist, linklist };
};
exports.calculateTodo = calculateTodo;
const linkLinklist = (linklist, cli) => {
    const commands = linklist.reduce((commands, link) => {
        return [
            ...commands,
            `cd ${link.src} && ${cli} link`,
            ...link.dests.map((dest) => `cd ${dest.destinationFolder} && ${cli} link ${dest.dependencyName}`),
        ];
    }, []);
    commands.forEach((command) => {
        const result = (0, child_process_1.execSync)(command);
        console.log({ result: result.toString("utf-8") });
    });
};
exports.linkLinklist = linkLinklist;
const logWatchlist = (watchlist) => {
    console.dir(watchlist.map((w) => ({
        src: w.src,
        dests: w.dests.map((dest) => dest.destinationFolder),
    })), { depth: 10 });
};
exports.logWatchlist = logWatchlist;
const logLinklist = (linklist) => {
    console.dir(linklist.map((l) => ({
        src: l.src,
        dests: l.dests,
    })), { depth: 10 });
};
exports.logLinklist = logLinklist;
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
            type: (0, exports.getProjectType)(json),
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
const getAllPackageJsonDependencies = (p) => {
    const dependencies = p.dependencies ? Object.keys(p.dependencies) : [];
    const devDependencies = p.devDependencies
        ? Object.keys(p.devDependencies)
        : [];
    const peerDependencies = p.peerDependencies
        ? Object.keys(p.peerDependencies)
        : [];
    return [...dependencies, ...devDependencies, ...peerDependencies];
};
exports.getAllPackageJsonDependencies = getAllPackageJsonDependencies;
const getDependenciesList = (concatDependencies, p) => {
    return [...concatDependencies, ...(0, exports.getAllPackageJsonDependencies)(p)];
};
exports.getDependenciesList = getDependenciesList;
const getFolder = (path) => {
    const folders = path.split("/");
    folders.pop();
    return folders.join("/");
};
exports.getFolder = getFolder;
