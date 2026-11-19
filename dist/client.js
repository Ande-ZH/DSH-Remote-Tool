window.__ModuleLoader__.load({ id: "dsh-shared-remote", factory(require) {
const module = { exports: {} };
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/ui/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react6 = require("react");

// src/ui/devices-panel.js
var import_react5 = require("react");

// src/ui/common.js
var import_react = require("react");
var endpoint = "/api/dsh-shared-remote/devices";
var statusText = {
  disconnected: "未连接",
  connecting: "连接中",
  connected: "已连接",
  error: "连接失败"
};
var pane = { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0 };
var bar = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "10px 16px" };
var buttonStyle = {
  cursor: "pointer",
  border: "1px solid currentColor",
  borderRadius: 6,
  padding: "5px 10px",
  background: "transparent",
  color: "inherit"
};
async function api(action, signal) {
  const timeout = AbortSignal.timeout(action?.type === "magpie" ? 34e3 : 8e3);
  const response = await fetch(endpoint, {
    ...action === void 0 ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action)
    },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "无法访问远程工作区插件");
  return data;
}
function Button({ children, ...props }) {
  return (0, import_react.createElement)("button", {
    type: "button",
    style: { ...buttonStyle, opacity: props.disabled ? 0.5 : 1 },
    ...props
  }, children);
}

// src/ui/devices.js
var import_react2 = require("react");
function useDevices() {
  const [devices, setDevices] = (0, import_react2.useState)([]);
  const [error, setError] = (0, import_react2.useState)("");
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const revision = (0, import_react2.useRef)(0);
  async function refresh(signal) {
    const at = revision.current;
    try {
      const data = await api(void 0, signal);
      if (!signal.aborted && at === revision.current) setDevices(data.devices);
    } catch (failure) {
      if (!signal.aborted && at === revision.current) setError(failure.message);
    }
  }
  const polling = devices.some((device) => device.status === "connecting" || device.status === "connected");
  (0, import_react2.useEffect)(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      await refresh(controller.signal);
      if (polling && !controller.signal.aborted) timer = setTimeout(poll, 1700);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [polling]);
  async function update(action) {
    revision.current += 1;
    setBusy(true);
    setError("");
    try {
      const data = await api(action);
      const next = data.devices ?? (await api()).devices;
      revision.current += 1;
      setDevices(next);
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { devices, busy, error, setError, update };
}

// src/ui/magpie-panel.js
var import_react3 = require("react");
var header = { ...bar, padding: 0, justifyContent: "space-between" };
var controls = { ...bar, padding: 0, margin: "12px 0" };
var list = { listStyle: "none", padding: 0 };
var row = { ...bar, padding: "8px 0", borderBottom: "1px solid #8884" };
function useMagpie(device) {
  const [catalog, setCatalog] = (0, import_react3.useState)(null);
  const [selected, setSelected] = (0, import_react3.useState)([]);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)("");
  const [notice, setNotice] = (0, import_react3.useState)("");
  const active = (0, import_react3.useRef)();
  const connected = device.status === "connected";
  async function load(operation, fields, preserveSelection, message) {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api({ type: "magpie", id: device.id, operation, ...fields }, request.signal);
      if (active.current !== request || request.signal.aborted) return;
      setCatalog(result);
      const available = new Set(result.models.map((model) => model.id));
      setSelected((current) => (preserveSelection ? current : result.dsh.selected).filter((id2) => available.has(id2)));
      if (message) setNotice(message);
    } catch (failure) {
      if (active.current === request && !request.signal.aborted) setError(failure.message);
    } finally {
      if (active.current === request) setBusy(false);
    }
  }
  (0, import_react3.useEffect)(() => {
    void load("list");
    return () => active.current?.abort();
  }, [device.id, device.host, device.port, device.magpiePort, connected]);
  return { catalog, selected, setSelected, busy, error, notice, load };
}
function ModelRow({ model, selected, editable, busy, onSelect, onChangeState }) {
  const capabilities = [
    model.provider,
    model.contextWindow ? "上下文 " + model.contextWindow.toLocaleString() : "",
    model.input.includes("image") ? "可读图" : ""
  ].filter(Boolean);
  return (0, import_react3.createElement)(
    "li",
    { style: row },
    (0, import_react3.createElement)(
      "label",
      { style: { display: "flex", alignItems: "center", gap: 8 } },
      (0, import_react3.createElement)("input", { type: "checkbox", checked: selected, disabled: busy || !editable, onChange: onSelect }),
      (0, import_react3.createElement)("strong", null, model.name)
    ),
    (0, import_react3.createElement)("code", null, model.id),
    (0, import_react3.createElement)("span", null, capabilities.join(" · ")),
    onChangeState && (0, import_react3.createElement)(Button, { disabled: busy, onClick: onChangeState }, "停用")
  );
}
function MagpiePanel({ device, connect, back, connectError }) {
  const { catalog, selected, setSelected, busy, error, notice, load } = useMagpie(device);
  const [query, setQuery] = (0, import_react3.useState)("");
  const isReady = catalog?.dsh.available && device.status === "connected";
  const excluded = catalog?.dsh.selected.filter((id2) => !catalog.models.some((model) => model.id === id2)) ?? [];
  const syncLabel = selected.length ? "同步 " + selected.length + " 个模型到 DSH" : catalog?.dsh.selected.length ? "移除 DSH 提供方" : "同步到远程 DSH";
  const needle = query.trim().toLowerCase();
  const models = catalog?.models.filter((model) => [model.id, model.name, model.provider].some((value) => value.toLowerCase().includes(needle)));
  const changeState = (model, enabled) => {
    const verb = enabled ? "恢复" : "停用";
    if (!enabled && !window.confirm("停用 " + model + "？这会影响该 Magpie 网关的所有使用方。")) return;
    void load("setEnabled", { model, enabled }, true, "已提交" + verb + "操作。");
  };
  function sync() {
    if (!selected.length && !window.confirm("移除远程 DSH 中由本插件管理的 Magpie 提供方？")) return;
    void load("sync", { models: selected }, false, selected.length ? "模型已同步到远程 DSH 的模型选择器。" : "已移除远程 DSH 的 Magpie 提供方。");
  }
  return (0, import_react3.createElement)(
    "section",
    { style: { padding: "16px", overflow: "auto" } },
    (0, import_react3.createElement)(
      "div",
      { style: header },
      (0, import_react3.createElement)("h2", { style: { margin: 0 } }, "Magpie 模型 · " + device.label),
      back && (0, import_react3.createElement)(Button, { onClick: back }, "返回设备")
    ),
    (0, import_react3.createElement)(
      "div",
      { style: controls },
      (0, import_react3.createElement)(Button, { disabled: busy, onClick: () => void load("list") }, "刷新"),
      device.status !== "connected" && (0, import_react3.createElement)(Button, {
        disabled: device.status === "connecting",
        onClick: () => void connect()
      }, device.status === "connecting" ? "正在连接远程 DSH" : "连接远程 DSH"),
      (0, import_react3.createElement)(Button, {
        disabled: busy || !isReady || !selected.length && !catalog.dsh.selected.length,
        onClick: sync
      }, syncLabel),
      catalog && (0, import_react3.createElement)("span", null, "网关 · " + catalog.version + " · 端口 " + catalog.port)
    ),
    busy && (0, import_react3.createElement)("p", { role: "status" }, "正在联系远端主机…"),
    (error || connectError || device.error || catalog?.dsh.error) && (0, import_react3.createElement)("p", { role: "alert" }, error || connectError || device.error || catalog.dsh.error),
    notice && (0, import_react3.createElement)("p", { role: "status" }, notice),
    catalog && (0, import_react3.createElement)(
      "div",
      null,
      excluded.length > 0 && (0, import_react3.createElement)("p", null, excluded.length + " 个已同步模型不在当前目录，重新同步可移除这些条目。"),
      (0, import_react3.createElement)("label", null, "搜索模型 ", (0, import_react3.createElement)("input", {
        type: "search",
        value: query,
        onChange: (event) => setQuery(event.target.value),
        placeholder: "名称、ID 或提供方"
      })),
      models.length === 0 && (0, import_react3.createElement)("p", null, catalog.models.length ? "没有匹配的模型。" : "Magpie 未返回对话模型。"),
      (0, import_react3.createElement)(
        "ul",
        { style: list },
        ...models.map((model) => (0, import_react3.createElement)(ModelRow, {
          key: model.id,
          model,
          busy,
          editable: isReady,
          selected: selected.includes(model.id),
          onSelect: (event) => setSelected((ids) => event.target.checked ? [...ids, model.id] : ids.filter((id2) => id2 !== model.id)),
          onChangeState: catalog.canManage && model.canToggle ? () => changeState(model.id, false) : null
        }))
      ),
      catalog.disabled.length > 0 && (0, import_react3.createElement)(
        "section",
        null,
        (0, import_react3.createElement)("h3", null, "已停用"),
        (0, import_react3.createElement)("ul", { style: list }, ...catalog.disabled.map((model) => (0, import_react3.createElement)(
          "li",
          { key: model.id, style: row },
          (0, import_react3.createElement)("code", null, model.id),
          model.canToggle ? (0, import_react3.createElement)(Button, { disabled: busy, onClick: () => changeState(model.id, true) }, "恢复") : (0, import_react3.createElement)("span", null, "在 Magpie 中管理此规则")
        )))
      ),
      !catalog.canManage && (0, import_react3.createElement)("p", null, "启停模型需要远端网关与 SSH 用户的 Magpie CLI 使用同一份配置。")
    )
  );
}
function MagpieSettings() {
  const { devices, update, error } = useDevices();
  const [deviceId, setDeviceId] = (0, import_react3.useState)("");
  const device = devices.find((item) => item.id === deviceId) ?? devices[0];
  if (!device) return (0, import_react3.createElement)("p", null, error || "在「SSH 远程」添加设备后，可在这里查看和同步 Magpie 模型。");
  return (0, import_react3.createElement)(
    "div",
    null,
    (0, import_react3.createElement)("label", null, "远程设备 ", (0, import_react3.createElement)(
      "select",
      { value: device.id, onChange: (event) => setDeviceId(event.target.value) },
      ...devices.map((item) => (0, import_react3.createElement)("option", { key: item.id, value: item.id }, item.label + " · " + statusText[item.status]))
    )),
    (0, import_react3.createElement)(MagpiePanel, {
      key: device.id,
      device,
      connectError: error,
      connect: () => update({ type: "connect", id: device.id })
    })
  );
}

// src/ui/workspace-guest.js
var import_react4 = require("react");
function RemoteGuest({ entry, showError }) {
  const container = (0, import_react4.useRef)(null);
  const bridge = window.dshDesktop?.browser;
  (0, import_react4.useEffect)(() => {
    if (!bridge) return;
    const viewport = container.current;
    let disposed = false;
    let reservation;
    let guest;
    async function mount() {
      reservation = await bridge.acquire("dsh-shared-remote:" + entry.deviceId);
      if (disposed) {
        await bridge.release(reservation.lease);
        return;
      }
      const url = new URL(entry.browserUrl);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || !url.searchParams.get("token")) throw new Error("远端入口地址无效");
      guest = document.createElement("webview");
      guest.style.cssText = "width:100%;height:100%;display:flex;";
      guest.setAttribute("aria-label", "远程 DSH 工作区");
      guest.setAttribute("partition", reservation.partition);
      guest.setAttribute("src", "about:blank#" + reservation.lease);
      guest.addEventListener("dom-ready", () => {
        if (!disposed) Promise.resolve(guest.loadURL(url.href)).catch(() => {
          if (!disposed) showError("远端页面加载失败，请返回设备后重新打开");
        });
      }, { once: true });
      guest.addEventListener("did-fail-load", (event) => {
        if (!disposed && event.isMainFrame && event.errorCode !== -3) showError("远端页面加载失败，请检查 SSH 隧道");
      });
      viewport.append(guest);
    }
    void mount().catch(() => {
      if (!disposed) showError("无法在 Desktop 内打开远端工作区");
    });
    return () => {
      disposed = true;
      guest?.remove();
      if (reservation) void bridge.release(reservation.lease).catch(() => {
      });
    };
  }, [entry, bridge, showError]);
  if (!bridge) {
    return (0, import_react4.createElement)(
      "div",
      { style: bar },
      (0, import_react4.createElement)("a", { href: entry.browserUrl, target: "_blank", rel: "noreferrer noopener" }, "使用浏览器打开远端工作区")
    );
  }
  return (0, import_react4.createElement)("div", { ref: container, style: { flex: 1, minHeight: 0, position: "relative" } });
}

// src/ui/devices-panel.js
var empty = { label: "", host: "", port: "", magpiePort: "" };
function DevicesPanel() {
  const { devices, busy, error, setError, update } = useDevices();
  const [form, setForm] = (0, import_react5.useState)(null);
  const [opening, setOpening] = (0, import_react5.useState)(null);
  const [entry, setEntry] = (0, import_react5.useState)(null);
  const [magpieId, setMagpieId] = (0, import_react5.useState)(null);
  const byId = (deviceId) => devices.find((device) => device.id === deviceId);
  const openingStatus = byId(opening)?.status;
  const entryStatus = byId(entry?.deviceId)?.status;
  (0, import_react5.useEffect)(() => {
    if (!opening || !openingStatus || openingStatus === "connecting") return;
    if (openingStatus !== "connected") {
      setOpening(null);
      return;
    }
    let active = true;
    void api({ type: "entry", id: opening }).then((result) => {
      if (active) setEntry({ ...result, deviceId: opening });
    }).catch((failure) => {
      if (active) setError(failure.message);
    }).finally(() => {
      if (active) setOpening(null);
    });
    return () => {
      active = false;
    };
  }, [opening, openingStatus]);
  (0, import_react5.useEffect)(() => {
    if (entry && entryStatus && entryStatus !== "connected") {
      setEntry(null);
      setError(byId(entry.deviceId)?.error || "SSH 隧道已断开，请重新连接");
    }
  }, [entry, entryStatus]);
  async function connectDevice(device) {
    if (await update({ type: "connect", id: device.id })) setOpening(device.id);
  }
  async function saveDevice(event) {
    event.preventDefault();
    const { port, magpiePort, ...rest } = form;
    const changed = await update({
      type: "save",
      ...rest,
      ...port === "" ? {} : { port: Number(port) },
      ...magpiePort === "" ? {} : { magpiePort: Number(magpiePort) }
    });
    if (changed) setForm(null);
  }
  const magpieDevice = byId(magpieId);
  if (magpieDevice) {
    return (0, import_react5.createElement)(MagpiePanel, {
      key: magpieDevice.id,
      device: magpieDevice,
      connect: () => update({ type: "connect", id: magpieDevice.id }),
      back: () => setMagpieId(null)
    });
  }
  if (entry) {
    return (0, import_react5.createElement)(
      "section",
      { style: pane },
      (0, import_react5.createElement)(
        "div",
        { style: bar },
        (0, import_react5.createElement)(Button, { onClick: () => {
          setEntry(null);
          setError("");
        } }, "返回设备"),
        (0, import_react5.createElement)("strong", null, byId(entry.deviceId)?.label),
        (0, import_react5.createElement)(Button, { onClick: () => void update({ type: "disconnect", id: entry.deviceId }).then((ok) => {
          if (ok) {
            setEntry(null);
            setError("");
          }
        }), disabled: busy }, "断开本机"),
        error && (0, import_react5.createElement)("span", { role: "alert" }, error)
      ),
      (0, import_react5.createElement)(RemoteGuest, { entry, showError: setError })
    );
  }
  return (0, import_react5.createElement)(
    "section",
    { style: { ...pane, overflow: "auto", padding: "max(18px, 2vw)", boxSizing: "border-box" } },
    (0, import_react5.createElement)(
      "div",
      { style: { ...bar, padding: 0, justifyContent: "space-between", maxWidth: 760 } },
      (0, import_react5.createElement)("h2", { style: { margin: 0 } }, "SSH 远程工作区"),
      (0, import_react5.createElement)(Button, { onClick: () => {
        setForm({ ...empty });
        setError("");
      }, disabled: busy }, "添加设备")
    ),
    error && (0, import_react5.createElement)("p", { role: "alert" }, error),
    form && (0, import_react5.createElement)(
      "form",
      { onSubmit: saveDevice, style: { display: "grid", gap: 10, maxWidth: 440, marginTop: 16 } },
      ...[
        ["label", "设备名称", "德国服务器"],
        ["host", "SSH 别名或 user@host", "de-vps"],
        ["port", "SSH 端口（留空使用 SSH 配置）", "22"],
        ["magpiePort", "Magpie 端口（留空自动检测）", "3425"]
      ].map(([key, label, placeholder]) => (0, import_react5.createElement)(
        "label",
        { key, style: { display: "grid", gap: 4 } },
        label,
        (0, import_react5.createElement)("input", {
          type: key === "port" || key === "magpiePort" ? "number" : "text",
          min: 1,
          max: 65535,
          required: key === "label" || key === "host",
          placeholder,
          value: form[key],
          onChange: (event) => setForm({ ...form, [key]: event.target.value })
        })
      )),
      (0, import_react5.createElement)(
        "div",
        { style: { ...bar, padding: 0 } },
        (0, import_react5.createElement)(Button, { type: "submit", disabled: busy }, "保存"),
        (0, import_react5.createElement)(Button, { onClick: () => setForm(null), disabled: busy }, "取消")
      )
    ),
    !form && devices.length === 0 && (0, import_react5.createElement)("p", null, "添加已配置密钥并验证过主机指纹的 SSH 设备。"),
    (0, import_react5.createElement)(
      "ul",
      { style: { listStyle: "none", padding: 0, maxWidth: 760 } },
      ...devices.map((device) => (0, import_react5.createElement)(
        "li",
        { key: device.id, style: { borderBottom: "1px solid #8884", padding: "12px 0" } },
        (0, import_react5.createElement)(
          "div",
          { style: { ...bar, padding: 0 } },
          (0, import_react5.createElement)("strong", null, device.label),
          (0, import_react5.createElement)("code", null, device.host + (device.port ? " · " + device.port : "")),
          (0, import_react5.createElement)("span", null, statusText[device.status]),
          device.status === "connected" ? (0, import_react5.createElement)(Button, { onClick: () => setOpening(device.id), disabled: busy }, "打开工作区") : (0, import_react5.createElement)(Button, { onClick: () => void connectDevice(device), disabled: busy || device.status === "connecting" }, "连接"),
          ["connected", "connecting"].includes(device.status) && (0, import_react5.createElement)(Button, { onClick: () => {
            setOpening(null);
            void update({ type: "disconnect", id: device.id });
          }, disabled: busy }, "断开"),
          (0, import_react5.createElement)(Button, { onClick: () => setMagpieId(device.id) }, "Magpie 模型"),
          (0, import_react5.createElement)(Button, {
            onClick: () => setForm({ ...device, port: String(device.port ?? ""), magpiePort: String(device.magpiePort ?? "") }),
            disabled: busy
          }, "编辑"),
          (0, import_react5.createElement)(Button, {
            onClick: () => {
              if (window.confirm("移除这条设备配置？")) void update({ type: "remove", id: device.id });
            },
            disabled: busy
          }, "移除")
        ),
        device.error && (0, import_react5.createElement)("p", { role: "status", style: { margin: "6px 0 0" } }, device.error)
      ))
    )
  );
}

// src/ui/index.js
var id = "dsh-shared-remote";
function Icon() {
  return (0, import_react6.createElement)(
    "svg",
    {
      width: 18,
      height: 18,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.7,
      "aria-hidden": true
    },
    (0, import_react6.createElement)("rect", { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
    (0, import_react6.createElement)("path", { d: "M8 21h8m-4-4v4M7 8l3 3-3 3m6 0h4" })
  );
}
var name = id;
var inject = ["slots"];
function apply(ctx) {
  const slots = ctx.slots ?? ctx.get("slots");
  slots.inject("sidebar.panellist", () => slots.register({
    name: "sidebar.panellist",
    id,
    order: 45,
    label: () => "SSH 远程"
  }, Icon));
  slots.inject("main", () => slots.register({ name: "main", key: id }, DevicesPanel));
  slots.inject("settings.section", () => slots.register({
    name: "settings.section",
    id: id + "-models",
    order: 12,
    label: () => "远程模型"
  }, MagpieSettings));
}
return module.exports;
} });
