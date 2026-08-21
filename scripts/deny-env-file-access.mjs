import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

function isEnvironmentFile(filePath) {
  if (typeof filePath !== "string" && !Buffer.isBuffer(filePath)) {
    return false;
  }
  const basename = path.basename(String(filePath));
  return basename.startsWith(".env");
}

function deniedError(filePath) {
  const error = new Error("Environment file access is disabled for this command.");
  error.code = "ENOENT";
  error.path = String(filePath);
  return error;
}

function emptyFileContent(options) {
  const encoding =
    typeof options === "string"
      ? options
      : options && typeof options === "object"
        ? options.encoding
        : null;
  return encoding ? "" : Buffer.alloc(0);
}

const originalExistsSync = fs.existsSync;
fs.existsSync = function guardedExistsSync(filePath) {
  return isEnvironmentFile(filePath)
    ? false
    : originalExistsSync.call(this, filePath);
};

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function guardedReadFileSync(filePath, ...args) {
  if (isEnvironmentFile(filePath)) return emptyFileContent(args[0]);
  return originalReadFileSync.call(this, filePath, ...args);
};

const originalOpenSync = fs.openSync;
fs.openSync = function guardedOpenSync(filePath, ...args) {
  if (isEnvironmentFile(filePath)) throw deniedError(filePath);
  return originalOpenSync.call(this, filePath, ...args);
};

const originalReadFile = fs.readFile;
fs.readFile = function guardedReadFile(filePath, ...args) {
  if (!isEnvironmentFile(filePath)) {
    return originalReadFile.call(this, filePath, ...args);
  }
  const callback = args.at(-1);
  if (typeof callback !== "function") throw deniedError(filePath);
  const options = args.length > 1 ? args[0] : undefined;
  queueMicrotask(() => callback(null, emptyFileContent(options)));
  return undefined;
};

const originalOpen = fs.open;
fs.open = function guardedOpen(filePath, ...args) {
  if (!isEnvironmentFile(filePath)) {
    return originalOpen.call(this, filePath, ...args);
  }
  const callback = args.at(-1);
  if (typeof callback === "function") {
    queueMicrotask(() => callback(deniedError(filePath)));
    return undefined;
  }
  throw deniedError(filePath);
};

const originalPromiseReadFile = fs.promises.readFile.bind(fs.promises);
fs.promises.readFile = async function guardedPromiseReadFile(
  filePath,
  ...args
) {
  if (isEnvironmentFile(filePath)) return emptyFileContent(args[0]);
  return originalPromiseReadFile(filePath, ...args);
};

const originalPromiseOpen = fs.promises.open.bind(fs.promises);
fs.promises.open = async function guardedPromiseOpen(filePath, ...args) {
  if (isEnvironmentFile(filePath)) throw deniedError(filePath);
  return originalPromiseOpen(filePath, ...args);
};

syncBuiltinESMExports();
