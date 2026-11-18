/**
 * One-off live check (not part of the bundle): drive the real Host route
 * against the real OpenCode gateway, using the credential already stored in
 * ~/.dsh/.credentials.yaml. The key is read, used, and never printed.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { apply, OPENCODE_ENDPOINT } from '../index.js'

const yaml = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
const match = yaml.match(/^\s*OPENCODE_GO_API_KEY:\s*(\S+)/m)
if (match === null) {
  console.log('no OPENCODE_GO_API_KEY in the credential store')
  process.exit(0)
}
const key = match[1]

const routes = new Map()
const scope = {
  credentials: { async resolve(ref) { return ref === 'OPENCODE_GO_API_KEY' ? { value: key } : undefined } },
  webServer: { register(config) { routes.set(config.path, config); return () => {} } },
  effect(run) { run(); return () => {} },
  get() { return undefined },
}
apply({ inject: (names, run) => run(scope), effect: (run) => { run(); return () => {} } }, {})

const route = routes.get(OPENCODE_ENDPOINT)
const res = {
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) { this.headers[name] = value },
  end(body) { this.body = body ?? '' },
}
await route.handler({ method: 'GET', url: `${OPENCODE_ENDPOINT}?refresh=1` }, res)
console.log('status', res.statusCode)
console.log(JSON.stringify(JSON.parse(res.body), null, 2))
