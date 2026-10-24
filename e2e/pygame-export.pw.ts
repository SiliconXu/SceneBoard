import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'

async function fixture(page: Page, kind: 'color' | 'image', name = 'cat.png') {
  const sources = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 20
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 12, 20)
    ctx.fillStyle = 'rgba(0,255,0,.5)'; ctx.fillRect(12, 0, 16, 20)
    const actor = c.toDataURL('image/webp', 1)
    ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 40, 20)
    const dog = c.toDataURL('image/jpeg', 1)
    c.width = 320; c.height = 240
    ctx.fillStyle = '#203040'; ctx.fillRect(0, 0, 320, 240)
    return { actor, dog, bg: c.toDataURL('image/jpeg', 1) }
  })
  await page.getByTestId('project-input').setInputFiles({ name: 'scene.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    version: 3,
    background: kind === 'color' ? { kind, name: '纯色背景', color: '#203040', width: 320, height: 240 } : { kind, name: '中文地图.jpg', src: sources.bg, width: 320, height: 240 },
    layers: [
      { id: 'cat', name, src: sources.actor, x: 20.25, y: 30.5, width: 80.5, height: 40.25 },
      { id: 'dog', name: 'dog', src: sources.dog, x: 60, y: 50, width: 40, height: 20 },
      { id: 'shape', kind: 'rectangle', name: '辅助区域', color: '#ffffff', x: 0, y: 0, width: 20, height: 20 },
    ],
  })) })
  await expect(page.getByRole('status')).toContainText('项目已恢复')
}
async function openExport(page: Page) {
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByRole('button', { name: '导出 Pygame Zero 项目…' }).click()
  return page.getByRole('dialog', { name: '导出 Pygame Zero 项目', exact: true })
}
async function downloadBytes(page: Page, action: () => Promise<unknown>) {
  const pending = page.waitForEvent('download'); await action()
  return readFile((await (await pending).path())!)
}

test('create, recolor, save and reopen a solid background; cancel replacements and reject invalid input', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '创建纯色背景', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('画布宽度')).toHaveValue('800')
  await expect(dialog.getByLabel('画布高度')).toHaveValue('600')
  await expect(dialog.getByLabel('背景颜色值')).toHaveValue('#000000')
  await dialog.getByLabel('画布宽度').fill('10000'); await dialog.getByLabel('画布高度').fill('10000')
  await dialog.getByRole('button', { name: '创建画布' }).click()
  await expect(dialog.getByRole('alert')).toContainText('6400 万')
  await dialog.getByLabel('画布宽度').fill('320'); await dialog.getByLabel('画布高度').fill('240')
  await dialog.getByLabel('背景颜色值').fill('invalid')
  await dialog.getByRole('button', { name: '创建画布' }).click()
  await expect(dialog.getByRole('alert')).toContainText('十六进制')
  await dialog.getByLabel('背景颜色值').fill('#000000'); await dialog.getByRole('button', { name: '创建画布' }).click()
  await expect(page.getByTestId('stage')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await expect(page.getByTestId('stage')).toHaveCSS('background-image', 'none')
  page.once('dialog', prompt => prompt.accept())
  await fixture(page, 'color')
  await page.getByRole('button', { name: '修改背景颜色' }).click()
  await expect(page.getByLabel('画布宽度')).toBeDisabled()
  await page.getByLabel('背景颜色值').fill('#123abc'); await page.getByRole('button', { name: '应用颜色' }).click()
  await expect(page.getByTestId('layer-card')).toHaveCount(3)
  await expect(page.getByTestId('stage')).toHaveCSS('background-color', 'rgb(18, 58, 188)')
  await expect(page.getByTestId('stage')).toHaveCSS('background-image', 'none')
  const saved = JSON.parse((await downloadBytes(page, () => page.getByRole('button', { name: '保存项目', exact: false }).click())).toString())
  expect(saved.version).toBe(3); expect(saved.background.color).toBe('#123abc'); expect(saved.background.src).toBeUndefined()
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await page.getByTestId('project-input').setInputFiles({ name: 'saved.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) })
  await expect(page.getByTestId('stage')).toHaveCSS('background-color', 'rgb(18, 58, 188)')
  await expect(page.getByTestId('stage')).toHaveCSS('background-image', 'none')
  await page.screenshot({ path: 'test-results/solid-background-web.png', fullPage: true })
  await page.getByRole('button', { name: '替换背景', exact: false }).click()
  await page.getByRole('button', { name: '创建纯色背景', exact: true }).click()
  await page.getByRole('button', { name: '创建画布' }).click()
  await expect(page.getByRole('dialog', { name: '替换背景？' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByTestId('layer-card')).toHaveCount(3)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const png = await downloadBytes(page, () => page.getByRole('button', { name: '合成图片' }).click())
  const pixel = await page.evaluate(async src => {
    const img = new Image(); img.src = src; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0)
    return [...ctx.getImageData(200, 100, 1, 1).data]
  }, `data:image/png;base64,${png.toString('base64')}`)
  expect(pixel).toEqual([18, 58, 188, 255])
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const coordinates = JSON.parse((await downloadBytes(page, () => page.getByRole('button', { name: '导出坐标' }).click())).toString())
  expect(coordinates.background.kind).toBe('color'); expect(coordinates.background.color).toBe('#123abc')
})

for (const kind of ['color', 'image'] as const) {
  test(`${kind} project ZIP matches preview, sizes, alpha, order and excludes guides`, async ({ page }) => {
    await page.goto('/'); await fixture(page, kind)
    if (kind === 'color') await expect(page.getByTestId('stage')).toHaveCSS('background-image', 'none')
    else await expect(page.getByTestId('stage')).toHaveCSS('background-image', /repeating-conic-gradient/)
    const dialog = await openExport(page)
    await expect(dialog).toContainText('1 个矩形／椭圆')
    const code = await dialog.getByLabel('Python 代码预览').textContent()
    await page.screenshot({ path: `test-results/pygame-preview-${kind}.png`, fullPage: true })
    expect(code).toContain('cat.pos = (61, 51)')
    const zip = await downloadBytes(page, () => dialog.getByRole('button', { name: '下载项目 ZIP' }).click())
    const files = unzipSync(zip)
    expect(strFromU8(files['pygame_project/main.py']!)).toBe(code)
    expect(Object.keys(files)).toHaveLength(kind === 'image' ? 5 : 4)
    expect(!!files['pygame_project/images/background.png']).toBe(kind === 'image')
    const pixels = await page.evaluate(async src => {
      const img = new Image(); img.src = src; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0)
      return { width: img.width, height: img.height, half: ctx.getImageData(40, 20, 1, 1).data[3], transparent: ctx.getImageData(78, 20, 1, 1).data[3] }
    }, `data:image/png;base64,${Buffer.from(files['pygame_project/images/cat.png']!).toString('base64')}`)
    expect(pixels).toEqual({ width: 81, height: 40, half: 128, transparent: 0 })
    expect([...files['pygame_project/images/dog.png']!.slice(1, 4)]).toEqual([80, 78, 71])
    await writeFile(`test-results/pygame-runtime-${kind}.zip`, zip)
    await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  })
}

test('invalid names block export and locate editing; empty scenes keep images/', async ({ page }) => {
  await page.goto('/'); await fixture(page, 'color', '小猫')
  let dialog = await openExport(page)
  await expect(dialog.getByRole('button', { name: '下载项目 ZIP' })).toBeDisabled()
  await dialog.getByRole('button', { name: '小猫 · 定位修改' }).click()
  await page.getByLabel('角色 / 物品名称').fill('cat.png'); await page.getByLabel('角色 / 物品名称').press('Enter')
  dialog = await openExport(page)
  await expect(dialog.getByLabel('Python 代码预览')).toContainText("cat = Actor('cat')")
  await dialog.getByRole('button', { name: '取消' }).click()
  while (await page.getByTestId('layer-card').count()) await page.getByRole('button', { name: /^删除(图片|图形)$/ }).first().click()
  dialog = await openExport(page)
  const zip = await downloadBytes(page, () => dialog.getByRole('button', { name: '下载项目 ZIP' }).click())
  expect(Object.keys(unzipSync(zip))).toEqual(['pygame_project/images/', 'pygame_project/main.py'])
  await expect(page.locator('.unsaved-dot')).toHaveCount(1)
  await writeFile('test-results/pygame-runtime-empty.zip', zip)
})
