const { _electron, expect } = require('@playwright/test')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')

;(async () => {
  const executablePath = process.env.SCENEBOARD_EXECUTABLE
  const application = await _electron.launch(executablePath ? { executablePath } : { args: [path.join(__dirname, '..', 'electron/main.cjs')] })
  let page
  try {
    page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: '先放一张背景图片' })).toBeVisible()
    const locations = await application.evaluate(({ app }) => ({
      user: app.getPath('userData'), session: app.getPath('sessionData'), temp: app.getPath('temp'), logs: app.getPath('logs'), crashes: app.getPath('crashDumps'),
    }))
    const root = executablePath ? path.dirname(path.resolve(executablePath)) : path.resolve(__dirname, '..', '.portable-dev')
    for (const directory of Object.values(locations)) assert.ok(directory.startsWith(root + path.sep), `${directory} is outside the portable folder`)
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eeeeee'; ctx.fillRect(0, 0, 800, 600)
      return canvas.toDataURL().split(',')[1]
    })
    await page.getByTestId('background-input').setInputFiles({ name: 'portable-map.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    const projectPath = path.join(root, 'projects', 'smoke.frame.json')
    await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, projectPath)
    await page.getByRole('button', { name: '保存项目', exact: false }).click()
    await expect(page.getByRole('status')).toContainText('项目已保存')
    const project = JSON.parse(await fs.readFile(projectPath, 'utf8'))
    assert.equal(project.background.width, 800)
    assert.ok(project.background.src.startsWith('data:image/png;base64,'))
    // Cancel must leave the current project dirty.
    await page.getByTestId('layer-input').setInputFiles({ name: 'actor.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await application.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }) })
    await page.getByRole('button', { name: '保存项目', exact: false }).click()
    await expect(page.locator('.unsaved-dot')).toBeVisible()
    // An export outside the app folder must fail, rather than writing to this computer.
    await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, path.join(root, '..', 'outside.json'))
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByRole('button', { name: '导出坐标' }).click()
    await expect(page.getByRole('status')).toContainText('便携版只能保存')
    await page.getByRole('button', { name: '关闭提示' }).click()
    const pngPath = path.join(root, 'exports', 'smoke.png')
    await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, pngPath)
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByRole('button', { name: '合成图片' }).click()
    await expect(page.getByRole('status')).toContainText('合成 PNG 已导出')
    assert.equal((await fs.readFile(pngPath)).subarray(1, 4).toString(), 'PNG')
    // Single-object export must reach the desktop save bridge for every source format.
    for (const format of ['png', 'jpeg', 'webp']) {
      const image = await page.evaluate(format => {
        const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 10
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgba(0,255,0,.5)'; ctx.fillRect(0, 0, 10, 10)
        return canvas.toDataURL(`image/${format}`, 1).split(',')[1]
      }, format)
      const extension = format === 'jpeg' ? 'jpg' : format
      await page.getByTestId('layer-input').setInputFiles({ name: `sprite.${extension}`, mimeType: `image/${format}`, buffer: Buffer.from(image, 'base64') })
      const target = path.join(root, 'exports', `sprite-smoke.${extension}`)
      await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async (_window, options) => { globalThis.objectExportOptions = options; return { canceled: false, filePath: target } } }, target)
      await page.getByRole('button', { name: '导出', exact: true }).click()
      await page.getByRole('button', { name: '导出选中对象' }).click()
      await expect(page.locator('.toast')).toContainText('对象图片已导出')
      const output = await fs.readFile(target)
      const options = await application.evaluate(() => globalThis.objectExportOptions)
      assert.deepEqual(options.filters[0].extensions, [extension])
      if (format === 'png') assert.equal(output.subarray(1, 4).toString(), 'PNG')
      else if (format === 'jpeg') assert.deepEqual([...output.subarray(0, 3)], [255, 216, 255])
      else assert.equal(output.subarray(8, 12).toString(), 'WEBP')
      await page.getByRole('button', { name: '删除图片' }).first().click()
    }
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByRole('button', { name: '复制坐标' }).click()
    const copied = await application.evaluate(({ clipboard }) => clipboard.readText())
    assert.equal(JSON.parse(copied).background.width, 800)
    // Clear dirty state to close without the confirmation dialog.
    await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, projectPath)
    await page.getByRole('button', { name: '保存项目', exact: false }).click()
    await expect(page.locator('.unsaved-dot')).toHaveCount(0)
    await page.getByTestId('project-input').setInputFiles(projectPath)
    await expect(page.locator('.toast')).toContainText('项目已恢复')
    await expect(page.getByTestId('image-layer')).toHaveCount(1)
    console.log('Desktop smoke passed: local assets, portable paths, project/PNG save, PNG/JPEG/WebP object export, canceled save, path restriction, clipboard.')
  } finally { await application.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
