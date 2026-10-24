const fs = require('node:fs/promises')
const path = require('node:path')

function inside(root, target) {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function validateFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('项目文件无效。')
  const names = new Set()
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || !(file.bytes instanceof Uint8Array) || !file.bytes.length || names.has(file.path)) throw new Error('项目文件无效或重复。')
    if (file.path !== 'main.py' && !/^images\/[a-z][a-z0-9_]{0,99}\.png$/.test(file.path)) throw new Error('项目文件路径无效。')
    if (/^images\/(con|prn|aux|nul|com[1-9]|lpt[1-9])\.png$/i.test(file.path)) throw new Error('不能使用 Windows 保留文件名。')
    names.add(file.path)
  }
  if (!names.has('main.py')) throw new Error('缺少 main.py。')
}

async function writeProject(root, requestedTarget, files) {
  validateFiles(files)
  const realRoot = await fs.realpath(root)
  const parent = await fs.realpath(path.dirname(requestedTarget))
  const leaf = path.basename(requestedTarget)
  if (!inside(realRoot, parent)) throw new Error('便携版只能保存到程序所在文件夹或其子文件夹中。')
  if (!leaf || leaf === '.' || leaf === '..' || leaf.length > 100 || /[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(leaf) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(leaf)) throw new Error('项目文件夹名称无效。')
  const target = path.join(parent, leaf)
  try { await fs.lstat(target); throw new Error('目标文件夹已存在，请更换项目名称或保存位置。') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = await fs.mkdtemp(path.join(parent, '.sceneboard-project-'))
  let reservedTarget = false
  try {
    await fs.mkdir(path.join(temporary, 'images'))
    for (const file of files) await fs.writeFile(path.join(temporary, file.path), file.bytes, { flag: 'wx' })
    // Reserve the final name exclusively; never replace an existing directory, even an empty one.
    try { await fs.mkdir(target); reservedTarget = true }
    catch (error) { if (error.code === 'EEXIST') throw new Error('目标文件夹已存在，请更换项目名称或保存位置。'); throw error }
    await fs.rename(path.join(temporary, 'images'), path.join(target, 'images'))
    // main.py appears last, after all images are available (also works on Windows).
    await fs.rename(path.join(temporary, 'main.py'), path.join(target, 'main.py'))
    reservedTarget = false
    return target
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
    if (reservedTarget) await fs.rm(target, { recursive: true, force: true })
  }
}

module.exports = { writeProject, validateFiles }
