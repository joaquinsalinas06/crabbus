// Run: node tools/check-english.ts
// Verifies that no untranslated Spanish characters or legacy identifiers remain outside explicitly whitelisted compatibility files/blocks.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

const SCAN_TARGETS = [
  'src',
  'hooks',
  'tools',
  'skills',
  'spec',
  'tests',
  '.claude-plugin',
  'README.md',
  'DECISIONS.md',
]

// Files completely excluded from the Spanish scan (compatibility mapper, frozen fixtures, and this script itself)
const WHITELISTED_FILES = new Set([
  'tools/check-english.ts',
  'src/legacy.ts',
  'spec/fixtures/spanish-designs.ts',
  'spec/fixtures/art-v03.ts',
])

const SPANISH_CHARS = /[áéíóúñÁÉÍÓÚÑ¿¡]/
const SPANISH_WORDS = /\b(pieza|disfraz|accion|reglas|paquete|ranura|ancla|capas|dibujos|paleta|cuerpo|ojos|cabeza|espalda|mano|pinza|suelo|tarjeta|adorno|jugada|pase|recibe|etiqueta|cuando|herramienta|entrada|estado|prioridad|dura|efecto|atenuar|pasos|cada|periodo|fijo|oculto|salto|temblor|patas|brazoIzq|brazoDer|ancho|patada|azar|sale|activos|apodo|siLibre|textos|desde|hasta|tapaOjos|cubreAccion|ocupa|dormido|terminado|fallo|bloqueado|pensando|trabajando|inicio|gorro|bigote|lupa|casco|pico|corbata|antena|corona|sable|libro|lapiz|tubo|globo|llave|cruz|bandera|estrella|pelota|giro|futbol|maestro|disenar|cangrejo|carpeta|exportar|importar|recargar|lista|diseno|encaje|flota)\b/i

function isWhitelistedLine(relPath: string, line: string): boolean {
  // Bilingual trigger keywords in skills/design/SKILL.md frontmatter description
  if (relPath === 'skills/design/SKILL.md' && line.startsWith('description:')) return true
  // Documented compatibility aliases in skills/design/SKILL.md, README.md, and DECISIONS.md
  if ((relPath === 'skills/design/SKILL.md' || relPath === 'README.md' || relPath === 'DECISIONS.md') && /(\/disfraz|--diseno|--disfraz|\.cangrejo\.json)/.test(line)) return true
  // Explicit legacy command/CLI alias lines in hooks/register.tsx and tools/preview.ts
  if (relPath === 'hooks/register.tsx' && (/sub === '(carpeta|recargar|exportar|importar|migrar)'/.test(line) || /\(crab\|cangrejo\)/.test(line) || /\b(name|command): 'disfraz'/.test(line))) return true
  if (relPath === 'tools/preview.ts' && /'--(diseno|disfraz)'/.test(line)) return true
  return false
}

function collectFiles(targetPath: string, out: string[] = []): string[] {
  const st = statSync(targetPath)
  if (st.isFile()) {
    out.push(targetPath)
    return out
  }
  for (const ent of readdirSync(targetPath, { withFileTypes: true })) {
    // Hidden directories include nested .crabbus worktrees; never scan repository copies.
    if (ent.name.startsWith('.')) continue
    const full = join(targetPath, ent.name)
    if (ent.isDirectory()) collectFiles(full, out)
    else if (/\.(ts|tsx|md|json)$/.test(ent.name)) out.push(full)
  }
  return out
}

export interface Violation {
  file: string
  line: number
  match: string
  text: string
}

export function checkEnglish(rootDir = ROOT): Violation[] {
  const files: string[] = []
  for (const target of SCAN_TARGETS) {
    collectFiles(join(rootDir, target), files)
  }

  const violations: Violation[] = []
  for (const file of files) {
    const rel = relative(rootDir, file).replace(/\\/g, '/')
    if (WHITELISTED_FILES.has(rel)) continue

    const lines = readFileSync(file, 'utf8').split('\n')
    let inLegacyBlock = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.includes('legacy-spanish-test-start')) {
        inLegacyBlock = true
        continue
      }
      if (line.includes('legacy-spanish-test-end')) {
        inLegacyBlock = false
        continue
      }
      if (inLegacyBlock || isWhitelistedLine(rel, line)) continue

      const charMatch = line.match(SPANISH_CHARS)
      if (charMatch) {
        violations.push({ file: rel, line: i + 1, match: charMatch[0], text: line.trim() })
        continue
      }
      const wordMatch = line.match(SPANISH_WORDS)
      if (wordMatch) {
        violations.push({ file: rel, line: i + 1, match: wordMatch[0], text: line.trim() })
      }
    }
  }
  return violations
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = checkEnglish()
  if (violations.length > 0) {
    console.error(`Found ${violations.length} Spanish violation(s):`)
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} [${v.match}] -> ${v.text}`)
    }
    process.exit(1)
  } else {
    console.log('check-english: 0 violations found.')
  }
}
