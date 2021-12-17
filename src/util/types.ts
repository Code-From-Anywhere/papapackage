export type HomogeneousObject<T> = {
  [key: string]: T;
};

export type PackageObject = HomogeneousObject<string>;

export type Package = {
  path: string;
  name?: string;
  version?: string;
  private?: boolean;
  author?: string;
  dependencies?: PackageObject;
  devDependencies?: PackageObject;
  peerDependencies?: PackageObject;
};

export type WatchmanDest = {
  currentPackageJsonPath?: string;
  currentVersion?: string;
  destinationFolder: string;
};

export type Watch = {
  src: string;
  dests: {
    destinationFolder: string;
    dependencyName: string;
  }[];
};

export type FileType = {
  // ["name", "size", "mtime_ms", "exists", "type"]
  name: string;
  size: number;
  mtime_ms: number;
  exists: boolean;
  type: string;
};
