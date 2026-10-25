import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { source, openScene, bytes, save, pixels, projectZip } from './round3-utils'

async function frames(page: Page) {
  const sources = await page.evaluate(() => {
    return [[43, 25, '#ff0000'], [40, 20, '#00ff00'], [39, 19, '#0000ff']].map(([width, height, color]) => {
      const canvas = document.createElement('canvas'); canvas.width = Number(width); canvas.height = Number(height)
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = String(color); ctx.fillRect(0, 0, canvas.width, canvas.height)
      return canvas.toDataURL()
    })
  })
  return sources.map((src, index) => ({ name: `original-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(src.split(',')[1]!, 'base64') }))
}
async function openManager(page: Page) {
  await page.getByRole('button', { name: '动画素材…' }).click()
  return page.getByRole('dialog', { name: '动画素材', exact: true })
}
async function setup(page: Page) {
  await page.goto('/'); await openScene(page, await source(page)); await save(page)
  const dialog = await openManager(page)
  await dialog.getByRole('button', { name: '新增组' }).click()
  await expect(dialog.getByLabel('动画 FPS')).toHaveValue('10')
  await dialog.getByLabel('动画名称前缀').fill('walk')
  await dialog.getByTestId('animation-input').setInputFiles(await frames(page))
  await expect(dialog.locator('.animation-frames li')).toHaveCount(3)
  return dialog
}

test('draft cancellation, atomic imports, ordering, normalized pixels and both exports', async ({ page }) => {
  let dialog = await setup(page)
  await expect(dialog).toContainText('43 × 25 px')
  await expect(dialog).toContainText('原尺寸不同')
  await dialog.getByRole('button', { name: '上移第 3 帧', exact: true }).click()
  await expect(dialog.locator('.animation-frames li').nth(1)).toContainText('original-2.png')
  await dialog.getByRole('button', { name: '下移第 2 帧', exact: true }).click()
  await dialog.locator('.animation-frames li').nth(2).dragTo(dialog.locator('.animation-frames li').nth(0), { targetPosition: { x: 20, y: 1 } })
  await expect(dialog.locator('.animation-frames li').first()).toContainText('original-2.png')
  await dialog.getByLabel('动画 FPS').fill('12')
  // A corrupt second image must not append the valid first image.
  await dialog.getByTestId('animation-input').setInputFiles([(await frames(page))[0]!, { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }])
  await expect(dialog).toContainText('导入失败')
  await expect(dialog.locator('.animation-frames li')).toHaveCount(3)
  const groupZip = unzipSync(await bytes(page, () => dialog.getByRole('button', { name: '导出本组帧 ZIP' }).click()))
  const expectedNames = ['walk/images/', 'walk/images/walk_001.png', 'walk/images/walk_002.png', 'walk/images/walk_003.png']
  expect(Object.keys(groupZip)).toEqual(expectedNames)
  const first = await pixels(page, groupZip['walk/images/walk_001.png']!)
  expect([first.width, first.height]).toEqual([43, 25])
  const at = (x: number, y: number) => first.data.slice((y * 43 + x) * 4, (y * 43 + x) * 4 + 4)
  expect(at(2, 3)).toEqual([0, 0, 255, 255]); expect(at(1, 3)[3]).toBe(0)
  // 40x20 is padded 1 left / 2 right and 2 top / 3 bottom.
  const third = await pixels(page, groupZip['walk/images/walk_003.png']!)
  const alphaAt = (x: number, y: number) => third.data[(y * 43 + x) * 4 + 3]
  expect(alphaAt(1, 2)).toBe(255); expect(alphaAt(40, 21)).toBe(255); expect(alphaAt(41, 21)).toBe(0); expect(alphaAt(40, 22)).toBe(0)
  await dialog.getByRole('button', { name: '应用到项目' }).click()
  const saved = await save(page)
  expect(saved.animations[0]).toMatchObject({ name: 'walk', fps: 12 })
  expect(saved.animations[0].frames.map((frame: { name: string }) => frame.name)).toEqual(['original-2.png', 'original-0.png', 'original-1.png'])
  expect(saved.layers).toHaveLength(2)
  const zipBytes = await projectZip(page), project = unzipSync(zipBytes)
  for (let i = 1; i <= 3; i++) {
    const name = `walk_00${i}.png`
    expect(project[`pygame_project/images/${name}`]).toEqual(groupZip[`walk/images/${name}`])
  }
  expect(strFromU8(project['pygame_project/main.py']!)).not.toContain('walk')
  await writeFile('test-results/pygame-runtime-animation.zip', zipBytes)
  await page.getByTestId('project-input').setInputFiles({ name: 'saved.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) })
  dialog = await openManager(page)
  await expect(dialog.getByLabel('动画 FPS')).toHaveValue('12')
  await dialog.getByLabel('动画名称前缀').fill('discarded')
  await dialog.getByRole('button', { name: '删除第 1 帧', exact: true }).click()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect((await save(page)).animations).toEqual(saved.animations)
})

test('multiple groups, invalid FPS, name conflicts locate groups, group deletion and background replacement', async ({ page }) => {
  let dialog = await setup(page)
  await dialog.getByLabel('动画 FPS').fill('1.5')
  await expect(dialog.getByRole('button', { name: '应用到项目' })).toBeDisabled()
  await dialog.getByLabel('动画 FPS').fill('60')
  await dialog.getByRole('button', { name: '新增组' }).click()
  await expect(dialog.getByRole('button', { name: '应用到项目' })).toBeDisabled()
  await expect(dialog.getByLabel('动画名称前缀')).toHaveValue('animation_1')
  await dialog.getByLabel('动画名称前缀').fill('walk')
  await dialog.getByTestId('animation-input').setInputFiles((await frames(page))[0]!)
  await expect(dialog.getByRole('button', { name: '导出本组帧 ZIP' })).toBeDisabled()
  await dialog.getByRole('button', { name: '应用到项目' }).click()
  await page.getByRole('button', { name: '导出', exact: true }).click(); await page.getByRole('button', { name: '导出 Pygame Zero 项目…' }).click()
  await expect(page.getByRole('button', { name: '下载项目 ZIP' })).toBeDisabled()
  await page.getByRole('button', { name: 'walk · 定位修改' }).last().click()
  dialog = page.getByRole('dialog', { name: '动画素材', exact: true })
  await expect(dialog.getByLabel('动画名称前缀')).toHaveValue('walk')
  await dialog.getByLabel('动画名称前缀').fill('run')
  await dialog.getByRole('button', { name: '应用到项目' }).click()
  // A scene name can collide with the generated frame stem.
  await page.locator('[data-card-id="hero"]').getByTestId('edit-name').click()
  await page.getByLabel('角色 / 物品名称').fill('run_001'); await page.getByLabel('角色 / 物品名称').press('Enter')
  dialog = await openManager(page)
  await dialog.getByRole('button', { name: /^run.*帧$/ }).click()
  await expect(dialog).toContainText('重复')
  await expect(dialog.getByRole('button', { name: '导出本组帧 ZIP' })).toBeDisabled()
  page.once('dialog', prompt => prompt.dismiss())
  await dialog.getByRole('button', { name: '删除组', exact: true }).click()
  await expect(dialog.locator('.animation-groups button[aria-pressed]')).toHaveCount(2)
  page.once('dialog', prompt => prompt.accept())
  await dialog.getByRole('button', { name: '删除组', exact: true }).click()
  await dialog.getByRole('button', { name: '应用到项目' }).click()
  const saved = await save(page); expect(saved.animations).toHaveLength(1)
  await page.getByRole('button', { name: '替换背景', exact: false }).click(); await page.getByRole('button', { name: '创建纯色背景', exact: true }).click()
  await page.getByRole('button', { name: '创建画布', exact: true }).click(); await page.getByRole('button', { name: '替换并清空', exact: true }).click()
  const replaced = await save(page); expect(replaced.layers).toHaveLength(0); expect(replaced.animations).toEqual(saved.animations)
  replaced.animations[0].frames[0].width = 1
  await page.getByTestId('project-input').setInputFiles({ name: 'bad.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replaced)) })
  await expect(page.locator('.toast')).toContainText('动画帧尺寸与图片不一致')
  expect((await save(page)).animations).toEqual(saved.animations)
})

test('FPS playback, stepping, keyboard isolation and cancellation stop the preview', async ({ page }) => {
  const dialog = await setup(page)
  await page.clock.install()
  await dialog.getByRole('button', { name: '播放', exact: true }).click()
  await page.clock.runFor(100)
  await expect(dialog.getByTestId('frame-counter')).toHaveText('2 / 3')
  await page.clock.runFor(200)
  await expect(dialog.getByTestId('frame-counter')).toHaveText('1 / 3')
  await dialog.getByRole('button', { name: '暂停', exact: true }).click()
  await page.clock.runFor(500)
  await expect(dialog.getByTestId('frame-counter')).toHaveText('1 / 3')
  await dialog.getByRole('button', { name: '下一帧', exact: true }).click()
  await expect(dialog.getByTestId('frame-counter')).toHaveText('2 / 3')
  await dialog.getByRole('button', { name: '上一帧', exact: true }).click()
  await page.keyboard.press('Delete')
  await expect(dialog.locator('.animation-frames li')).toHaveCount(3)
  await dialog.getByRole('button', { name: '播放', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.clock.runFor(1000)
  await expect(page.getByTestId('layer-card')).toHaveCount(2)
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '动画素材…' })).toBeFocused()
})

for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 900 }, { width: 1440, height: 900 }]) {
  test(`context controls and dialogs fit ${viewport.width}x${viewport.height} without canvas resizing`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const dialog = await setup(page)
    await expect(dialog.getByRole('button', { name: '应用到项目' })).toBeInViewport()
    await page.screenshot({ path: `test-results/round3-animation-${viewport.width}.png`, fullPage: true })
    await dialog.getByRole('button', { name: '应用到项目' }).click()
    const workspace = page.locator('.workspace'), before = await workspace.boundingBox()
    await page.locator('[data-card-id="shape"]').click({ modifiers: ['Control'] })
    expect(await workspace.boundingBox()).toEqual(before)
    await expect(page.getByRole('button', { name: '水平翻转', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: '水平等间距', exact: true })).toBeInViewport()
    await page.screenshot({ path: `test-results/round3-mixed-${viewport.width}.png`, fullPage: true })
    await page.locator('[data-card-id="hero"]').click()
    await page.getByRole('button', { name: '裁剪透明留白…' }).click()
    await expect(page.getByRole('button', { name: '确认裁剪' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '确认裁剪' })).toBeInViewport()
    await page.screenshot({ path: `test-results/round3-crop-preview-${viewport.width}.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('stage')).toHaveCSS('background-image', 'none')
  })
}
