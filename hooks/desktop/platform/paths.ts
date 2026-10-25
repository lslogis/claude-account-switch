import type { EngineInterface } from 'claude-code'

// Where things are on Windows. The data folder is reckoned as the script's
// Get-DefaultDataDir reckons it; the two must agree.

// The data folder's name: the name the stand-alone account-switcher mod used, kept
// so the sign-ins it saved stay where they are (the state's namespace is the
// plugin's own name, account-switch: platform/state.ts).
const PLUGIN_ID = 'account-switcher'

/** The variables the data folder is reckoned from. */
export type PathEnv = { USERPROFILE?: string; CLAUDE_CONFIG_DIR?: string }

/** `parts` joined into a Windows path, the separators at the joins left single. */
function joinPath(...parts: string[]) {
  return parts.map((part, i) => (i < parts.length - 1 ? part.replace(/[\\/]+$/, '') : part)).join('\\')
}

/** The switcher's data folder: the per-plugin data folder of the user's Claude configuration. */
export function dataDirOf(env: PathEnv) {
  const root = env.CLAUDE_CONFIG_DIR || (env.USERPROFILE ? joinPath(env.USERPROFILE, '.claude') : null)

  return root ? joinPath(root, 'plugins', 'data', PLUGIN_ID) : null
}

async function pathEnv($: EngineInterface): Promise<PathEnv> {
  const [config, user] = await Promise.all([$.env.get('CLAUDE_CONFIG_DIR'), $.env.get('USERPROFILE')])

  return { ...(config ? { CLAUDE_CONFIG_DIR: config } : {}), ...(user ? { USERPROFILE: user } : {}) }
}

export async function dataDir($: EngineInterface) {
  return dataDirOf(await pathEnv($))
}

/** File `name` of the data folder (as the script names it); null where there is no data folder. */
export async function dataFile($: EngineInterface, name: string) {
  const dir = await dataDir($)

  return dir ? joinPath(dir, name) : null
}

/** Windows PowerShell by its full path, whatever PATH holds. */
export async function powershell($: EngineInterface) {
  const root = await $.env.get('SystemRoot')

  return root ? joinPath(root, 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') : 'powershell.exe'
}
