const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const env = { ...process.env };
const localTools = path.resolve(__dirname, "..", ".toolchains");
if (!env.CARGO_HOME && fs.existsSync(path.join(localTools, "cargo", "bin", "cargo"))) {
  env.CARGO_HOME = path.join(localTools, "cargo");
  env.RUSTUP_HOME = path.join(localTools, "rustup");
  env.PATH = `${env.CARGO_HOME}/bin:${env.PATH}`;
}
if (!env.ANDROID_HOME && process.platform === "darwin") {
  const sdk = path.join(require("os").homedir(), "Library", "Android", "sdk");
  if (fs.existsSync(sdk)) env.ANDROID_HOME = sdk;
}
if (!env.NDK_HOME && !env.ANDROID_NDK_HOME && env.ANDROID_HOME) {
  const ndks = path.join(env.ANDROID_HOME, "ndk");
  if (fs.existsSync(ndks)) {
    const versions = fs.readdirSync(ndks).filter(name => /^\d+\.\d+\.\d+$/.test(name)).sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
    if (versions.length) env.NDK_HOME = path.join(ndks, versions[versions.length-1]);
  }
}

// If JAVA_HOME is not explicitly set to a valid JDK or points to an incompatible version (like Java 26+),
// automatically discover and use installed OpenJDK 21 or 17.
const candidateJdkPaths = [
  "/opt/homebrew/opt/openjdk@21",
  "/opt/homebrew/opt/openjdk@17",
  "/usr/local/opt/openjdk@21",
  "/usr/local/opt/openjdk@17",
  "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home",
  "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home",
];

if (!env.JAVA_HOME) {
  for (const candidate of candidateJdkPaths) {
    if (fs.existsSync(candidate)) {
      env.JAVA_HOME = candidate;
      env.PATH = `${candidate}/bin:${env.PATH}`;
      break;
    }
  }
}

// Autoconf dependencies such as libsodium do not consume Tauri's TARGET_AR.
// On macOS the system ar can silently produce an empty archive from ELF objects.
// Always use the Android LLVM archiver and indexer for Android builds.
const ndkHome = env.NDK_HOME || env.ANDROID_NDK_HOME;
if (ndkHome && process.platform !== "win32") {
  const host = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  const ndkBin = path.join(ndkHome, "toolchains", "llvm", "prebuilt", host, "bin");
  for (const [variable, binary] of [["AR", "llvm-ar"], ["RANLIB", "llvm-ranlib"]]) {
    const executable = path.join(ndkBin, binary);
    if (fs.existsSync(executable)) env[variable] = executable;
  }
}

const args = process.argv.slice(2);
const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(cmd, ["tauri", "android", ...args], {
  stdio: "inherit",
  env,
});

if (result.status === 0 && args[0] === "build" && ndkHome && process.platform !== "win32") {
  const host = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  const nm = path.join(ndkHome, "toolchains", "llvm", "prebuilt", host, "bin", "llvm-nm");
  const target = path.resolve(__dirname, "..", "src-tauri", "target");
  for (const architecture of ["aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android"]) {
    const library = path.join(target, architecture, args.includes("--debug") ? "debug" : "release", "libteledrive_lib.so");
    if (!fs.existsSync(library)) continue;
    const symbols = spawnSync(nm, ["-D", "--undefined-only", library], {encoding:"utf8"});
    if (symbols.status !== 0 || /\b(sodium_|randombytes_)/.test(symbols.stdout ?? "")) {
      console.error("Android validation failed: unresolved cryptography symbols in " + architecture);
      process.exit(1);
    }
  }
}
process.exit(result.status ?? 1);
