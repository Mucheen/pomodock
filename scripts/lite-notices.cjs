// Generate the native dependency inventory and retain upstream license notices.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const metadata = JSON.parse(execFileSync('cargo', [
  'metadata', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--format-version', '1',
], { cwd: root, maxBuffer: 30_000_000 }))
const sections = [
  'Pomodock Lite — native third-party notices',
  'Generated from Cargo.lock and the upstream crate distributions. Includes build-time and platform-specific dependencies, not all of which are linked on each platform.',
  'Dependencies are unmodified. Exact source distributions, including notices and source headers, are available at each crates.io URL below. MPL-2.0 source is available through the same versioned source links.',
  'React/React DOM/Scheduler notices are provided separately in the root THIRD_PARTY_NOTICES.txt.',
]
const texts = new Map()
function retain(text) {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!texts.has(normalized)) texts.set(normalized, texts.size + 1)
  return texts.get(normalized)
}
function licenseFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!/^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(entry.name)) continue
    const target = path.join(directory, entry.name)
    if (entry.isFile()) files.push(target)
    else if (entry.isDirectory()) {
      for (const child of fs.readdirSync(target, { withFileTypes: true })) {
        if (child.isFile()) files.push(path.join(target, child.name))
      }
    }
  }
  return files.sort()
}
const packages = metadata.packages.filter(p => p.source).sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))
for (const pkg of packages) {
  const directory = path.dirname(pkg.manifest_path)
  const files = new Set(licenseFiles(directory))
  if (pkg.license_file) files.add(path.resolve(directory, pkg.license_file))
  const licenses = [...files].map(file => `${path.basename(file)}: text #${retain(fs.readFileSync(file, 'utf8'))}`)
  sections.push([
    `${pkg.name} ${pkg.version}`,
    `License: ${pkg.license || 'See upstream license file'}`,
    `Authors: ${pkg.authors.join('; ') || 'See upstream source attribution'}`,
    `Source: https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`,
    pkg.repository ? `Repository: ${pkg.repository}` : '',
    ...licenses,
    licenses.length ? '' : 'No standalone license file was included in this crate archive; retain its upstream license declaration and attribution above. See the versioned source distribution for source-level notices.',
  ].filter(Boolean).join('\n'))
}
const apiDirectory = path.join(root, 'node_modules/@tauri-apps/api')
const api = JSON.parse(fs.readFileSync(path.join(apiDirectory, 'package.json'), 'utf8'))
sections.push([
  `@tauri-apps/api ${api.version}`,
  `License: ${api.license}`,
  'Source: https://github.com/tauri-apps/tauri/tree/tauri-v' + api.version + '/packages/api',
  ...licenseFiles(apiDirectory).map(file => `${path.basename(file)}: text #${retain(fs.readFileSync(file, 'utf8'))}`),
].join('\n'))
for (const [body, id] of texts) sections.push(`License / notice text #${id}\n\n${body}`)
const destination = path.join(root, 'src-tauri/THIRD_PARTY_NOTICES.txt')
fs.writeFileSync(destination, sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n')
console.log(`Native notices: ${packages.length} crates; ${texts.size} distinct license/notice texts; ${fs.statSync(destination).size} bytes`)
