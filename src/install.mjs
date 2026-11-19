import spawn from 'cross-spawn'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true })
    let output = ''
    child.stdout?.setEncoding('utf8').on('data', chunk => { output += chunk })
    child.once('error', error => reject(error.code === 'ENOENT'
      ? new Error('找不到 ' + command + '，请安装并加入 PATH，或用 --dsh 指定 Desktop 自带的 dsh 命令')
      : error))
    child.once('close', (code, signal) => {
      if (code === 0) resolve(output)
      else reject(new Error(command + ' 执行失败（' + (signal ?? code) + '），请查看上方输出'))
    })
  })
}

export async function install({ profile = 'desktop', dsh = 'dsh' } = {}) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await Promise.all(['client.js', 'host.cjs', 'magpie-agent.cjs'].map(name => access(join(root, 'dist', name))))
  await run(dsh, ['--version'], { stdio: ['ignore', 'pipe', 'inherit'] })

  // DSH records a file dependency. Keep it outside npx's disposable cache so
  // later profile installations can still resolve the original archive.
  const packages = join(homedir(), '.dsh-remote', 'packages')
  await mkdir(packages, { recursive: true })
  const directory = await mkdtemp(join(packages, version + '-'))
  let filename
  try {
    const output = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
      cwd: root, stdio: ['ignore', 'pipe', 'inherit'],
    })
    filename = JSON.parse(output)[0].filename
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  const archive = join(directory, filename)
  console.log('安装到 DSH ' + profile + '，插件归档：' + archive)
  await run(dsh, ['plugin', '--profile', profile, 'add', archive], { stdio: 'inherit' })
  console.log('插件已安装。重新打开 DSH，在侧栏进入「SSH 远程」。')
}
