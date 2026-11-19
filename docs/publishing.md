# 发布与安装

项目名称：**DSH-Remote-Tool**。npm 包名和主命令：`dsh-remote-tool`，当前版本 `0.3.1`。npm 新包名要求小写。原命令别名 `dsh-remote` 继续可用，升级保留原设备配置和远端数据目录。

## npm 一键安装

先在 DSH Desktop 应用菜单安装自带的 `dsh` 命令，至少启动一次 Desktop，然后完全退出应用。在新终端运行：

```bash
npx --yes dsh-remote-tool@latest install
# 或保留全局 CLI：
npm install --global dsh-remote-tool
dsh-remote-tool install
```

普通安装不需要 npm 登录。`dsh-remote-tool connect <SSH 主机>` 可直接建立浏览器工作区连接。

## 现在可用的 GitHub 安装

先在 DSH Desktop 应用菜单安装自带的 `dsh` 命令，至少启动一次 Desktop，然后完全退出应用。在新终端运行：

```bash
npx --yes --package=https://github.com/Ande-ZH/DSH-Remote-Tool/archive/refs/tags/v0.3.1.tar.gz dsh-remote-tool install
```

可加 `--dsh "/绝对路径/dsh"` 指定 Desktop 安装提供的命令；Windows 对应 `dsh.cmd`。npm 版 DSH CLI 不能修改 Desktop profile。使用 `--profile web` 可安装到 Web profile。插件归档保留在 `~/.dsh-remote/packages/`，供 profile 中的文件依赖持续使用，卸载插件后才可移除对应归档。

也可以仅安装全局 CLI，再通过 `dsh-remote-tool install` 安装插件，或直接运行 `dsh-remote-tool connect <SSH 主机>`：

```bash
npm install --global https://github.com/Ande-ZH/DSH-Remote-Tool/archive/refs/tags/v0.3.1.tar.gz
```

这里使用 npm 支持的 HTTP 归档来源，直接消费已提交的 `dist/`，避免 Git 依赖安装时重新安装全部开发依赖。源码开发仍使用 `npm ci`、`npm run build` 和 `npm pack`。

## 手动发布到 npmjs.org

维护者在仓库根目录构建和验证后发布。每次发布前递增版本，归档名与 `package.json` 保持一致。

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm ci
npm run build
npm test
npm pack --silent
npm publish ./dsh-remote-tool-0.3.1.tgz --access public --registry=https://registry.npmjs.org/
```

npm 接受上传后还可能进行发布时扫描，通常约 5 分钟，繁忙时可能达到 15 分钟或更久。命令输出成功不代表立即可安装；首次发布等待期间可能仅能查询到 `0.0.0-stage` 占位版本。以 registry 返回目标版本、`latest` 指向该版本，并能实际运行安装命令为准。不要为了等待扫描重复发布或递增版本。

```bash
npm view dsh-remote-tool version dist-tags --registry=https://registry.npmjs.org/ --prefer-online
npx --yes dsh-remote-tool@latest --help
```

npm 的同一个版本不能重复发布；每次发布须同步更新 `package.json`、`package-lock.json`、文档里的版本和 Git 标签。

## GitHub Actions 后续发布

仓库提供手动触发的 `.github/workflows/publish.yml`，当前不会自动执行 npm 发布。

首次发布后，在 npm 包的 Settings → Trusted Publisher 中添加 GitHub Actions，填写：

| 项目 | 值 |
| --- | --- |
| Organization or user | `Ande-ZH` |
| Repository | `DSH-Remote-Tool` |
| Workflow filename | `publish.yml` |
| Environment | 留空 |

如果 npm 设置提供操作权限选项，允许直接 `npm publish`。工作流使用 GitHub 托管 runner、Node.js 24、npm 11 和 OIDC，不需要保存 npm 发布 token。配置完成后，在 GitHub Actions 选择 **Publish to npm → Run workflow**，选择 `main` 并输入与 `package.json` 完全相同的版本。工作流构建、测试并检查已提交的 bundle，再发布附带 provenance 的包。已经发布过的版本应先递增，避免重复发布。

`.github/workflows/ci.yml` 在提交或 PR 时运行 Node.js 22/24 构建与测试，并通过真实 DSH Web profile 验证 npm 安装器、归档保留和插件激活。Desktop 内的最终交互仍需在相应平台验证。

参考：[npm 包命名规则](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#name)、[npm HTTP/Git 安装说明](https://docs.npmjs.com/cli/v11/commands/npm-install/)、[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)、[npm 发布时扫描及可用性延迟](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)。
