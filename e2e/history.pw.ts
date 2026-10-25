import { test, expect, type Page } from '@playwright/test'
import { source, save, pixels, objectBytes, projectZip } from './round3-utils'
import { strFromU8, unzipSync } from 'fflate'

const undoButton = (page: Page) => page.getByRole('button', { name: '撤销', exact: true })
const redoButton = (page: Page) => page.getByRole('button', { name: '重做', exact: true })
const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`)
const actor = (page: Page, id: string) => page.locator(`[data-layer-id="${id}"]`)
const field = (page: Page, label: string) => page.getByRole('textbox', { name: `${label}（原图像素）`, exact: true })

async function setup(page: Page) {
  await page.goto('/')
  const src = await source(page)
  const project = {
    version: 4, background: { kind: 'color', name: '历史记录', color: '#203040', width: 320, height: 240 },
    layers: [
      { id: 'hero', kind: 'image', name: 'hero', src, x: 20.25, y: 30.5, width: 40, height: 24 },
      { id: 'dog', kind: 'image', name: 'dog', src, x: 100, y: 60, width: 40, height: 24 },
      { id: 'coin', kind: 'image', name: 'coin', src, x: 220, y: 100, width: 30, height: 18 },
      { id: 'shape', kind: 'rectangle', name: 'wall', color: '#536bdd', x: 200, y: 160, width: 30, height: 20 },
    ], animations: [],
  }
  await page.getByTestId('project-input').setInputFiles({ name: 'history.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.getByTestId('image-layer')).toHaveCount(4)
  await expect(undoButton(page)).toBeDisabled(); await expect(redoButton(page)).toBeDisabled()
  return project
}
async function edit(page: Page, label: string, text: string) {
  await field(page, label).fill(text); await field(page, label).press('Enter')
  await page.getByRole('heading', { name: '历史记录', exact: true }).click()
}
async function dragActor(page: Page, id: string, dx: number, dy: number) {
  const box = (await actor(page, id).boundingBox())!, stage = (await page.getByTestId('stage').boundingBox())!, scale = stage.width / 320
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx * scale, box.y + box.height / 2 + dy * scale, { steps: 12 }); await page.mouse.up()
}

test('drag is one step, save keeps history, and shortcuts restore exact saved status and redo branches', async ({ page }) => {
  const initial = await setup(page)
  await card(page, 'hero').click()
  await dragActor(page, 'hero', 30, 15)
  await expect(undoButton(page)).toHaveAttribute('title', /移动对象/)
  const moved = await save(page)
  expect(moved.layers[0].x).toBeCloseTo(50.25, 5)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.unsaved-dot')).toHaveCount(1)
  await expect(undoButton(page)).toBeDisabled()
  await page.keyboard.press('Control+y')
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await page.keyboard.press('Meta+z')
  expect((await save(page)).layers).toEqual(initial.layers)
  await page.keyboard.press('Meta+Shift+z')
  expect((await save(page)).layers).toEqual(moved.layers)
  await undoButton(page).click()
  await page.getByRole('button', { name: '水平翻转', exact: true }).click()
  await expect(redoButton(page)).toBeDisabled()
  await undoButton(page).click()
  expect((await save(page)).layers).toEqual(initial.layers)
})

test('numeric edits, rename, styles, flip and crop each undo fully and redo with matching image exports', async ({ page }) => {
  await setup(page)
  const states = [await save(page)]
  const actions = [
    async () => { await card(page, 'shape').click(); await page.getByRole('checkbox', { name: '数值输入保持比例' }).uncheck(); await edit(page, '宽', '42.125') },
    async () => { await card(page, 'shape').getByTestId('edit-name').click(); const name = page.getByLabel('角色 / 物品名称'); await name.fill('platform'); await name.press('Enter') },
    async () => { await page.getByRole('button', { name: '填充绿色' }).click() },
    async () => { await page.getByRole('button', { name: '边框红色' }).click() },
    async () => { await card(page, 'hero').click(); await page.getByRole('button', { name: '水平翻转', exact: true }).click() },
    async () => { await page.getByRole('button', { name: '裁剪透明留白…' }).click(); await page.getByRole('button', { name: '确认裁剪' }).click() },
  ]
  for (const action of actions) { await action(); states.push(await save(page)) }
  const cropped = await pixels(page, await objectBytes(page))
  expect([cropped.width, cropped.height]).toEqual([20, 14])
  for (let index = actions.length - 1; index >= 0; index--) {
    await undoButton(page).click()
    expect(await save(page)).toEqual(states[index])
  }
  await expect(undoButton(page)).toBeDisabled()
  for (let index = 1; index < states.length; index++) {
    await redoButton(page).click()
    expect(await save(page)).toEqual(states[index])
  }
  expect(await pixels(page, await objectBytes(page))).toEqual(cropped)
  const files = unzipSync(await projectZip(page))
  expect(strFromU8(files['pygame_project/main.py']!)).toContain('platform = Rect(')
  expect(await pixels(page, files['pygame_project/images/hero.png']!)).toEqual(cropped)
})

test('multi-object cut, paste, delete, align and distribute restore selections and stable ids', async ({ page }) => {
  const initial = await setup(page)
  await card(page, 'hero').click(); await card(page, 'dog').click({ modifiers: ['Control'] }); await card(page, 'coin').click({ modifiers: ['Control'] })
  const chosen = page.locator('[data-testid="image-layer"][aria-pressed="true"]')
  await page.getByRole('button', { name: '顶部对齐', exact: true }).click()
  const aligned = await save(page)
  await page.getByRole('button', { name: '水平等间距', exact: true }).click()
  const distributed = await save(page)
  await undoButton(page).click(); expect((await save(page)).layers).toEqual(aligned.layers)
  await redoButton(page).click(); expect((await save(page)).layers).toEqual(distributed.layers)
  await page.keyboard.press('Control+x')
  await expect(page.getByTestId('image-layer')).toHaveCount(1)
  await undoButton(page).click(); await expect(chosen).toHaveCount(3)
  await redoButton(page).click(); await expect(page.getByTestId('image-layer')).toHaveCount(1)
  await undoButton(page).click(); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v')
  const pasted = await save(page)
  expect(pasted.layers).toHaveLength(7)
  await undoButton(page).click(); await expect(chosen).toHaveCount(3)
  await redoButton(page).click(); expect((await save(page)).layers).toEqual(pasted.layers)
  await page.keyboard.press('Delete'); await undoButton(page).click()
  expect((await save(page)).layers).toEqual(pasted.layers)
  expect(initial.layers[0]!.x).toBe(20.25)
})

test('held arrow movement merges, resize is one step, and selecting or panning creates no history', async ({ page }) => {
  const initial = await setup(page)
  await card(page, 'hero').click()
  for (let i = 0; i < 12; i++) await page.keyboard.down('ArrowRight')
  await page.keyboard.up('ArrowRight')
  await expect(undoButton(page)).toHaveAttribute('title', /微调位置/)
  await undoButton(page).click(); await expect(undoButton(page)).toBeDisabled()
  expect((await save(page)).layers).toEqual(initial.layers)
  const handle = (await page.getByTestId('resize-se').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 30, handle.y + handle.height / 2 + 18, { steps: 10 }); await page.mouse.up()
  await undoButton(page).click(); await expect(undoButton(page)).toBeDisabled()
  const moving = (await actor(page, 'hero').boundingBox())!
  await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2); await page.mouse.down()
  await page.mouse.move(moving.x + moving.width / 2 + 20, moving.y + moving.height / 2 + 10)
  await page.keyboard.press('Control+z'); await page.mouse.up()
  await expect(undoButton(page)).toBeDisabled()
  expect((await save(page)).layers).toEqual(initial.layers)
  await card(page, 'dog').click()
  const stage = (await page.getByTestId('stage').boundingBox())!
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2); await page.mouse.wheel(0, -500)
  await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(stage.x + stage.width / 2 + 20, stage.y + stage.height / 2 + 20); await page.mouse.up(); await page.keyboard.up('Space')
  await page.getByRole('button', { name: '适应窗口' }).click()
  await expect(undoButton(page)).toBeDisabled()
  expect((await save(page)).layers).toEqual(initial.layers)
})

test('input native undo and modal editing never undo the scene', async ({ page }) => {
  await setup(page)
  await card(page, 'hero').click(); await page.keyboard.press('ArrowRight')
  await card(page, 'hero').getByTestId('edit-name').click()
  const name = page.getByLabel('角色 / 物品名称')
  await name.press('End'); await name.pressSequentially('_new')
  await name.press('Control+z')
  await expect(undoButton(page)).toHaveAttribute('title', /微调位置/)
  await name.press('Escape')
  expect((await save(page)).layers[0].x).toBe(21.25)
  await card(page, 'hero').click(); await field(page, 'X').focus(); await field(page, 'X').press('Control+z')
  await expect(undoButton(page)).toHaveAttribute('title', /微调位置/)
  await field(page, 'X').press('Escape')
  await page.getByRole('button', { name: '修改背景颜色', exact: true }).click()
  await page.getByLabel('背景颜色值').press('Control+z')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect((await save(page)).layers[0].x).toBe(21.25)
  await undoButton(page).click(); expect((await save(page)).layers[0].x).toBe(20.25)
})

test('background replacement is reversible, failed opens keep history, and a successful open clears it', async ({ page }) => {
  const initial = await setup(page)
  await page.getByRole('button', { name: '修改背景颜色', exact: true }).click()
  await page.getByLabel('背景颜色值').fill('#abcdef'); await page.getByRole('button', { name: '应用颜色' }).click()
  await undoButton(page).click(); await expect(page.getByTestId('stage')).toHaveCSS('background-color', 'rgb(32, 48, 64)')
  await redoButton(page).click()
  await page.getByRole('button', { name: '替换背景', exact: false }).click()
  await page.getByRole('button', { name: '创建纯色背景', exact: true }).click()
  await page.getByRole('button', { name: '创建画布' }).click(); await page.getByRole('button', { name: '替换并清空' }).click()
  await expect(page.getByTestId('image-layer')).toHaveCount(0)
  await undoButton(page).click(); await expect(page.getByTestId('image-layer')).toHaveCount(4)
  await expect(page.getByTestId('stage')).toHaveCSS('background-color', 'rgb(171, 205, 239)')
  await page.getByTestId('project-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.locator('.toast')).toContainText('打开项目失败')
  await expect(redoButton(page)).toBeEnabled()
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('project-input').setInputFiles({ name: 'again.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(initial)) })
  await expect(undoButton(page)).toBeDisabled(); await expect(redoButton(page)).toBeDisabled()
})

test('animation changes apply as one step, cancellation is ignored, and compact controls fit narrow layouts', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '动画素材…' }).click()
  await page.getByRole('button', { name: '新增组' }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(undoButton(page)).toBeDisabled()
  await page.getByRole('button', { name: '动画素材…' }).click(); await page.getByRole('button', { name: '新增组' }).click()
  await page.getByLabel('动画名称前缀').fill('walk'); await page.getByLabel('动画 FPS').fill('12')
  const src = await source(page)
  await page.getByTestId('animation-input').setInputFiles(['one', 'two'].map(name => ({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(src.split(',')[1]!, 'base64') })))
  await page.getByRole('button', { name: '上移第 2 帧', exact: true }).click()
  await page.getByRole('button', { name: '应用到项目' }).click()
  const applied = await save(page)
  expect(applied.animations[0].fps).toBe(12)
  expect(applied.animations[0].frames[0].name).toBe('two.png')
  await undoButton(page).click(); await expect(undoButton(page)).toBeDisabled()
  expect((await save(page)).animations).toEqual([])
  await redoButton(page).click(); expect((await save(page)).animations).toEqual(applied.animations)
  for (const width of [900, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(undoButton(page)).toBeInViewport(); await expect(redoButton(page)).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/history-controls-${width}.png`, fullPage: true })
  }
})

test('batch imports, drawn shapes and layer reordering undo in single steps and no-ops preserve redo', async ({ page }) => {
  await setup(page)
  const initial = await save(page), src = await source(page)
  await page.getByTestId('layer-input').setInputFiles(['extra_one', 'extra_two'].map(name => ({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(src.split(',')[1]!, 'base64') })))
  const added = await save(page)
  expect(added.layers).toHaveLength(6)
  await undoButton(page).click(); expect(await save(page)).toEqual(initial)
  await redoButton(page).click(); expect(await save(page)).toEqual(added)
  await undoButton(page).click()
  await card(page, 'hero').getByTestId('edit-name').click()
  const name = page.getByLabel('角色 / 物品名称')
  await name.fill('hero'); await name.press('Enter')
  await expect(redoButton(page)).toBeEnabled()
  await page.getByRole('button', { name: '绘制矩形', exact: true }).click()
  const stage = (await page.getByTestId('stage').boundingBox())!, scale = stage.width / 320
  await page.mouse.move(stage.x + 40 * scale, stage.y + 130 * scale); await page.mouse.down()
  await page.mouse.move(stage.x + 90 * scale, stage.y + 160 * scale, { steps: 8 }); await page.mouse.up()
  const drawn = await save(page)
  expect(drawn.layers[4]).toMatchObject({ name: 'rectangle_1', kind: 'rectangle', width: 50, height: 30 })
  await undoButton(page).click(); expect(await save(page)).toEqual(initial)
  await redoButton(page).click(); expect(await save(page)).toEqual(drawn)
  await page.getByTestId('layer-card').last().dragTo(page.getByTestId('layer-card').first(), { targetPosition: { x: 20, y: 2 } })
  const reordered = await save(page)
  expect(reordered.layers.map((layer: { id: string }) => layer.id)).not.toEqual(drawn.layers.map((layer: { id: string }) => layer.id))
  await undoButton(page).click(); expect(await save(page)).toEqual(drawn)
  await redoButton(page).click(); expect(await save(page)).toEqual(reordered)
})

test('initial background creation can undo to an empty canvas and history does not persist on reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '创建纯色背景', exact: true }).click()
  await page.getByRole('button', { name: '创建画布', exact: true }).click()
  await expect(page.getByTestId('stage')).toBeVisible()
  await undoButton(page).click(); await expect(page.getByTestId('stage')).toHaveCount(0)
  await expect(undoButton(page)).toBeDisabled()
  await redoButton(page).click(); await expect(page.getByTestId('stage')).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await expect(undoButton(page)).toBeDisabled(); await expect(redoButton(page)).toBeDisabled()
  await expect(page.getByTestId('stage')).toHaveCount(0)
})
