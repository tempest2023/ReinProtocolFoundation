import { execFileSync, spawn } from 'node:child_process'
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const testPort = process.env.PLAYWRIGHT_PORT ?? '3100'
const apiPort = process.env.SUPABASE_E2E_API_PORT ?? '55321'
const databasePort = process.env.SUPABASE_E2E_DB_PORT ?? '55322'
const projectId = `rein-e2e-${process.pid}`

function versionTuple(output) {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : null
}

function supportsCurrentConfig(binary) {
  try {
    const version = versionTuple(execFileSync(binary, ['--version'], { encoding: 'utf8' }))
    return Boolean(version && (version[0] > 2 || (version[0] === 2 && version[1] >= 100)))
  } catch {
    return false
  }
}

async function executable(path) {
  if (!path) return false
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveSupabaseCli() {
  const pathCandidates = (process.env.PATH ?? '').split(delimiter).map((directory) => join(directory, 'supabase'))
  const candidates = [process.env.SUPABASE_CLI, '/opt/homebrew/bin/supabase', ...pathCandidates].filter(Boolean)
  for (const candidate of [...new Set(candidates)]) {
    if (await executable(candidate) && supportsCurrentConfig(candidate)) return candidate
  }
  throw new Error('Supabase CLI 2.100 or newer is required. Install or upgrade it, or set SUPABASE_CLI to its executable path.')
}

function run(binary, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    })
    let stdout = ''
    if (options.capture) child.stdout.on('data', (chunk) => { stdout += chunk })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`${binary} ${args.join(' ')} exited with ${signal ?? code}.`))
    })
  })
}

function replacePort(config, from, to) {
  return config.replaceAll(String(from), String(to))
}

function requiredStatusValue(status, names) {
  for (const name of names) {
    const value = status[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  throw new Error(`Local Supabase status did not provide ${names.join(' or ')}.`)
}

let temporaryRoot
let supabaseCli

try {
  supabaseCli = await resolveSupabaseCli()
  temporaryRoot = await mkdtemp(join(tmpdir(), 'rein-e2e-'))
  const temporarySupabase = join(temporaryRoot, 'supabase')
  await mkdir(temporarySupabase)
  await cp(join(repositoryRoot, 'supabase', 'migrations'), join(temporarySupabase, 'migrations'), { recursive: true })

  let config = await readFile(join(repositoryRoot, 'supabase', 'config.toml'), 'utf8')
  config = config.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`)
  for (const [from, to] of [
    [54321, apiPort],
    [54322, databasePort],
    [54320, Number(databasePort) - 2],
    [54329, Number(databasePort) + 7],
    [54323, Number(databasePort) + 1],
    [54324, Number(databasePort) + 2],
    [54325, Number(databasePort) + 3],
    [54326, Number(databasePort) + 4],
  ]) config = replacePort(config, from, to)
  config = config.replaceAll('http://localhost:3000', `http://127.0.0.1:${testPort}`)
  // Storage stays enabled because the production migration creates its bucket
  // and RLS policies. The storage API itself is excluded from the running test stack.
  for (const section of ['realtime', 'studio', 'local_smtp', 'storage.s3_protocol', 'edge_runtime', 'analytics', 'experimental.pgdelta']) {
    const enabledSetting = new RegExp(`(\\[${section.replace('.', '\\.')}\\]\\s*\\nenabled\\s*=\\s*)true`)
    config = config.replace(enabledSetting, '$1false')
  }
  await writeFile(join(temporarySupabase, 'config.toml'), config)

  console.log(`Starting isolated Supabase project ${projectId}...`)
  await run(supabaseCli, [
    'start', '--workdir', temporaryRoot, '--yes',
    '--exclude', 'realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,mailpit',
  ], { capture: true })

  const statusText = await run(supabaseCli, ['status', '--workdir', temporaryRoot, '--output', 'json'], { capture: true })
  const status = JSON.parse(statusText)
  const supabaseUrl = requiredStatusValue(status, ['API_URL'])
  const publishableKey = requiredStatusValue(status, ['PUBLISHABLE_KEY'])
  const secretKey = requiredStatusValue(status, ['SECRET_KEY'])

  const testEnvironment = {
    ...process.env,
    PLAYWRIGHT_E2E_DATA: '1',
    PLAYWRIGHT_PORT: testPort,
    NEXT_DIST_DIR: '.next-e2e-data',
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${testPort}`,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: secretKey,
    DATABASE_ENVIRONMENT: 'dev',
    ADMIN_EMAILS: 'e2e-admin@example.test',
    RESEND_API_KEY: '',
    RESEND_FROM_EMAIL: '',
    OPENAI_API_KEY: '',
    E2E_RUN_ID: `${Date.now()}-${process.pid}`,
  }

  await run('npm', ['exec', '--', 'playwright', 'test', '--project=data-chromium'], { env: testEnvironment })
} finally {
  if (supabaseCli && temporaryRoot) {
    try {
      await run(supabaseCli, ['stop', '--workdir', temporaryRoot, '--project-id', projectId, '--no-backup', '--yes'])
    } catch (error) {
      console.error(`Could not stop the isolated Supabase project: ${error.message}`)
    }
  }
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
}
