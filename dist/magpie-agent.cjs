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
    function loopback(url, { method = "GET", headers, body, timeoutMs = 4500 } = {}) {
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
    module2.exports = { loopback };
  }
});

// src/runtime/magpie.cjs
var require_magpie = __commonJS({
  "src/runtime/magpie.cjs"(exports2, module2) {
    var { spawn, spawnSync } = require("node:child_process");
    var { randomUUID } = require("node:crypto");
    var { mkdir, readFile, writeFile, rename, rm, chmod, stat } = require("node:fs/promises");
    var { homedir: homedir2 } = require("node:os");
    var { join: join2, isAbsolute } = require("node:path");
    var { setTimeout: pause } = require("node:timers/promises");
    var { loopback } = require_loopback();
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
        const { status, data } = await loopback(new URL("http://127.0.0.1:" + port + "/api/hello"), { timeoutMs: 1500 });
        if (status !== 200 || data?.name !== "magpie" || typeof data.version !== "string") {
          throw new Error("Magpie 端口被其他服务占用");
        }
        return data;
      } catch (error) {
        if (error.code === "ECONNREFUSED") return null;
        throw error;
      }
    }
    function execute(bin, args, env = process.env) {
      return spawnSync(bin, args, { env, encoding: "utf8", timeout: 6e3, stdio: ["ignore", "pipe", "pipe"] });
    }
    async function install(root) {
      const release = releases[process.arch];
      if (!release) throw new Error("Magpie 自动安装支持 Linux amd64 和 arm64");
      const directory = join2(root, "magpie-" + version);
      const bin = join2(directory, "magpie");
      try {
        await stat(bin);
        if (execute(bin, ["--version"]).status === 0) return bin;
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
      const temporary = bin + "." + randomUUID();
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 448 });
        await chmod(temporary, 448);
        await rename(temporary, bin);
      } finally {
        await rm(temporary, { force: true });
      }
      return bin;
    }
    async function prepareMagpie(root, settings, override) {
      if (settings.magpie === false) return { status: "disabled" };
      const previous = await json(join2(root, "magpie-runtime.json"));
      const port = await configuredPort(override ?? settings.magpiePort, previous.port);
      const running = await probe(port);
      if (running) return { status: "ready", port, version: running.version, reused: true };
      const env = { ...process.env, PATH: [process.env.PATH, join2(homedir2(), ".local/bin")].filter(Boolean).join(":") };
      let bin = settings.magpieBin;
      if (bin !== void 0 && (typeof bin !== "string" || !isAbsolute(bin))) throw new Error("magpieBin 须为绝对路径");
      if (!bin) {
        const existing = execute("magpie", ["--version"], env);
        bin = existing.status === 0 ? execute("sh", ["-c", "command -v magpie"], env).stdout.trim() : await install(root);
      }
      if (execute(bin, ["--version"], env).status !== 0) throw new Error("Magpie 可执行文件无法运行");
      const state = join2(root, "magpie-runtime.json");
      const temporary = state + "." + randomUUID();
      try {
        await writeFile(temporary, JSON.stringify({ bin, port }) + "\n", { flag: "wx", mode: 384 });
        await rename(temporary, state);
      } finally {
        await rm(temporary, { force: true });
      }
      env.MAGPIE_ADDR = "127.0.0.1:" + port;
      const args = ["-n", "-F", join2(root, "magpie.lock"), bin, "serve"];
      let started = false;
      if (execute("systemctl", ["--user", "show-environment"]).status === 0) {
        started = execute("systemd-run", [
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
        const child = spawn("flock", args, { env, detached: true, stdio: "ignore" });
        await new Promise((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
      }
      for (let i = 0; i < 40; i++) {
        const ready = await probe(port);
        if (ready) return { status: "ready", port, version: ready.version, reused: false };
        await pause(250);
      }
      throw new Error("Magpie 未就绪，请检查服务状态后重新连接");
    }
    module2.exports = { prepareMagpie, configuredPort, probe, releases, version };
  }
});

// src/magpie/gateway.cjs
var require_gateway = __commonJS({
  "src/magpie/gateway.cjs"(exports2, module2) {
    var { execFile } = require("node:child_process");
    var { readFile, stat } = require("node:fs/promises");
    var { homedir: homedir2, userInfo } = require("node:os");
    var { dirname, isAbsolute, join: join2 } = require("node:path");
    var { promisify } = require("node:util");
    var { loopback } = require_loopback();
    var run = promisify(execFile);
    var levels = /* @__PURE__ */ new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
    var defaultKey = "magpie-dsh-remote-tool";
    var { configuredPort } = require_magpie();
    async function readJsonFile(path) {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return {};
        if (error instanceof SyntaxError) throw new Error("远端 Magpie 设置文件格式无效");
        throw error;
      }
    }
    function integer(value) {
      return Number.isSafeInteger(value) && value > 0 ? value : void 0;
    }
    function exactModelId2(id) {
      return typeof id === "string" && id.length <= 512 && /^[^/\s*?\x00-\x1f]+\/[^\s*?\x00-\x1f]+$/u.test(id);
    }
    function parseModel(row) {
      const { id, kind, owned_by, display_name, reasoning, reasoning_levels, context_window, max_output_tokens, modalities } = row ?? {};
      if (typeof id !== "string" || !id.trim() || id.length > 512 || /[\x00-\x1f\x7f]/u.test(id) || kind && kind !== "chat") return;
      return {
        id,
        name: typeof display_name === "string" ? display_name : id,
        provider: typeof owned_by === "string" ? owned_by : "Magpie",
        contextWindow: integer(context_window),
        maxTokens: integer(max_output_tokens),
        input: ["text", ...Array.isArray(modalities) && modalities.includes("image") ? ["image"] : []],
        reasoning: typeof reasoning === "boolean" ? reasoning : void 0,
        reasoningLevels: Array.isArray(reasoning_levels) ? [...new Set(reasoning_levels.filter((level) => levels.has(level)))] : [],
        canToggle: exactModelId2(id) && !id.startsWith("-")
      };
    }
    async function fetchJson(url, options = {}) {
      const { status, data } = await loopback(url, options);
      if (status === 401 || status === 403) throw new Error("Magpie 拒绝访问。请在远端配置可用的网关密钥。");
      if (status < 200 || status >= 300) throw new Error("Magpie HTTP " + status);
      if (!data || typeof data !== "object") throw new Error("Magpie 返回的响应格式无效");
      return data;
    }
    async function openGateway2(portOverride, keyPath) {
      const root = join2(homedir2(), ".local/share/dsh-remote");
      const runtime = await readJsonFile(join2(root, "magpie-runtime.json"));
      const settings = await readJsonFile(join2(root, "config.json"));
      const port = await configuredPort(portOverride ?? settings.magpiePort, runtime.port);
      const origin = new URL("http://127.0.0.1:" + port);
      const hello = await fetchJson(new URL("/api/hello", origin)).catch(() => {
        throw new Error("未找到远端 Magpie。请确认网关正在运行并监听回环端口 " + port + "。");
      });
      if (hello.name !== "magpie" || typeof hello.version !== "string") {
        throw new Error("远端端口 " + port + " 返回的服务不是 Magpie");
      }
      let key = defaultKey;
      try {
        const details = await stat(keyPath);
        if (!details.isFile() || (details.mode & 63) !== 0 || details.uid !== userInfo().uid) {
          throw new Error("远端 magpie-key 必须仅由当前 SSH 用户读取");
        }
        key = (await readFile(keyPath, "utf8")).trim();
        if (!key || !/^[!-~]{1,512}$/.test(key)) throw new Error("远端 magpie-key 格式无效");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return {
        origin,
        port,
        version: hello.version,
        key,
        async models() {
          const result = await fetchJson(new URL("/v1/models", origin), { headers: { Authorization: "Bearer " + key } });
          if (!Array.isArray(result.data)) throw new Error("Magpie 模型目录格式无效");
          const models = /* @__PURE__ */ new Map();
          for (const row of result.data) {
            const model = parseModel(row);
            if (model && !models.has(model.id)) models.set(model.id, model);
          }
          return [...models.values()];
        }
      };
    }
    async function magpie(args) {
      const env = { ...process.env, PATH: [process.env.PATH, join2(homedir2(), ".local", "bin")].filter(Boolean).join(":") };
      const runtime = await readJsonFile(join2(homedir2(), ".local/share/dsh-remote/magpie-runtime.json"));
      return run(runtime.bin || "magpie", args, { env, timeout: 5500, maxBuffer: 512 * 1024 });
    }
    async function nativeControls2(gateway) {
      try {
        const { stdout } = await magpie(["status", "--json", "--addr", gateway.origin.host]);
        const info = JSON.parse(stdout);
        if (!info.running || !info.started || info.version !== gateway.version || !integer(info.pid) || !isAbsolute(info.file)) return;
        const proc = await stat("/proc/" + info.pid);
        if (proc.uid !== userInfo().uid) return;
        const settingsPath = join2(dirname(info.file), "settings.json");
        return {
          async disabled() {
            const settings = await readJsonFile(settingsPath);
            if (!Array.isArray(settings.disabledModels)) return [];
            return settings.disabledModels.filter((id) => typeof id === "string").map((id) => ({
              id,
              canToggle: exactModelId2(id) && !id.startsWith("-")
            }));
          },
          async setEnabled(id, enabled) {
            try {
              await magpie(["model", enabled ? "enable" : "disable", id]);
            } catch {
              throw new Error("远端 Magpie 拒绝修改模型状态。请确认当前版本支持 magpie model enable / disable。");
            }
          }
        };
      } catch {
      }
    }
    module2.exports = { openGateway: openGateway2, nativeControls: nativeControls2, exactModelId: exactModelId2 };
  }
});

// src/magpie/dsh-models.cjs
var require_dsh_models = __commonJS({
  "src/magpie/dsh-models.cjs"(exports2, module2) {
    var { randomUUID } = require("node:crypto");
    var { readFile } = require("node:fs/promises");
    var { join: join2 } = require("node:path");
    var { loopback } = require_loopback();
    var namespace = "llm-pi-ai";
    var routeId = "dsh-remote-magpie";
    var credential = "DSH_REMOTE_MAGPIE_API_KEY";
    var providerPath = ["providers", routeId];
    async function openDsh(root, instance) {
      let ready;
      try {
        ready = JSON.parse(await readFile(join2(root, "ready.json"), "utf8"));
      } catch {
        throw new Error("远程 DSH Host 未就绪，请先连接工作区。");
      }
      if (!instance || ready.instance !== instance || ready.protocol !== 1 || !Number.isInteger(ready.port) || ready.port < 1024 || ready.port > 65535 || typeof ready.token !== "string" || !/^[a-zA-Z0-9_-]{16,256}$/.test(ready.token)) {
        throw new Error("远程 DSH Host 已更换，请重新连接设备。");
      }
      const base = new URL("http://127.0.0.1:" + ready.port);
      const login = new URL("/", base);
      login.searchParams.set("token", ready.token);
      const response = await loopback(login, { timeoutMs: 3500 });
      const cookie = response.headers["set-cookie"]?.map((value) => value.split(";", 1)[0]).join("; ");
      if (response.status !== 303 || !cookie) throw new Error("远程 DSH Host 身份验证失败，请重新连接。");
      return async function call(method, args = {}) {
        const result = await loopback(new URL("/api/" + method, base), {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          timeoutMs: 4e3,
          body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method, payload: { args } })
        });
        if (result.status < 200 || result.status >= 300) {
          throw new Error("远程 DSH 设置接口不可用（HTTP " + result.status + "）");
        }
        const reply = result.data?.result;
        if (reply?.ok) return reply.value;
        if (reply?.error?.code === "settings/conflict") throw new Error("远程 DSH 设置已变更，请刷新后重试。");
        throw new Error("远程 DSH 无法执行 " + method + "。请检查 Host 版本和模型设置。");
      };
    }
    async function snapshot(call) {
      const description = await call("settings/describe");
      const view = description?.namespaces?.find((entry) => entry.ns === namespace);
      if (!description?.writable || !view || !Number.isInteger(view.revision)) {
        throw new Error("远程 DSH 的自定义模型设置不可写。");
      }
      const provider = view.value?.providers?.[routeId];
      if (view.base?.providers?.[routeId] !== void 0 || provider && provider.apiKeyEnv !== credential) {
        throw new Error("远程 DSH 已有同名提供方，请先在模型设置中处理冲突。");
      }
      return { revision: view.revision, provider };
    }
    function dshModel(model) {
      const { id, name, contextWindow, maxTokens, input, reasoning, reasoningLevels } = model;
      return {
        id,
        name,
        input,
        ...contextWindow ? { contextWindow } : {},
        ...maxTokens ? { maxTokens: Math.min(maxTokens, contextWindow ?? maxTokens) } : {},
        ...reasoning === false ? { reasoningEfforts: false } : reasoningLevels.length ? {
          reasoningEfforts: Object.fromEntries(reasoningLevels.map((level) => [level, level === "off" ? null : level]))
        } : {}
      };
    }
    async function listDshModels2(root, instance) {
      if (!instance) return { available: false, selected: [] };
      try {
        const call = await openDsh(root, instance);
        const { provider } = await snapshot(call);
        return { available: true, selected: provider?.models?.map((model) => model.id) ?? [] };
      } catch (error) {
        return { available: false, selected: [], error: error.message };
      }
    }
    async function syncDshModels2(root, instance, gateway, models) {
      const call = await openDsh(root, instance);
      const { revision, provider } = await snapshot(call);
      if (!models.length && !provider) return;
      const op = models.length ? {
        op: "set",
        path: providerPath,
        value: {
          displayName: "Magpie · 远程网关",
          api: "openai-completions",
          baseURL: new URL("/v1", gateway.origin).href,
          apiKeyEnv: credential,
          models: models.map(dshModel)
        }
      } : { op: "unset", path: providerPath };
      if (models.length) await call("credentials/set", { ref: credential, value: gateway.key });
      await call("settings/mutate", { ns: namespace, expectedRevision: revision, ops: [op] });
    }
    module2.exports = { listDshModels: listDshModels2, syncDshModels: syncDshModels2 };
  }
});

// src/magpie/remote.cjs
var { homedir } = require("node:os");
var { join } = require("node:path");
var { openGateway, nativeControls, exactModelId } = require_gateway();
var { listDshModels, syncDshModels } = require_dsh_models();
async function manage(request) {
  const root = join(homedir(), ".local", "share", "dsh-remote");
  const gateway = await openGateway(request.port, join(root, "magpie-key"));
  const [models, controls] = await Promise.all([gateway.models(), nativeControls(gateway)]);
  if (request.operation === "sync") {
    const byId = new Map(models.map((model) => [model.id, model]));
    const selection = request.models.map((id) => byId.get(id));
    if (selection.some((model) => !model)) throw new Error("部分模型已从 Magpie 目录移除，请刷新后重新选择。");
    await syncDshModels(root, request.instance, gateway, selection);
  }
  if (request.operation === "setEnabled") {
    if (!controls) throw new Error("启停模型需要与网关共用配置的原生 Magpie CLI。");
    const { model, enabled } = request;
    if (!exactModelId(model) || model.startsWith("-") || typeof enabled !== "boolean") throw new Error("模型 ID 无效。");
    const disabled = await controls.disabled();
    const candidates = enabled ? disabled : models;
    const match = candidates.find((candidate) => candidate.id === model && candidate.canToggle);
    if (!match) {
      const effective = enabled ? models : disabled;
      if (!effective.some((candidate) => candidate.id === model && candidate.canToggle)) {
        throw new Error("模型已不在当前目录，请刷新后再操作。");
      }
    } else {
      await controls.setEnabled(model, enabled);
    }
    return catalog(gateway, controls, await gateway.models(), root, request.instance);
  }
  return catalog(gateway, controls, models, root, request.instance);
}
async function catalog(gateway, controls, models, root, instance) {
  const [disabled, dsh] = await Promise.all([
    controls?.disabled().catch(() => null) ?? null,
    listDshModels(root, instance)
  ]);
  return {
    version: gateway.version,
    port: gateway.port,
    models,
    disabled: disabled ?? [],
    canManage: disabled !== null,
    dsh
  };
}
async function replyToMagpie(request) {
  let reply;
  try {
    reply = { ok: true, value: await manage(request) };
  } catch (error) {
    reply = { ok: false, error: error.code ? "远端 Magpie 或配置暂不可用。" : error.message };
  }
  process.stdout.write("DSH_REMOTE_MAGPIE_V1 " + JSON.stringify(reply) + "\n");
}
module.exports = { replyToMagpie };
