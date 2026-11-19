# DSH-Remote-Tool

**中文** · [English](README.md)

DeepSeek Harness Desktop 的 SSH 远程工作区插件。插件在 Linux 主机上启动并复用 DSH Web Host，让以同一 Linux 用户连接的客户端共享远端项目、会话和插件配置。它还在 DSH 中提供远端 Magpie 模型管理面板。

## 功能

- 在 DSH 侧栏保存 SSH 设备，并在 Desktop 中打开远端工作区。Desktop 缺少内嵌浏览器桥接时，可使用系统浏览器打开。
- 同一 Linux 用户复用一套远端 DSH Host。连接该账号的多个客户端共享持久化工作区和会话。
- 通过远端 Web Host 的插件管理器安装兼容的 DSH 插件。
- 同一远端 Host 的多个客户端共享工作区主题、字体和字号，本机 Desktop 设置独立。
- Magpie 随远端 Host 自动部署，或复用现有网关；界面使用 DSH 官方控件与主题色。
- 查看和搜索远端 Magpie 模型目录，启用或停用符合条件的模型，并将选中模型同步到远端 DSH 模型选择器。
- 将设备管理、SSH 传输、Magpie 集成和界面组件拆分为独立模块。

## 环境要求

**本机客户端**

- 支持插件的 DeepSeek Harness Desktop。要在 Desktop 内嵌远端工作区，还需要内嵌浏览器桥接。项目建议使用 Desktop `0.2.2-rc.5` 系列。
- `PATH` 中可用的 OpenSSH 客户端 `ssh`。连接前需要验证服务器主机密钥。Desktop 使用非交互 SSH，如私钥有口令，请先加入 SSH agent。
- 安装器和命令行客户端需要 Node.js 22 或更新版本及 npm；源码构建还需要安装开发依赖。
- 终端安装 Desktop 插件前，在应用菜单「Manage dsh Command…／管理 dsh 命令」安装 Desktop 自带的 `dsh` 命令，至少启动一次 Desktop，然后完全退出应用。npm 版 DSH CLI 不能管理 Desktop profile；下方的归档安装方式无需该命令。

**远端主机**

- Linux、**Node.js 24.9 或更新版本**、npm，以及 util-linux 提供的 `flock`。非交互 SSH 环境必须能找到 `node`、`npm` 和 `flock`。
- SSH 服务器允许向其回环地址进行本地 TCP 转发。
- 首次连接时可以访问所配置的 npm 源，以安装 DSH `0.2.2-rc.1` 和 pnpm `11.25.0`。也可以按下文配置符合版本要求的预装可执行文件。
- 首次连接默认准备 Magpie `0.1.4539` Linux 终端版（amd64/arm64），需能访问 GitHub Releases；已有可用网关会复用。可使用下文的预装路径或关闭自动部署。

## 安装与连接

### 从 npm 一键安装

按上文准备好 Desktop 自带的 `dsh` 命令后，运行：

```bash
npx --yes dsh-remote-tool@latest install
```

安装包已包含构建结果，无需自行构建，也无需 npm 登录。安装器调用 DSH 插件管理器，并将插件归档保留在 `~/.dsh-remote/packages/`，清理 npx 缓存不会影响后续依赖安装。完成后重新打开 Desktop。

若 `dsh` 不在 `PATH`，在命令末尾添加 `--dsh "/Desktop 自带的 dsh 绝对路径"`（Windows 使用自带的 `dsh.cmd`）。安装到已有 Web profile 时添加 `--profile web`。兼容性和安装提示按 DSH 插件管理器处理。

项目名称为 **DSH-Remote-Tool**，npm 包名和主命令为 `dsh-remote-tool`；原命令别名 `dsh-remote` 继续可用。GitHub 直装与自动发布配置见[发布指南](docs/publishing.md)。

### 归档安装

需要自行打包时：

```bash
git clone https://github.com/Ande-ZH/DSH-Remote-Tool.git
cd DSH-Remote-Tool
npm ci
npm pack
```

命令生成 `dsh-remote-tool-0.3.1.tgz`。在 Desktop 中打开「插件 → 添加已有插件」，输入归档的本机绝对路径，安装并启用。在其他机器打包时，先把归档复制到 Desktop 所在机器。

### 连接主机

1. 先在终端使用 `ssh` 连接一次，核对服务器主机密钥指纹。插件使用本机 OpenSSH 配置、`known_hosts`、身份密钥和 SSH agent。以下示例假设已配置 `de-vps` 别名，用来检查非交互连接和远端依赖。

   ```bash
   ssh -o BatchMode=yes de-vps 'node --version && npm --version && command -v flock'
   ```

2. 在 Desktop 侧栏打开「SSH 远程 → 添加设备」，填写设备名称和 SSH 别名或 `user@host`。SSH 端口留空时使用 OpenSSH 配置，也可在这里填写可选的 Magpie 端口。
3. 点击「连接」。首次连接会准备远端运行时并启动 Host 和 Magpie。在远端 DSH 设置中配置模型，打开项目并创建会话。另一台电脑需要恢复使用时，安装同一插件并以同一 Linux 用户连接同一服务器。

## 远端工作区与插件

远端使用官方 `dsh --profile web` 运行时。在远端工作区中打开「插件」，通过 DSH 插件管理器安装和启用远端插件。版本约束和安装脚本审批由 DSH 插件管理器处理。使用归档或目录路径时，请先将文件复制到服务器，再填写**远端绝对路径**。

兼容该 DSH Web Host 和远端 Linux 架构的 Host 插件、Web 界面插件、工具及 MCP 配置均可使用。依赖 Electron preload、原生窗口或 Desktop 专属扩展点的插件需要本机 Desktop 环境。本机 Desktop 的插件、设置和凭据与远端 Host 分开保存。

远端 Host 绑定回环地址，通过 SSH 本地转发访问。DSH 数据保存在服务器的 `~/.local/share/dsh-remote/data/`。断开客户端或移除设备条目会关闭本机连接，远端 Host 和数据继续保留。启动器优先使用 systemd 用户服务，否则启动独立进程。如果服务器策略会在用户退出后结束进程，持续运行可能受到影响。Host 重启后可以重新打开已持久化的会话。重启时正在执行的任务需按 DSH 的恢复状态确认。隧道断开后可手动重连。

连接同一 Linux 用户的客户端共享远端 Host 的 owner 权限，请妥善管理该 SSH 账号和密钥。

## 管理远端 Magpie 模型

1. 连接设备会自动准备并启动缺失的 Magpie；已有网关会复用。首次安装后需添加提供方或登录账号才能使用模型。网关通过远端 `127.0.0.1` 访问。插件优先使用设备填写的「Magpie 端口」。留空时读取 `$XDG_CONFIG_HOME/magpie/settings.json`。如果 `XDG_CONFIG_HOME` 未设置或不是绝对路径，则读取 `~/.config/magpie/settings.json`。未获取端口时使用 `3425`。
2. 打开「设置 → 远程模型」并选择设备，或在 SSH 设备卡片中点击「Magpie 模型」。可按模型名称、ID 或提供方搜索。
3. 勾选模型并点击「同步到远程 DSH」。如界面提示，请先连接远端 DSH Host。选中模型会出现在远端 DSH 原有的模型选择器中。取消勾选并再次同步可移除对应条目，空选择同步会移除插件管理的提供方。其他提供方和默认模型继续在 DSH 设置中管理。
4. 对符合条件的单个模型使用「停用」或「恢复」。此操作会影响使用同一 Magpie 网关的所有客户端。启停需要 SSH 用户能够运行原生 `magpie` CLI，且 CLI 与运行中的网关使用同一用户和配置。已有通配规则需在 Magpie 中管理。Docker 网关如发布到主机回环端口，可以浏览和同步模型。

网关需要指定密钥时，将其保存在远端 `~/.local/share/dsh-remote/magpie-key`，文件须归 SSH 用户所有且仅允许该用户读取，可用 `chmod 600` 设置权限。插件在远端读取密钥，并将其存入远端 DSH 的凭据存储供同步后的提供方使用。没有该文件时，插件使用本地 Magpie 调用方标识 `magpie-dsh-remote-tool`。网关配置请参阅 [Magpie 集成文档](https://usemagpie.ai/docs/integrate)。

## 使用预装的远端运行时

如需避免首次连接时下载运行时，先在远端 Linux 主机安装 DSH `0.2.2-rc.1` 和 pnpm `11.25.0`，再创建 `~/.local/share/dsh-remote/config.json`，根据实际安装位置填写可执行文件的绝对路径。

```json
{
  "dshBin": "/opt/dsh/bin/dsh",
  "pnpmBin": "/opt/pnpm/bin/pnpm"
}
```

配置还支持 `magpieBin`（预装 Magpie 的绝对路径）、`magpiePort`（网关端口）和 `magpie: false`（关闭自动部署）。自动安装使用固定版本的官方终端版，不执行 SHA-256 校验；通过可执行文件和网关健康检查确认运行状态。Magpie 安装失败不阻止工作区打开，设备页显示原因，重新连接可重试。自动部署的服务名为 `dsh-remote-magpie`，无 systemd 用户服务时使用独立进程。断开 SSH 保留网关运行。

远程工作区的内置主题、字体和字号通过 DSH Host 共享，同账号的多个客户端自动接收修改；本地 Desktop 外壳保持自身配置。第三方外观插件须使用 Host settings 才能同步自定义选项。

两个可执行文件的 `--version` 输出必须分别与上述版本一致，pnpm 可执行文件的名称必须是 `pnpm`。可只配置其中一项，启动器会安装未配置的依赖。运行时配置在下次启动 Host 时生效。

## 命令行客户端

需要长期使用 `dsh-remote-tool` 命令时，可以全局安装：

```bash
npm install --global dsh-remote-tool
dsh-remote-tool connect de-vps
```

在源码目录中也可以通过 Node.js 运行：

```bash
node bin/dsh-remote.mjs connect de-vps
node bin/dsh-remote.mjs connect user@example.com --port 2222 --no-open
```

CLI 会输出两分钟内有效的一次性本地链接，默认使用系统浏览器打开。添加 `--no-open` 可自行打开链接。运行期间保持进程开启以维持隧道，按 `Ctrl+C` 断开。CLI 支持交互式 SSH 认证，Desktop 设备页使用非交互认证。

## 故障排查

| 现象 | 检查项 |
| --- | --- |
| SSH 连接失败 | 使用上方命令检查主机密钥、身份密钥、SSH agent、别名和非交互环境的 `PATH`。 |
| SSH 登录成功但转发失败 | 检查服务器是否允许向 `127.0.0.1` 进行本地 TCP 转发。 |
| 首次启动失败 | 检查远端 Node.js 版本、npm 源连接、权限、磁盘空间和 `flock`。必要时配置预装运行时。 |
| 内嵌工作区无法打开 | 检查 Desktop 版本是否提供浏览器桥接。缺少桥接时使用系统浏览器链接，隧道关闭后重新连接。 |
| 远端找不到本机插件 | 在远端工作区的插件管理器安装，并检查插件是否兼容 Web Host 和 Linux。 |
| Magpie 目录无法加载 | 检查网关回环端口、设备中保存的端口，以及远端密钥文件的所有权和权限。 |
| 模型无法启停 | 检查原生 CLI 与网关是否使用同一用户和配置。通配规则请在 Magpie 中管理。 |
| SSH 退出后远端进程停止 | 检查远端 systemd 用户管理器和服务器保留用户进程的策略。 |

## 开发与验证

```bash
npm ci
npm run build
npm test
```

代码按职责组织。

| 路径 | 职责 |
| --- | --- |
| `src/plugin-host.mjs`、`src/services.mjs` | DSH Host 接入和功能调度 |
| `bin/`、`src/install.mjs` | 命令行入口与插件安装 |
| `src/devices.mjs`、`src/client.mjs` | 设备配置、连接和 SSH 传输 |
| `src/host.cjs`、`src/runtime/` | 远端 Host 与 Magpie 部署及生命周期 |
| `src/magpie/` | Magpie 网关操作和 DSH 模型同步 |
| `src/ui/` | DSH 界面注册、设备面板和模型管理面板 |
| `scripts/build.mjs`、`dist/` | 构建脚本及生成的客户端和远端代理 bundle |

修改界面或远端 Magpie 模块后运行 `npm run build`。`npm pack` 也会自动构建。提交源码变更时请一并提交重新生成的 `dist/` 文件。

Linux 端到端测试使用隔离的 SSH 测试环境和真实 DSH Host。运行 `DSH_E2E_INSTALL=1 npm run test:e2e` 可为测试安装固定版本的 DSH，也可以通过 `DSH_E2E_BIN` 指定现有 DSH 可执行文件。设置 `DSH_E2E_MAGPIE_BIN` 指向原生 Magpie 可执行文件后，测试还会覆盖模型启停、同步和经网关转发的对话。安装包加载测试通过 `DSH_E2E_BIN` 和 `DSH_E2E_PLUGIN` 指定 DSH 与插件归档，然后运行 `npm run test:package`。项目已使用 DSH `0.2.2-rc.1` 和 Magpie `0.1.4539` 测试，Windows Desktop 界面尚未在 Windows 实机验证。

更多源码参考和设计细节见[架构与上游源码核对](docs/architecture-audit.md)。

模块边界、远端共享外观、Magpie 随 Host 部署及兼容性验收见[远端 Host 实施规划](docs/remote-host-plan.zh-CN.md)和[当前实现与验证](docs/implementation-status.zh-CN.md)。npm 发布流程见[发布指南](docs/publishing.md)。

## 许可证

[MIT](LICENSE)
