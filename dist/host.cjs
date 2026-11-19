"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/magpie/loopback.cjs
var require_loopback = __commonJS({
  "src/magpie/loopback.cjs"(exports2, module2) {
    var { request } = require("node:http");
    var responseLimit = 8 * 1024 * 1024;
    function loopback2(url, { method = "GET", headers, body, timeoutMs = 4500 } = {}) {
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) {
        throw new Error("远端操作只能访问 HTTP 回环服务");
      }
      return new Promise((resolve, reject) => {
        const outgoing = request(url, {
          method,
          headers,
          agent: false,
          signal: AbortSignal.timeout(timeoutMs)
        }, async (incoming) => {
          try {
            if (incoming.statusCode < 200 || incoming.statusCode >= 300) {
              incoming.resume();
              resolve({ status: incoming.statusCode, headers: incoming.headers });
              return;
            }
            let size = 0;
            const chunks = [];
            for await (const chunk of incoming) {
              size += chunk.length;
              if (size > responseLimit) throw new Error("远端 HTTP 响应超过大小限制");
              chunks.push(chunk);
            }
            const text = Buffer.concat(chunks, size).toString("utf8");
            let data;
            if (text) {
              try {
                data = JSON.parse(text);
              } catch {
                throw new Error("远端 HTTP 服务未返回有效的 JSON");
              }
            }
            resolve({ status: incoming.statusCode, headers: incoming.headers, data });
          } catch (error) {
            reject(error);
          }
        });
        outgoing.once("error", reject);
        outgoing.end(body);
      });
    }
    module2.exports = { loopback: loopback2 };
  }
});

// src/runtime/magpie.cjs
var require_magpie = __commonJS({
  "src/runtime/magpie.cjs"(exports2, module2) {
    var { spawn: spawn2, spawnSync: spawnSync2 } = require("node:child_process");
    var { randomUUID: randomUUID2 } = require("node:crypto");
    var { mkdir, readFile, writeFile, rename, rm, chmod, stat } = require("node:fs/promises");
    var { homedir: homedir2 } = require("node:os");
    var { join: join2, isAbsolute } = require("node:path");
    var { setTimeout: pause2 } = require("node:timers/promises");
    var { loopback: loopback2 } = require_loopback();
    var version = "0.1.4539";
    var releases = {
      x64: "amd64",
      arm64: "arm64"
    };
    async function json(path) {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return {};
      }
    }
    function validPort(value) {
      return Number.isInteger(value) && value > 0 && value <= 65535;
    }
    async function configuredPort(override, fallback = 3425) {
      if (override !== void 0) {
        if (!validPort(override)) throw new Error("Magpie 端口须为 1–65535");
        return override;
      }
      const xdg = process.env.XDG_CONFIG_HOME;
      const directory = isAbsolute(xdg || "") ? xdg : join2(homedir2(), ".config");
      const settings = await json(join2(directory, "magpie", "settings.json"));
      return validPort(settings.port) ? settings.port : validPort(fallback) ? fallback : 3425;
    }
    async function probe(port) {
      try {
        const { status, data } = await loopback2(new URL("http://127.0.0.1:" + port + "/api/hello"), { timeoutMs: 1500 });
        if (status !== 200 || data?.name !== "magpie" || typeof data.version !== "string") {
          throw new Error("Magpie 端口被其他服务占用");
        }
        return data;
      } catch (error) {
        if (error.code === "ECONNREFUSED") return null;
        throw error;
      }
    }
    function execute2(bin, args, env = process.env) {
      return spawnSync2(bin, args, { env, encoding: "utf8", timeout: 6e3, stdio: ["ignore", "pipe", "pipe"] });
    }
    async function install(root2) {
      const release = releases[process.arch];
      if (!release) throw new Error("Magpie 自动安装支持 Linux amd64 和 arm64");
      const directory = join2(root2, "magpie-" + version);
      const bin = join2(directory, "magpie");
      try {
        await stat(bin);
        if (execute2(bin, ["--version"]).status === 0) return bin;
        throw new Error("Magpie 已安装文件无法运行，请配置 magpieBin 或修复运行时后重试");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const response = await fetch("https://github.com/yetone/magpie-releases/releases/download/v" + version + "/magpie-cli-linux-" + release, {
        signal: AbortSignal.timeout(9e4)
      });
      if (!response.ok) throw new Error("Magpie 下载失败（HTTP " + response.status + "），可配置 magpieBin 使用预装文件");
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 160 * 1024 * 1024) throw new Error("Magpie 下载超过大小限制");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      await mkdir(directory, { recursive: true, mode: 448 });
      const temporary = bin + "." + randomUUID2();
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 448 });
        await chmod(temporary, 448);
        await rename(temporary, bin);
      } finally {
        await rm(temporary, { force: true });
      }
      return bin;
    }
    async function prepareMagpie2(root2, settings, override) {
      if (settings.magpie === false) return { status: "disabled" };
      const previous = await json(join2(root2, "magpie-runtime.json"));
      const port = await configuredPort(override ?? settings.magpiePort, previous.port);
      const running = await probe(port);
      if (running) return { status: "ready", port, version: running.version, reused: true };
      const env = { ...process.env, PATH: [process.env.PATH, join2(homedir2(), ".local/bin")].filter(Boolean).join(":") };
      let bin = settings.magpieBin;
      if (bin !== void 0 && (typeof bin !== "string" || !isAbsolute(bin))) throw new Error("magpieBin 须为绝对路径");
      if (!bin) {
        const existing = execute2("magpie", ["--version"], env);
        bin = existing.status === 0 ? execute2("sh", ["-c", "command -v magpie"], env).stdout.trim() : await install(root2);
      }
      if (execute2(bin, ["--version"], env).status !== 0) throw new Error("Magpie 可执行文件无法运行");
      const state = join2(root2, "magpie-runtime.json");
      const temporary = state + "." + randomUUID2();
      try {
        await writeFile(temporary, JSON.stringify({ bin, port }) + "\n", { flag: "wx", mode: 384 });
        await rename(temporary, state);
      } finally {
        await rm(temporary, { force: true });
      }
      env.MAGPIE_ADDR = "127.0.0.1:" + port;
      const args = ["-n", "-F", join2(root2, "magpie.lock"), bin, "serve"];
      let started = false;
      if (execute2("systemctl", ["--user", "show-environment"]).status === 0) {
        started = execute2("systemd-run", [
          "--user",
          "--quiet",
          "--collect",
          "--unit=dsh-remote-magpie",
          "--property=Restart=on-failure",
          "--property=RestartSec=3",
          "--setenv=HOME=" + homedir2(),
          "--setenv=MAGPIE_ADDR=" + env.MAGPIE_ADDR,
          "--setenv=PATH=" + env.PATH,
          ...process.env.XDG_CONFIG_HOME ? ["--setenv=XDG_CONFIG_HOME=" + process.env.XDG_CONFIG_HOME] : [],
          "flock",
          ...args
        ], env).status === 0;
      }
      if (!started) {
        const child = spawn2("flock", args, { env, detached: true, stdio: "ignore" });
        await new Promise((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
      }
      for (let i = 0; i < 40; i++) {
        const ready = await probe(port);
        if (ready) return { status: "ready", port, version: ready.version, reused: false };
        await pause2(250);
      }
      throw new Error("Magpie 未就绪，请检查服务状态后重新连接");
    }
    module2.exports = { prepareMagpie: prepareMagpie2, configuredPort, probe, releases, version };
  }
});

// src/host.cjs
var { spawn, spawnSync } = require("node:child_process");
var { createInterface } = require("node:readline");
var { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require("node:fs");
var { homedir } = require("node:os");
var { basename, dirname, join } = require("node:path");
var { randomUUID } = require("node:crypto");
var { setTimeout: pause } = require("node:timers/promises");
var { loopback } = require_loopback();
var { prepareMagpie } = require_magpie();
var protocol = 1;
var dshVersion = "0.2.2-rc.1";
var pnpmVersion = "11.25.0";
var root = join(homedir(), ".local", "share", "dsh-remote");
var dshHome = join(root, "data");
var readyFile = join(root, "ready.json");
var runLock = join(root, "runtime.lock");
var dshLock = join(root, "dsh.lock");
var bootstrapLock = join(root, "bootstrap.lock");
var configFile = join(root, "config.json");
var unit = "dsh-remote-v1.service";
function writePrivate(path, value) {
  const temporary = path + "." + randomUUID();
  try {
    writeFileSync(temporary, JSON.stringify(value) + "\n", { flag: "wx", mode: 384 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function processStart(pid) {
  try {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] !== "Z") return fields[19];
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
  }
}
function execute(file, args, timeout) {
  return spawnSync(file, args, { timeout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function verifiedVersion(bin, version) {
  const result = execute(bin, ["--version"], 2e4);
  return result.status === 0 && result.stdout.trim() === version;
}
function configuredExecutable(bin, label, version) {
  if (typeof bin !== "string" || !bin.startsWith("/") || !verifiedVersion(bin, version) || label === "pnpm" && basename(bin) !== "pnpm") {
    throw new Error("config.json 的 " + label + "Bin 须指向可执行的 " + label + " " + version);
  }
  return bin;
}
function installTools(directory, packages) {
  const binPath = (prefix, bin) => join(prefix, "node_modules", ".bin", bin);
  const verified = (prefix) => packages.every(({ bin, version }) => verifiedVersion(binPath(prefix, bin), version));
  if (verified(directory)) return;
  if (statSync(directory, { throwIfNoEntry: false })) {
    throw new Error("运行时目录已存在但版本检查失败，请检查 " + directory);
  }
  const staging = join(root, "install-" + randomUUID());
  mkdirSync(staging, { mode: 448 });
  try {
    const result = execute("npm", [
      "install",
      "--prefix",
      staging,
      "--no-audit",
      "--no-fund",
      "--fetch-retries=0",
      "--fetch-timeout=25000",
      ...packages.map(({ name, version }) => name + "@" + version)
    ], 6e5);
    if (result.status !== 0 || !verified(staging)) {
      throw new Error("无法准备远端 DSH 或 pnpm，请检查 npm、网络和磁盘空间，或配置离线运行时路径");
    }
    renameSync(staging, directory);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
function prepareRuntime() {
  const settings = readJson(configFile) ?? {};
  const dshPackage = { name: "@deepseek-ai/dsh", bin: "dsh", version: dshVersion };
  const pnpmPackage = { name: "pnpm", bin: "pnpm", version: pnpmVersion };
  const parts = [
    ...settings.dshBin === void 0 ? ["dsh-" + dshVersion] : [],
    ...settings.pnpmBin === void 0 ? ["pnpm-" + pnpmVersion] : []
  ];
  const directory = join(root, "runtime-" + parts.join("-"));
  const dshBin = settings.dshBin === void 0 ? join(directory, "node_modules", ".bin", "dsh") : configuredExecutable(settings.dshBin, "dsh", dshVersion);
  const pnpmBin = settings.pnpmBin === void 0 ? join(directory, "node_modules", ".bin", "pnpm") : configuredExecutable(settings.pnpmBin, "pnpm", pnpmVersion);
  const missing = [
    ...settings.dshBin === void 0 ? [dshPackage] : [],
    ...settings.pnpmBin === void 0 ? [pnpmPackage] : []
  ];
  if (missing.length) installTools(directory, missing);
  return { dshBin, pnpmBin };
}
function isLocked(path) {
  const result = execute("flock", ["-n", "-E", "73", path, "true"], 4e3);
  if (result.status === 0) return false;
  if (result.status === 73) return true;
  throw new Error("远端无法获取运行锁，请检查 util-linux/flock 和数据目录权限");
}
function serve(bin, pnpmBin) {
  const instance = randomUUID();
  const child = spawn("flock", [
    "-n",
    "-F",
    dshLock,
    bin,
    "--profile",
    "web",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--no-open"
  ], {
    cwd: homedir(),
    env: {
      ...process.env,
      PATH: [dirname(process.execPath), dirname(pnpmBin), process.env.PATH || ""].join(":"),
      DSH_HOME: dshHome
    },
    stdio: ["ignore", "pipe", "ignore"]
  });
  const output = createInterface({ input: child.stdout });
  let stopping = false;
  let ready = false;
  let killTimer;
  function stop() {
    if (stopping) return;
    stopping = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 8e3);
    killTimer.unref();
  }
  const startupTimer = setTimeout(stop, 4e4);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  output.on("line", (line) => {
    if (ready || stopping || !line.startsWith("dsh web: http://127.0.0.1:")) return;
    try {
      const url = new URL(line.slice("dsh web: ".length));
      const token = url.searchParams.get("token");
      const childStart = processStart(child.pid);
      if (url.hostname !== "127.0.0.1" || !url.port || !token || !childStart) return;
      writePrivate(readyFile, {
        protocol,
        dshVersion,
        port: Number(url.port),
        token,
        instance,
        pid: process.pid,
        childPid: child.pid,
        childStart
      });
      ready = true;
      clearTimeout(startupTimer);
    } catch {
      stop();
    }
  });
  child.on("error", () => {
    clearTimeout(startupTimer);
    process.exitCode = 1;
  });
  child.on("close", () => {
    clearTimeout(startupTimer);
    clearTimeout(killTimer);
    if (readJson(readyFile)?.instance === instance) rmSync(readyFile, { force: true });
    process.exitCode = ready && stopping ? 0 : 1;
  });
}
async function currentEndpoint() {
  const record = readJson(readyFile);
  if (!record || record.protocol !== protocol || record.dshVersion !== dshVersion || typeof record.childStart !== "string" || processStart(record.childPid) !== record.childStart) return;
  const url = new URL("http://127.0.0.1:" + record.port + "/");
  url.searchParams.set("token", record.token);
  const response = await loopback(url, { timeoutMs: 1e3 }).catch(() => null);
  if (!response) return;
  if (response.status === 303 && response.headers["set-cookie"]) {
    const { port, token, instance } = record;
    return { protocol, dshVersion, port, token, instance };
  }
}
async function waitUntilReady() {
  const started = Date.now();
  while (Date.now() - started < 45e3) {
    const record = await currentEndpoint();
    if (record) return record;
    if (Date.now() - started > 6e3 && !isLocked(runLock) && !isLocked(dshLock)) break;
    await pause(250);
  }
  throw new Error("远端 DSH Host 未就绪，请检查远端 DSH Web 配置、Node 版本及用户服务状态");
}
function start({ dshBin, pnpmBin }) {
  const args = ["-n", "-F", runLock, process.execPath, __filename, "serve", dshBin, pnpmBin];
  if (execute("systemctl", ["--user", "show-environment"], 3e3).status === 0) {
    const service = execute("systemd-run", [
      "--user",
      "--quiet",
      "--collect",
      "--unit=" + unit,
      "--setenv=HOME=" + homedir(),
      ...process.env.XDG_CONFIG_HOME ? ["--setenv=XDG_CONFIG_HOME=" + process.env.XDG_CONFIG_HOME] : [],
      "--property=Type=exec",
      "--property=Restart=on-failure",
      "--property=RestartSec=3",
      "flock",
      ...args
    ], 6e3);
    if (service.status === 0) return;
    const active = execute("systemctl", ["--user", "show", "-p", "ActiveState", "--value", unit], 3e3);
    if (["active", "activating"].includes(active.stdout?.trim())) return;
  }
  const child = spawn("flock", args, { detached: true, stdio: "ignore" });
  child.on("error", () => {
  });
  child.unref();
}
async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (process.platform !== "linux" || major < 24 || major === 24 && minor < 9) {
    throw new Error("远程主机需要 Linux 与 Node.js 24.9 或更新版本");
  }
  process.umask(63);
  mkdirSync(root, { recursive: true, mode: 448 });
  chmodSync(root, 448);
  const mode = process.argv[2];
  if (mode === "serve") return serve(process.argv[3], process.argv[4]);
  if (mode === "connect") {
    const child = spawn("flock", [
      "-w",
      "1200",
      "-F",
      bootstrapLock,
      process.execPath,
      __filename,
      "locked-connect",
      ...process.argv.slice(3)
    ], { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", () => {
      console.error("远端需要 util-linux 的 flock");
      process.exitCode = 1;
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
    return;
  }
  if (mode !== "locked-connect") throw new Error("未知远程操作");
  if (!isLocked(runLock) && !isLocked(dshLock)) {
    rmSync(readyFile, { force: true });
    mkdirSync(dshHome, { mode: 448, recursive: true });
    start(prepareRuntime());
  }
  const endpoint = await waitUntilReady();
  try {
    endpoint.magpie = await prepareMagpie(root, readJson(configFile) ?? {}, process.argv[3] ? Number(process.argv[3]) : void 0);
  } catch (error) {
    endpoint.magpie = { status: "error", error: error.code ? "Magpie 安装或启动失败，请检查网络和权限后重新连接" : error.message };
  }
  process.stdout.write("DSH_REMOTE_V1 " + JSON.stringify(endpoint) + "\n");
}
main().catch((error) => {
  console.error("dsh-remote: " + error.message);
  process.exitCode = 1;
});
