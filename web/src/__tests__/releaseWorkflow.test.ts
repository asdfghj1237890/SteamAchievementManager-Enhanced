import { describe, expect, it } from 'vitest'
import workflowRaw from '../../../.github/workflows/release.yml?raw'

// release.yml keeps the updater signing key away from build-time code: the step that
// compiles (frontend build, cargo build scripts, proc-macros) runs without it, and only
// the emptiness check and `tauri bundle` get it. A later edit that puts the key back on a
// build step, or pastes a ${{ }} expression into a script, leaves the release working, so
// nothing else would notice. These read the workflow as text; a line scanner is enough
// for that, and there is no YAML parser among the dependencies.

interface Step {
  job: string
  /** Its `name:`, or the action it `uses:` when it has none. */
  name: string
  /** The `env:` entries the step runs with: the workflow's, its job's and its own. */
  env: string[]
  /** The `run:` script, one entry per non-blank line. */
  run: string[]
}

const isKey = (text: string, key: string) => text === `${key}:` || text.startsWith(`${key}: #`)

/** Every step of every job, read off the indentation. */
function scanSteps(yaml: string): Step[] {
  const workflowEnv: string[] = []
  const steps: (Step & { jobEnv: string[]; keyIndent: number })[] = []
  let inJobs = false
  let inSteps = false
  let jobIndent = -1
  let jobKeyIndent = -1
  let stepIndent = -1 // column of the "- " that opens each step of the current job
  let job = ''
  let jobEnv: string[] = []
  let step: (typeof steps)[number] | undefined
  // The `env:` map or `run:` script being collected, and the column of its key.
  let block: { into: string[]; indent: number; script: boolean } | undefined

  for (const raw of yaml.split(/\r?\n/)) {
    let text = raw.trim()
    let indent = raw.length - raw.trimStart().length
    if (block) {
      if (text === '' || indent > block.indent) {
        // In a script a "#" line is shell, and GitHub expands expressions there too.
        if (text !== '' && (block.script || !text.startsWith('#'))) block.into.push(text)
        continue
      }
      block = undefined
    }
    if (text === '' || text.startsWith('#')) continue

    // Whose `env:` a key on this line would be: the workflow's, the job's or the step's.
    let env: string[]
    if (indent === 0) {
      inJobs = isKey(text, 'jobs')
      jobIndent = -1
      step = undefined
      env = workflowEnv
    } else if (!inJobs) {
      continue
    } else if (jobIndent < 0 || indent === jobIndent) {
      jobIndent = indent
      job = text.replace(/:.*$/, '')
      jobEnv = []
      jobKeyIndent = -1
      inSteps = false
      continue
    } else if ((jobKeyIndent < 0 || indent === jobKeyIndent) && !(inSteps && text.startsWith('- '))) {
      jobKeyIndent = indent
      inSteps = isKey(text, 'steps')
      stepIndent = -1
      step = undefined
      env = jobEnv
    } else if (!inSteps) {
      continue
    } else {
      if (text.startsWith('- ') && (stepIndent < 0 || indent === stepIndent)) {
        stepIndent = indent
        // The step's first key sits on the "- " line itself.
        text = text.slice(2).trimStart()
        indent = raw.trimEnd().length - text.length
        step = { job, name: '', env: [], run: [], jobEnv, keyIndent: indent }
        steps.push(step)
      }
      if (!step || indent !== step.keyIndent) continue
      env = step.env
    }

    const [, key, value = ''] = /^(name|uses|env|run):\s*(.*)$/.exec(text) ?? []
    // A step without a name is reported by the action it uses.
    if (step && (key === 'name' || (key === 'uses' && step.name === ''))) step.name = value
    const into = key === 'env' ? env : key === 'run' ? step?.run : undefined
    if (!into) continue
    // "|" or ">" opens a block scalar; anything else is the value itself.
    if (value !== '' && !/^[|>][-+\d]*(\s+#.*)?$/.test(value)) into.push(value)
    block = { into, indent, script: key === 'run' }
  }

  return steps.map(({ job, name, env, run, jobEnv }) => ({ job, name, env: [...workflowEnv, ...jobEnv, ...env], run }))
}

// The key by name, or the whole `secrets` context (toJSON(secrets), secrets[...]).
const KEY = /TAURI_SIGNING_PRIVATE_KEY|\bsecrets\b(?!\.)/
const holdsKey = (step: Step) => step.env.some((line) => KEY.test(line))

// The two things a step holding the key may do: check that it is set — exactly these
// four lines, which neither print nor forward it — or run `tauri bundle` and nothing else.
const EMPTINESS_CHECK = [/^if \[ -z "\$\w+" \]; then$/, /^echo "::error::[^"$`\\]*"$/, /^exit 1$/, /^fi$/]
const BUNDLE = [/^npm run tauri -- bundle --bundles [a-z]+( [a-z]+)*$/]
const COMPILE = /\btauri\s+(--\s+)?build\b/
const isScript = (run: string[], script: RegExp[]) =>
  run.length === script.length && script.every((line, i) => line.test(run[i]))

/** Steps that get the signing key and are neither the emptiness check nor `tauri bundle`. */
function keyLeaks(yaml: string): string[] {
  return scanSteps(yaml)
    .filter((step) => holdsKey(step) && !isScript(step.run, EMPTINESS_CHECK) && !isScript(step.run, BUNDLE))
    .map((step) => `${step.job}: ${step.name}`)
}

/** Script lines with a ${{ }} expression, which GitHub pastes into the source the shell parses. */
function expressionsInRun(yaml: string): string[] {
  return scanSteps(yaml).flatMap((step) => step.run.filter((line) => line.includes('${{')))
}

describe('release.yml', () => {
  const steps = scanSteps(workflowRaw)
  const BUILD_JOBS = ['build-windows', 'build-macos']
  const inJob = (job: string) => steps.filter((step) => step.job === job)

  it('gives the updater signing key to nothing but the emptiness check and `tauri bundle`', () => {
    expect(keyLeaks(workflowRaw)).toEqual([])
  })

  it.each(BUILD_JOBS)('compiles without the key and bundles with it in %s', (job) => {
    const compile = inJob(job).filter((step) => step.run.some((line) => COMPILE.test(line)))
    const bundle = inJob(job).filter((step) => isScript(step.run, BUNDLE))
    expect(compile.map(holdsKey)).toEqual([false])
    expect(bundle.map(holdsKey)).toEqual([true])
  })

  it('pastes no ${{ }} expression into a run script', () => {
    expect(expressionsInRun(workflowRaw)).toEqual([])
  })

  it.each(BUILD_JOBS)('installs and compiles from the lockfiles in %s', (job) => {
    const lines = inJob(job).flatMap((step) => step.run)
    expect(lines.filter((line) => /\bnpm (ci|install|i)\b/.test(line))).toEqual(['npm ci --ignore-scripts'])
    // After the second "--", which is what tauri hands to cargo.
    expect(lines.filter((line) => COMPILE.test(line))).toEqual([
      expect.stringMatching(/^npm run tauri -- build\b.* -- (.* )?--locked( |$)/),
    ])
  })
})

// The checks above are only worth having if they fail on the edits they guard against,
// so each one is also run on a small workflow that makes that edit.
describe('the release.yml checks', () => {
  const SECRET = 'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'
  const check = [
    '- name: Check',
    '  env:',
    '    KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}',
    '  run: |',
    '    if [ -z "$KEY" ]; then',
    '      echo "::error::no key"',
    '      exit 1',
    '    fi',
  ]
  const compile = ['- name: Compile', '  run: npm run tauri -- build --no-bundle -- --locked']
  const bundle = ['- name: Bundle', '  env:', `    ${SECRET}`, '  run: npm run tauri -- bundle --bundles nsis']
  /** A one-job workflow from its top-level lines, the job's own keys and its steps. */
  const workflow = (top: string[], jobKeys: string[], steps: string[]) =>
    [
      ...top,
      'jobs:',
      '  build:',
      ...jobKeys.map((line) => `    ${line}`),
      '    steps:',
      ...steps.map((line) => `      ${line}`),
    ].join('\n')

  it('pass the compile / sign split', () => {
    const yaml = workflow([], ['runs-on: windows-latest'], [...check, ...compile, ...bundle])
    expect(keyLeaks(yaml)).toEqual([])
    expect(expressionsInRun(yaml)).toEqual([])
  })

  it('catch the key moved back onto the step that compiles', () => {
    const [name, run] = compile
    const withKey = [name, '  env:', `    ${SECRET}`, run]
    expect(keyLeaks(workflow([], [], [...check, ...withKey, ...bundle]))).toEqual(['build: Compile'])
  })

  it('catch the key set for a whole job or the whole workflow', () => {
    const steps = [...check, ...compile, ...bundle]
    expect(keyLeaks(workflow([], ['env:', `  ${SECRET}`], steps))).toEqual(['build: Compile'])
    expect(keyLeaks(workflow(['env:', `  ${SECRET}`], [], steps))).toEqual(['build: Compile'])
    expect(keyLeaks(workflow([], ['env:', '  ALL: ${{ toJSON(secrets) }}'], steps))).toEqual(['build: Compile'])
  })

  it.each([
    [['run: echo "$TAURI_SIGNING_PRIVATE_KEY" | base64']],
    [['run: npm run tauri -- build --bundles nsis']],
    [['run: npm run tauri -- bundle --bundles nsis && npm run upload']],
    [['run: |', '  if [ -z "$KEY" ]; then', '    echo "::error::no key"', '    exit 1', '  fi', '  npm run build']],
    [['run: |', '  if [ -z "$KEY" ]; then', '    echo "::error::$KEY"', '    exit 1', '  fi']],
    [['uses: some/action@v1']],
  ])('catch a key-holding step that does more than check or bundle: %j', (body) => {
    const step = ['- name: Extra', '  env:', `    ${SECRET}`, ...body.map((line) => `  ${line}`)]
    expect(keyLeaks(workflow([], [], [...check, ...step]))).toEqual(['build: Extra'])
  })

  it('catch an expression in a run script, inline or in a block, but not one in env', () => {
    const steps = [
      '- name: Inline',
      '  run: echo ${{ github.ref_name }}',
      '- name: Block',
      '  env:',
      '    TAG: ${{ github.ref_name }}',
      '  run: |',
      '    tag="${{ github.event.inputs.tag }}"',
      '',
      '    # ${{ github.sha }}',
      '    echo "$TAG"',
    ]
    expect(expressionsInRun(workflow([], [], steps))).toEqual([
      'echo ${{ github.ref_name }}',
      'tag="${{ github.event.inputs.tag }}"',
      '# ${{ github.sha }}',
    ])
  })
})
