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
