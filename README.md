# DSH-Remote-Tool

[中文](README.zh-CN.md) · **English**

An SSH remote workspace plugin for DeepSeek Harness Desktop. It starts and reuses a DSH Web Host on a Linux machine, so clients connecting as the same Linux user can work with the same remote projects, sessions, and plugin configuration. It also provides a Magpie model management panel in DSH.

> The plugin interface currently uses Chinese labels. The instructions below include those labels in parentheses so they can be found in the interface.

## Features

- Connect to a saved SSH host from the DSH sidebar and open its remote workspace in Desktop. A system-browser option is available when the Desktop browser bridge is unavailable.
- Reuse one remote DSH Host per Linux user. Different clients connecting to that account share its persisted workspace and sessions.
- Install compatible DSH plugins in the remote Web Host through its plugin manager.
- Share the remote workspace's theme, font, and font size across clients connected to the same Host. Local Desktop settings remain separate.
- Provision Magpie alongside the remote Host, or reuse an existing gateway. Manage models through DSH's own UI components.
- Browse and search a remote Magpie gateway's model catalog, enable or disable eligible models, and sync selected models into the remote DSH model picker.
- Keep device management, SSH transport, Magpie integration, and UI components in separate modules.

## Requirements

**Local client**

- DeepSeek Harness Desktop with plugin support. An embedded-browser bridge is needed to show the remote workspace inside Desktop. The project recommends the Desktop `0.2.2-rc.5` series for this integration.
- OpenSSH client (`ssh`) on `PATH`. Configure and verify the server's host key before connecting. Desktop connections use non-interactive SSH, so add a passphrase-protected key to an SSH agent first.
- Node.js 22 or newer and npm for the installer and command-line client. Source builds also require development dependencies.
- For terminal installation into Desktop, install its bundled `dsh` command through the application's **Manage dsh Command…** menu, open Desktop once, then fully quit it. The npm version of DSH CLI cannot manage the Desktop profile. The archive installation option below does not require the bundled command.

**Remote host**

- Linux, Node.js **24.9 or newer**, npm, and `flock` from util-linux. `node`, `npm`, and `flock` must be available in a non-interactive SSH session.
- An SSH server that permits local TCP forwarding to its loopback interface.
- On first connection, access to the configured npm registry to install DSH `0.2.2-rc.1` and pnpm `11.25.0`, or matching preinstalled executables configured as described below.
- First connections also prepare Magpie `0.1.4539` for Linux amd64/arm64 and need GitHub Releases access. Existing gateways are reused; preinstalled binaries and disabling provisioning are supported.

## Install and connect

### One-command installation from GitHub

After preparing Desktop's bundled `dsh` command as described above, run:

```bash
npx --yes --package=https://github.com/Ande-ZH/DSH-Remote-Tool/archive/refs/tags/v0.3.0.tar.gz dsh-remote install
```

The GitHub archive contains built bundles, so installation needs neither a source build nor npm login. The installer delegates installation to DSH's plugin manager and retains its package archive in `~/.dsh-remote/packages/`, independent of the npx cache. Reopen Desktop after installation.

If the bundled command is not on `PATH`, append `--dsh "/absolute/path/to/dsh"` (on Windows, the bundled `dsh.cmd`). For an existing Web profile, append `--profile web`. Follow DSH's plugin compatibility and installation prompts.

The package has **not yet been published to npmjs.org**. GitHub installation works now; registry installation and trusted publishing are documented in [Publishing](docs/publishing.md).

### Archive installation

To build an archive yourself:

```bash
git clone https://github.com/Ande-ZH/DSH-Remote-Tool.git
cd DSH-Remote-Tool
npm ci
npm pack
```

This produces `dsh-shared-remote-0.3.0.tgz`. In DeepSeek Harness Desktop, open **Plugins → Add existing plugin** (`插件 → 添加已有插件`), enter the archive's absolute path, install it, and enable it. Copy the archive to the Desktop machine if built elsewhere.

### Connect a host

1. Connect once using your terminal's `ssh` command and verify the server's host-key fingerprint. The plugin uses your OpenSSH configuration, `known_hosts`, identities, and SSH agent. For example, after configuring the alias `de-vps`, check non-interactive access and remote dependencies.

   ```bash
   ssh -o BatchMode=yes de-vps 'node --version && npm --version && command -v flock'
   ```

2. In Desktop, open **SSH Remote** (`SSH 远程`) in the sidebar and choose **Add device** (`添加设备`). Enter a name and an SSH alias or `user@host`. Leave the SSH port empty to use your SSH configuration. The optional Magpie port can also be set here.
3. Select **Connect** (`连接`). The first connection prepares the remote runtime and starts the Host and Magpie. Configure a model in the remote DSH settings, open a project, and start a session. To resume from another computer, install the plugin there and connect to the same server as the same Linux user.

## Remote workspaces and plugins

The remote process uses the official `dsh --profile web` runtime. Install remote plugins from the **Plugins** section inside the remote workspace. The DSH plugin manager handles bundle installation, activation, version constraints, and installation approvals. For an archive or directory path, first copy the plugin to the server and enter its **remote absolute path**.

Host plugins, Web UI plugins, tools, and MCP configurations are supported when they are compatible with that DSH Web Host and the remote Linux architecture. Plugins requiring Electron preload, native windows, or Desktop-only extension points need the local Desktop environment. Local Desktop plugins, settings, and credentials are separate from those on the remote Host.

The remote Host is bound to loopback and reached through an SSH local forward. Its DSH data lives in `~/.local/share/dsh-remote/data/` on the server. Disconnecting a client or removing its device entry closes the local connection while the remote Host and its data remain. The launcher prefers a systemd user service when available and otherwise starts a detached process. A server policy that ends user processes at logout can affect persistence. After a Host restart, persisted sessions can be reopened. Check DSH's recovery state for tasks that were running during the restart. Reconnect manually after a tunnel failure.

Clients connecting as the same Linux user share the remote Host's owner access. Protect that SSH account and its keys accordingly.

## Manage remote Magpie models

1. Connecting prepares and starts Magpie when needed, or reuses an existing gateway on `127.0.0.1`. Add providers or sign in after a fresh installation to make models available. The plugin uses the device's **Magpie port** if set. Otherwise it reads `$XDG_CONFIG_HOME/magpie/settings.json`, or `~/.config/magpie/settings.json` when `XDG_CONFIG_HOME` is unset or not absolute, and falls back to port `3425`.
2. Open **Settings → Remote Models** (`设置 → 远程模型`) and choose a device, or select **Magpie Models** (`Magpie 模型`) on its SSH device card. Search by model name, ID, or provider.
3. Select models and click **Sync to remote DSH** (`同步到远程 DSH`). Connect the remote DSH Host first if prompted. The selected models appear in its existing model picker. Uncheck entries and sync again to remove them from the plugin-managed provider. Syncing an empty selection removes that provider. Other providers and the default model remain under DSH settings.
4. Use **Disable** (`停用`) or **Restore** (`恢复`) for eligible individual models. This changes the gateway's availability for every client using that Magpie instance. Controls require a native `magpie` CLI accessible to the SSH user, with the running gateway and CLI using the same configuration and user. Existing wildcard rules must be managed in Magpie. A gateway exposed from Docker on the host's loopback port can be browsed and synced.

When a specific gateway key is required, store it on the remote host in `~/.local/share/dsh-remote/magpie-key`, owned by the SSH user and readable only by that user (`chmod 600`). The plugin reads the key on the remote host and stores it in the remote DSH credential store for the synced provider. Without that file it uses the local Magpie caller identifier `magpie-dsh-remote-tool`. See the [Magpie integration documentation](https://usemagpie.ai/docs/integrate) for gateway configuration.

## Preinstalled remote runtime

To avoid downloading the runtime during first connection, install exactly DSH `0.2.2-rc.1` and pnpm `11.25.0` on the remote Linux host. Create `~/.local/share/dsh-remote/config.json` with absolute executable paths, adjusting them to your installation.

```json
{
  "dshBin": "/opt/dsh/bin/dsh",
  "pnpmBin": "/opt/pnpm/bin/pnpm"
}
```

Both executables must report the expected version with `--version`. The pnpm executable must be named `pnpm`. Either setting may be omitted to let the launcher install that dependency. Runtime configuration takes effect the next time a Host is started.

The same configuration accepts `magpieBin` (an absolute preinstalled executable path), `magpiePort`, and `magpie: false` to disable provisioning. Provisioning checks executable availability and gateway health without SHA-256 verification. A Magpie failure leaves the DSH workspace available; the device page reports the failure and reconnecting retries it. The managed user service is `dsh-remote-magpie`, with a detached-process fallback. Disconnecting SSH leaves the gateway running.

Built-in workspace appearance uses DSH Host settings and updates across authenticated clients. Custom appearance plugins need Host-backed settings for their own options. The local Desktop shell keeps its separate settings.

## Command-line client

To keep `dsh-remote` available globally:

```bash
npm install --global https://github.com/Ande-ZH/DSH-Remote-Tool/archive/refs/tags/v0.3.0.tar.gz
dsh-remote connect de-vps
```

From a source checkout, run it with Node.js:

```bash
node bin/dsh-remote.mjs connect de-vps
node bin/dsh-remote.mjs connect user@example.com --port 2222 --no-open
```

The CLI prints a one-time local link valid for two minutes and opens it in the system browser unless `--no-open` is set. Keep the process running to maintain the tunnel. Press `Ctrl+C` to disconnect. Unlike the Desktop device page, the CLI can use interactive SSH authentication.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| SSH connection fails | Verify the host key, identity, agent, SSH alias, and non-interactive `PATH` with the command above. |
| SSH login works but forwarding fails | Ensure the server permits local TCP forwarding to `127.0.0.1`. |
| First startup fails | Check the remote Node.js version, npm registry access, permissions, disk space, and `flock`. Use the preinstalled runtime configuration when appropriate. |
| Embedded workspace does not open | Check that the Desktop build provides the browser bridge. Use the system-browser link when it does not. Reconnect if the tunnel has closed. |
| A local plugin is absent remotely | Install it in the remote workspace's plugin manager and check its Web Host and Linux compatibility. |
| Magpie catalog does not load | Check the gateway's loopback port, the saved device port, and the remote key file's ownership and permissions. |
| A model cannot be enabled or disabled | Check that the native CLI and gateway share the same user and configuration. Manage wildcard rules in Magpie. |
| Remote processes stop after logout | Check the remote systemd user manager and host policies for retaining user processes. |

## Development and verification

```bash
npm ci
npm run build
npm test
```

The source is divided by responsibility.

| Path | Responsibility |
| --- | --- |
| `src/plugin-host.mjs`, `src/services.mjs` | DSH Host integration and service composition |
| `bin/`, `src/install.mjs` | CLI and plugin installation |
| `src/devices.mjs`, `src/client.mjs` | Saved devices, connections, and SSH transport |
| `src/host.cjs`, `src/runtime/` | Remote Host and Magpie provisioning and lifecycle |
| `src/magpie/` | Magpie gateway operations and DSH model synchronization |
| `src/ui/` | DSH UI registration, device panel, and model management panel |
| `scripts/build.mjs`, `dist/` | Build script and generated client and remote agent bundles |

Run `npm run build` after changing the UI or remote Magpie modules. `npm pack` also builds automatically. Commit the regenerated `dist/` files with their source changes.

The Linux end-to-end test uses isolated SSH infrastructure and a real DSH Host. To install the pinned DSH runtime for the test, run `DSH_E2E_INSTALL=1 npm run test:e2e`. Alternatively, set `DSH_E2E_BIN` to an existing DSH executable. Set `DSH_E2E_MAGPIE_BIN` to a native Magpie executable to include model controls, synchronization, and a routed conversation. The package loader test uses `DSH_E2E_BIN` and `DSH_E2E_PLUGIN` with `npm run test:package`. The project has been tested with DSH `0.2.2-rc.1` and Magpie `0.1.4539`; the Windows Desktop UI has not yet been tested on a physical Windows client.

See [architecture and upstream audit](docs/architecture-audit.md) for source references and design details.

See the [remote Host plan](docs/remote-host-plan.zh-CN.md), [implementation and verification status](docs/implementation-status.zh-CN.md), and [publishing guide](docs/publishing.md) for details.

## License

[MIT](LICENSE)
