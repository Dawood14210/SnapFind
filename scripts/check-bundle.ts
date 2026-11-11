import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { required } from './env'
const key = required('SUPABASE_SERVICE_ROLE_KEY')
let count = 0
async function walk(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) await walk(path)
    else {
      count++
      const content = await readFile(path, 'utf8')
      if (content.includes(key) || /SUPABASE_SERVICE_ROLE_KEY|service_role/.test(content)) throw new Error(`FAIL service-key marker detected in ${path}; key value redacted`)
    }
  }
}
await walk(fileURLToPath(new URL('../dist/', import.meta.url)))
if (!count) throw new Error('FAIL no bundle files; build first')
console.log(`PASS ${count} bundle files contain neither configured service key nor service-role markers`)
