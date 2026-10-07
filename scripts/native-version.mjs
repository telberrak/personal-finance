/**
 * Copies the version in package.json into the native projects, so store builds always match the
 * release. Run by `npm run native:sync` (or alone: `npm run native:version`).
 *
 * - Version name (shown in the stores): the same as package.json, e.g. 0.20.1.
 * - Build number (must increase with every upload): major × 10000 + minor × 100 + patch,
 *   e.g. 0.20.1 → 2001. To upload again without a new release, bump the patch version first.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!match) throw new Error(`package.json version "${version}" is not major.minor.patch`);
const [major, minor, patch] = match.slice(1).map(Number);
if (minor > 99 || patch > 99) throw new Error('minor and patch must be below 100 for the build number');
const build = major * 10000 + minor * 100 + patch;

function update(file, replacements) {
  let text = readFileSync(file, 'utf8');
  for (const [pattern, value] of replacements) {
    if (!pattern.test(text)) throw new Error(`${file}: ${pattern} not found`);
    text = text.replace(pattern, value);
  }
  writeFileSync(file, text);
}

update('android/app/build.gradle', [
  [/versionCode \d+/, `versionCode ${build}`],
  [/versionName "[^"]*"/, `versionName "${version}"`],
]);
update('ios/App/App.xcodeproj/project.pbxproj', [
  [/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`],
  [/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`],
]);
console.log(`Native apps set to version ${version} (build ${build}).`);
