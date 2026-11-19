# 架构与上游源码核对

## 源码基线

| 项目 | 审计提交 | 核对结果 |
| --- | --- | --- |
| [ZCode](https://github.com/zai-org/ZCode) | `fec975905a2abd4c07e35c40d51fa097a2258ec9` | `packages/server/src/remote/ssh-backend.ts` 建立 SSH 直连转发，`packages/zcode-server-cli/src/platform/serviceManager.ts` 管理服务，`packages/zcode-server-cli/src/runtime/lock.ts` 管理运行根的所有权。 |
| [dsh-ssh](https://github.com/longguanhong0755/dsh-ssh) | `860c8007401ffd28b5ee95d1f413f2d9ec6da87b` | `lib/remote/units.js` 启动远端 DSH Web。`lib/bridge.js` 与 `lib/bridge/{lifecycle,state,sessions}.js` 维护本机日志和本机到远端的会话映射。 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `2e39e70496aa02986ca6a820c5d497e816b69d7e` | `packages/bundle/web-app/cordis.patch.yml` 提供完整 Web 工作区和插件管理。桌面插件入口采用对应官方客户端 slot，内嵌页使用 `apps/desktop/src/browser-guests.ts` 的租约。执行测试使用 npm 上可取得的 DSH `0.2.2-rc.1`。 |

本项目实现独立。参考了 ZCode 的 SSH 转发、重复连接复用和远端生命周期设计。ZCode 许可证为 Apache-2.0。引用的两个 DSH 上游仓库采用 MIT。运行时由目标 Linux 主机从其配置的 npm 源安装，项目归档不携带上游软件或第三方二进制。

## 连接流程

1. 本机插件用 OpenSSH 验证主机密钥，使用配置的身份登录。
2. 引导程序原子更新启动器，用独立引导锁安装固定版本并启动远端 Host。运行锁及 DSH 子进程锁限制每个 Linux 用户最多有一套本插件托管的 DSH 进程。
3. 远端 Host 只绑定 IPv4 回环地址。两端分别通过自己的 SSH 转发访问该 Host。每次连接通过 DSH 的启动凭据换取浏览器 Cookie。
4. Desktop 插件页向已有 Electron 浏览器桥接申请租约，在隔离 guest 内运行官方 DSH Web 前端。桌面和远端各自使用自己的 DSH 状态目录。
5. Workspace、Session、事件流、顺序、请求队列和插件变更由同一套 DSH Host 处理。多个浏览器连接读取同一个持久状态。隧道中断时重新连接同一设备即可打开原会话。
6. 能用 systemd 用户服务时优先托管，其他环境以独立进程启动。服务重启后从原 `DSH_HOME` 加载工作区和会话。同一次任务在服务重启后的内存状态取决于 DSH。

## Desktop 与远端插件

Desktop 插件以标准 DSH bundle 的方式发布，Host API 注册在 DSH 的 owner 专用 Connection 路由下。远端通过固定版本的 pnpm 保留官方 Web Host 的插件安装、激活与版本校验路径。服务器认证依据 SSH 用户和 DSH 授权 Cookie。同一 Unix 账号下经 SSH 登录的设备共享该 DSH Host 的 owner 权限。

首次安装若缺少依赖或磁盘空间，暂存目录会尽量清理。普通重连复用健康服务。版本升级不得覆盖 `data/`。首次版本提供断线后重新连接和数据恢复，生产服务器滚动升级与自动客户端重连尚待实现。
