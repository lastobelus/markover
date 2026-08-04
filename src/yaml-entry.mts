import { isMap, parseDocument } from 'yaml'

const api = { isMap, parseDocument }
const browserGlobal = globalThis as typeof globalThis & { MarkoverYaml: typeof api }
browserGlobal.MarkoverYaml = api
