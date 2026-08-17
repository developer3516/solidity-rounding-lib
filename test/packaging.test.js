const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guard the published package contents.
 *
 * Three libraries shipped across PRs #1-#3 and none of them was added to the
 * `files` array, so `npm install solidity-rounding-lib` delivered only
 * `Rounding.sol`. Importing `SharesMath.sol` from an installed copy failed at
 * compile time with a missing-file error — and nothing in the test suite had
 * any reason to notice, because the tests import from the working tree.
 *
 * This closes that gap: every library contract must be listed, and every
 * listed file must exist.
 */
describe('packaging', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  /** Library contracts — everything under contracts/ except test and example code. */
  const libraryContracts = fs
    .readdirSync(path.join(root, 'contracts'))
    .filter((name) => name.endsWith('.sol'))
    .map((name) => `contracts/${name}`);

  it('finds the library contracts it is meant to be checking', () => {
    // A guard on the guard: if the directory read ever comes back empty, the
    // assertion below would pass vacuously.
    expect(libraryContracts.length).to.be.greaterThan(3);
  });

  it('ships every library contract', () => {
    const missing = libraryContracts.filter((f) => !pkg.files.includes(f));

    expect(missing, `not in package.json files: ${missing.join(', ')}`).to.deep.equal([]);
  });

  it('lists nothing that does not exist', () => {
    const stale = pkg.files.filter((f) => !fs.existsSync(path.join(root, f)));

    expect(stale, `listed but missing: ${stale.join(', ')}`).to.deep.equal([]);
  });

  it('does not ship test harnesses or examples', () => {
    // They pull in OpenZeppelin and Solmate, which are dev-only. Shipping them
    // would turn a dependency-free library into one with a dependency tree.
    const shipped = pkg.files.filter((f) => f.includes('/test/') || f.includes('/examples/'));

    expect(shipped).to.deep.equal([]);
  });

  it('keeps the published library free of external imports', () => {
    // The install instructions say the contracts can simply be vendored. That
    // is only true while they import nothing but each other.
    for (const file of libraryContracts) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const imports = [...source.matchAll(/^\s*import\s+.*?["']([^"']+)["']/gm)].map((m) => m[1]);
      const external = imports.filter((i) => !i.startsWith('.'));

      expect(external, `${file} imports ${external.join(', ')}`).to.deep.equal([]);
    }
  });
});