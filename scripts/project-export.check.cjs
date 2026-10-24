const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { writeProject, validateFiles } = require('../electron/project-export.cjs')
const files = [{ path: 'main.py', bytes: new Uint8Array([35, 32, 111, 107]) }, { path: 'images/cat.png', bytes: new Uint8Array([1, 2]) }]

test('desktop writes new folders and empty images/, rejects overwrite and escape', async () => {
  const workspace = path.resolve(__dirname, '..', 'test-results')
  await fs.mkdir(workspace, { recursive: true })
  const root = await fs.mkdtemp(path.join(workspace, 'project-export-'))
  try {
    const target = path.join(root, 'game')
    assert.equal(await writeProject(root, target, files), target)
    assert.equal(await fs.readFile(path.join(target, 'main.py'), 'utf8'), '# ok')
    assert.deepEqual([...await fs.readFile(path.join(target, 'images/cat.png'))], [1, 2])
    await assert.rejects(writeProject(root, target, files), /已存在/)
    const empty = path.join(root, 'empty')
    await fs.mkdir(empty)
    await assert.rejects(writeProject(root, empty, files), /已存在/)
    await writeProject(root, path.join(root, 'no_actors'), files.slice(0, 1))
    assert.deepEqual(await fs.readdir(path.join(root, 'no_actors/images')), [])
    await assert.rejects(writeProject(root, path.join(workspace, 'outside-game'), files), /便携版只能保存/)
    await assert.rejects(writeProject(root, path.join(root, 'nul'), files), /名称无效/)
    assert.ok(!(await fs.readdir(root)).some(name => name.startsWith('.sceneboard')))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('desktop rejects traversal, duplicate files and missing Python before writing', () => {
  for (const entry of ['../main.py', 'images/../main.py', '/main.py', 'images\\cat.png', 'images/cat.jpg', 'images/con.png']) {
    assert.throws(() => validateFiles([{ ...files[0], path: entry }]))
  }
  assert.throws(() => validateFiles([files[0], files[0]]))
  assert.throws(() => validateFiles([files[1]]))
})

test('desktop cleans up a failed final write and rejects junctions outside root', async () => {
  const workspace = path.resolve(__dirname, '..', 'test-results')
  const root = await fs.mkdtemp(path.join(workspace, 'project-failure-'))
  const outside = await fs.mkdtemp(path.join(workspace, 'project-outside-'))
  const originalRename = fs.rename
  try {
    const target = path.join(root, 'failed')
    fs.rename = async (from, to) => {
      if (path.basename(from) === 'main.py') throw new Error('simulated write failure')
      return originalRename(from, to)
    }
    await assert.rejects(writeProject(root, target, files), /simulated/)
    fs.rename = originalRename
    assert.deepEqual(await fs.readdir(root), [])
    await fs.symlink(outside, path.join(root, 'junction'), 'junction')
    await assert.rejects(writeProject(root, path.join(root, 'junction', 'escaped'), files), /便携版只能保存/)
    assert.deepEqual(await fs.readdir(outside), [])
  } finally {
    fs.rename = originalRename
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})
