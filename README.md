# DSH-Remote-Tool

DeepSeek Harness Desktop 插件。通过 SSH 在 Linux 主机上启动一套常驻的官方 DSH Web Host。同一 Linux 用户下的客户端打开同一份项目、会话和插件配置。

## 安装

从源码生成插件安装包时，在仓库根目录运行以下命令。

```bash
npm ci
npm pack
```

1. 将 `dsh-shared-remote-0.2.0.tgz` 下载到本机。在 DeepSeek Harness Desktop 打开「插件 → 添加已有插件」，粘贴该文件的绝对路径并安装、启用。建议使用具备内嵌浏览器桥接的 Desktop `0.2.2-rc.5` 系列。
2. 在本机终端用 OpenSSH 连接目标主机一次，并核对服务器主机指纹。Desktop 插件复用本机 OpenSSH 配置、`known_hosts`、密钥和 SSH agent。插件连接使用无交互模式，私钥有口令时先加入 SSH agent。
3. 在 Desktop 侧栏打开「SSH 远程 → 添加设备」。填写设备名和 OpenSSH 别名或 `user@host`。端口留空时由 OpenSSH 配置决定。点「连接」，远端工作区会在 Desktop 内嵌页打开。
4. 在远端 DSH 的设置中配置模型，然后打开项目并发起对话。另一台电脑安装同一插件，用同一台服务器的同一 Linux 用户连接，即可打开原项目和会话。

远端需要 Linux、Node.js 24.9 或更新版本、npm、`flock` 和 SSH 本地转发权限。确保非交互 SSH 环境也能找到 Node.js。首次连接自动安装固定版本的 DSH 和 pnpm，之后复用端上的运行时。未提供内嵌浏览器桥接的客户端可以在插件页面用系统浏览器打开远端工作区。

有 SSH 别名时，可先检查无交互登录和远端依赖。

```bash
ssh -o BatchMode=yes de-vps "node --version && npm --version && command -v flock"
```

## 在远端安装 DSH 插件

先从 Desktop 的「SSH 远程」页打开工作区，再进入**内嵌的远端 DSH 侧栏 → 插件**。可从 npm、Git 或远端文件系统路径安装 DSH bundle，通过官方管理器启用、禁用和卸载。使用本地路径时，先将插件目录或归档上传到 Linux 服务器，再填写服务器上的绝对路径。来自本机 Desktop 的插件配置与模型凭据需要在远端单独安装或配置。

远端使用完整的官方 `dsh --profile web`，支持该运行时可加载的 Host 插件、Web 界面插件、工具、MCP 配置和适配当前 Linux 架构的依赖。依赖 Electron preload、原生窗口或 Desktop 专属扩展点的插件需要在本机 Desktop 安装。插件的 DSH 版本约束、安装脚本审批和平台约束由官方管理器执行。

项目、会话和插件配置统一保存在远端 `~/.local/share/dsh-remote/data/`。断开桌面隧道或移除本机设备条目时，远端任务继续运行。远端 Host 重启后可续接已持久化的会话和插件配置。重启发生时正在执行的任务要按 DSH 恢复结果确认。

## 管理远端 Magpie 模型

1. 在远端启动 Magpie 网关，并让 SSH 主机可以通过本机回环访问它。插件优先使用设备里的「Magpie 端口」，留空时读取远端 Magpie 配置，默认使用 `3425`。 [Magpie 集成文档](https://usemagpie.ai/docs/integrate)
2. 在 Desktop 打开「设置 → 远程模型」并选择设备，或在「SSH 远程」设备卡片上点「Magpie 模型」。模型目录可以搜索，也会展示模型的输入能力。
3. 用「停用」或「恢复」修改该模型在 Magpie 网关中的可用性，这会影响使用同一网关的其他客户端。启停需要 Magpie 进程与 SSH 用户相同，且远端 PATH 中的 `magpie` 与进程使用同一套配置。通过 Docker 发布到回环地址的网关可浏览目录并同步模型。
4. 勾选模型并点「同步到远端 DSH」。同步后的模型出现在该设备上远端 DSH 原有的模型选择器中。取消勾选并再次同步即可从选择器移除。远端 DSH 的现有默认模型和其他提供商由你继续管理。

网关需要指定密钥时，把密钥写入远端 `~/.local/share/dsh-remote/magpie-key`，归 SSH 用户所有，权限设为 `600`。插件在远端读取它并保存到远端 DSH 的凭据存储。配置文件默认位于 `$XDG_CONFIG_HOME/magpie/settings.json` 或 `~/.config/magpie/settings.json`。

## 离线部署

远端 Linux 可预装 DSH `0.2.2-rc.1` 与 pnpm `11.25.0`，然后将下列配置写到远端 `~/.local/share/dsh-remote/config.json`。修改运行时配置会在下次 Host 启动时生效。

```json
{
  "dshBin": "/opt/dsh/bin/dsh",
  "pnpmBin": "/opt/pnpm/bin/pnpm"
}
```

没有配置的可执行文件由引导程序自动安装。配置的可执行文件位于可信目录，并能在非交互 SSH 环境运行。

## 故障排查

| 现象 | 检查项 |
| --- | --- |
| Desktop 连接失败 | 使用上面的 `ssh -o BatchMode=yes` 命令验证主机指纹、密钥和 PATH。 |
| SSH 登录成功但隧道失败 | 检查 sshd 是否允许本地转发到服务端回环地址。 |
| 首次引导失败 | 检查远端 Node.js 版本、磁盘空间、npm 网络与权限。受限网络使用离线部署。 |
| 内嵌页无法打开 | 核对 Desktop 版本是否提供浏览器桥接。连接状态异常时返回设备列表重连。 |
| 远端找不到本机插件 | 进入内嵌远端页的「插件」安装，检查该插件是否支持 Web Host 和远端平台。 |
| Magpie 目录无法加载 | 检查 SSH 主机上 Magpie 的监听端口和密钥文件权限，网关需能从 `127.0.0.1` 访问。 |
| 部分模型无法启停 | 确认 Magpie 与 SSH 用户使用同一套配置。原生 CLI 只能对单个模型操作，已有通配规则可通过 Magpie 管理。 |
| 退出 SSH 后任务消失 | 远端优先使用 systemd 用户服务，无法使用时走独立进程。配置了登录会话回收策略的主机应启用持续运行的用户管理器。 |

本机使用 Desktop 的插件管理器停用或卸载插件即可关闭本机隧道。远端的项目、插件和会话数据继续保留。需要停服务时使用远端用户的服务管理，先确认正在执行的任务已完成。

## 开发与验证

```bash
npm ci
npm run build
npm test
DSH_E2E_INSTALL=1 npm run test:e2e
```

端到端测试在 Linux 上运行。它使用两个真实 OpenSSH 客户端、隔离的 SSH 测试服务、npm 发布的真实 DSH Host 和本地模型接口。可设置 `DSH_E2E_BIN` 使用预装的固定版本。设置 `DSH_E2E_MAGPIE_BIN` 为原生 Magpie 可执行文件的路径，可以同时验证网关启停模型、同步和实际对话。测试目录需要足够空间安装 DSH 及其依赖。

| 模块 | 职责 |
| --- | --- |
| [`src/plugin-host.mjs`](src/plugin-host.mjs) | 接收 DSH 插件界面请求，挂接 Host 生命周期。 |
| [`src/devices.mjs`](src/devices.mjs) 和 [`src/client.mjs`](src/client.mjs) | 保存设备、管理连接并复用 SSH 传输。 |
| [`src/magpie`](src/magpie) | 处理远端模型目录、启停和 DSH 模型同步。 |
| [`src/ui`](src/ui) | 注册 DSH 扩展点，提供设备页与共用的 Magpie 模型管理面板。 |

`dist/` 由 `npm run build` 生成。改动界面或远端 Magpie 模块后重新构建，打包时也会自动构建。

[架构与上游源码核对](docs/architecture-audit.md)

## 许可证

[MIT](LICENSE)
