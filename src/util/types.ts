export type HomogeneousObject<T> = {
  [key: string]: T;
};

export type PackageObject = HomogeneousObject<string>;

export type Package = {
  path: string;
  name?: string;
  type: ProjectType;
  version?: string;
  private?: boolean;
  author?: string;
  dependencies?: PackageObject;
  devDependencies?: PackageObject;
  peerDependencies?: PackageObject;
};

export type LinkingStrategy = "copy" | "link";

export type SrcDestsPackagePair = {
  src: Package;
  dests: Package[];
};

export type ProjectType =
  | "next"
  | "react-native"
  | "react"
  | "express"
  | "unknown";

export type LinkingCli = "yarn" | "npm";

export type WatchmanDest = {
  currentPackageJsonPath?: string;
  currentVersion?: string;
  destinationFolder: string;
};

export type Todo = {
  watchlist: Watch[];
  linklist: Link[];
};

export type Watch = {
  src: FolderPathString;
  dests: {
    destinationFolder: FolderPathString;
    dependencyName: string;
  }[];
};

export type FolderPathString = string;

export type Link = {
  src: FolderPathString;
  dests: { destinationFolder: FolderPathString; dependencyName: string }[];
};

export type FileType = {
  // ["name", "size", "mtime_ms", "exists", "type"]
  name: string;
  size: number;
  mtime_ms: number;
  exists: boolean;
  type: string;
};
