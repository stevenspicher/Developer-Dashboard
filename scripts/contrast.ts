// Checks that every text colour token passes WCAG AA (4.5:1) on every surface,
// in both themes. Run with `npm run contrast`; exits 1 when anything fails.
import { readFileSync } from 'node:fs'

import { MIN_RATIO, SURFACE_TOKENS, TEXT_TOKENS, checkAll } from '../src/ui/contrast.ts'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const results = checkAll(css)

for (const theme of ['dark', 'light'] as const) {
  console.log(`\n${theme.toUpperCase()}  (text on ${SURFACE_TOKENS.join(' / ')}, minimum ${MIN_RATIO}:1)`)
  for (const text of [...TEXT_TOKENS, 'phosphor']) {
    const row = results.filter(r => r.theme === theme && r.text === text)
    console.log(`  ${text.padEnd(10)} ${row.map(r => `${r.ratio.toFixed(2)}${r.pass ? ' ' : '*'}`.padStart(7)).join('')}   ${row[0].surface === 'boot-bg' ? '(on the boot background)' : ''}`)
  }
}

const failures = results.filter(r => !r.pass)
if (failures.length) {
  console.error(`\n${failures.length} failing pair(s), marked *:`)
  for (const f of failures) console.error(`  ${f.theme}: ${f.text} on ${f.surface} is ${f.ratio.toFixed(2)}:1`)
  process.exit(1)
}
console.log('\nAll pairs pass.')
