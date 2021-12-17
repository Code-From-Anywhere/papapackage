"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFolder = exports.getDependenciesList = exports.unique = exports.chooseFolder = exports.keepHighestVersion = exports.isHigherVersion = exports.getRelevantPackageInfo = exports.logWatchlist = exports.calculateWatchlist = exports.getRelevantWatchlistInfo = exports.findPackageDependencyPair = exports.searchRecursiveSync = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
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
const calculateWatchlist = (argv) => {
    const command = argv.$0;
    const args = argv._;
    const debug = args[1];
    //step 1: get the folder to run this command from
    const folder = (0, exports.chooseFolder)(args);
    //step 2: recursively search all directories except for certain ignored directories for package.json files
    const ignore = ["node_modules", ".git"];
    const match = "package.json";
    const files = searchRecursiveSync(folder, ignore, match);
    //step 3: now that we got all package.json's, fetch their data
    const packages = files
        .map(exports.getRelevantPackageInfo)
        .filter(Boolean);
    //step 4: get all dependencies of all packages
    const depList = packages.reduce(exports.getDependenciesList, []);
    const allDependencies = unique(depList, String);
    //step 5: search for packages that are included in all dependencies and only keep their highest version
    const dependencyPackages = packages.filter((p) => p.name && allDependencies.includes(p.name));
    if (debug) {
        console.log({ files, packagesLength: packages.length });
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
    //step 8: find all dests for one src, for all unique src's
    const srcDestsPairs = unique(srcDestPairs, (srcDestPair) => srcDestPair.src.path).map(({ src }) => {
        return {
            src,
            dests: srcDestPairs
                .filter((srcDest) => srcDest.src.name === src.name)
                .map((srcDest) => srcDest.dest),
        };
    });
    //step 9: we just need the folders
    const watchlist = srcDestsPairs.map(exports.getRelevantWatchlistInfo);
    //TODO: add step 10-12 later, as it's probably not needed
    //step 10: safe last time papapackage was running and check the last time every dependency has had changes in non-ignored folders
    //step 11: remove current dest/node_modules/dependency folder
    //step 12: copy src folder to dest/node_modules/dependency
    return watchlist;
};
exports.calculateWatchlist = calculateWatchlist;
const logWatchlist = (watchlist) => {
    console.dir(watchlist.map((w) => ({
        src: w.src,
        dests: w.dests.map((dest) => dest.destinationFolder),
    })), { depth: 10 });
};
exports.logWatchlist = logWatchlist;
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
