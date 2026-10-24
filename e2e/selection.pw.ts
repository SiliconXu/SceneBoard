import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'

async function scene(page: Page, mixed = false) {
  await page.goto('/')
  const src = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40
    const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 60, 40)
    return canvas.toDataURL()
  })
  const layers = [
    { id: 'a', name: 'cat', src, x: 40.125, y: 50.25, width: 80, height: 40 },
    { id: 'b', name: 'dog', src, x: 240, y: 130, width: 60, height: 30 },
    { id: 'c', name: 'coin', src, x: 500, y: 280, width: 100, height: 50 },
    ...(mixed ? [{ id: 'shape', name: '辅助图形', kind: 'rectangle', color: '#536bdd', fillColor: '#22c55e', x: 150, y: 350, width: 40, height: 40 }] : []),
  ]
  const project = { version: 3, background: { kind: 'color', name: '纯色背景', color: '#123456', width: 800, height: 600 }, layers }
  await page.getByTestId('project-input').setInputFiles({ name: 'scene.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.getByTestId('image-layer')).toHaveCount(layers.length)
  return project
}
const actor = (page: Page, id: string) => page.locator(`[data-layer-id="${id}"]`)
const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`)
const field = (page: Page, name: string) => page.getByRole('textbox', { name: `${name}（原图像素）`, exact: true })
async function edit(page: Page, name: string, text: string) { await field(page, name).fill(text); await field(page, name).press('Enter') }
async function unfocus(page: Page) { await page.getByRole('heading', { name: '纯色背景', exact: true }).click() }
async function download(page: Page, action: () => Promise<unknown>) {
  const pending = page.waitForEvent('download'); await action()
  return readFile((await (await pending).path())!)
}
async function saved(page: Page) {
  return JSON.parse((await download(page, () => page.getByRole('button', { name: '保存项目', exact: false }).click())).toString())
}
async function drag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up()
}
async function frame(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const box = (await page.getByTestId('stage').boundingBox())!, scale = box.width / 800
  await drag(page, { x: box.x + from.x * scale, y: box.y + from.y * scale }, { x: box.x + to.x * scale, y: box.y + to.y * scale })
}
async function selected(page: Page, ids: string[]) {
  const actual = await page.getByTestId('image-layer').evaluateAll(elements => elements.filter(element => element.getAttribute('aria-pressed') === 'true').map(element => element.getAttribute('data-layer-id')))
  expect(actual).toEqual(ids)
}

test('numeric inputs preserve precision, anchors, aspect ratio, boundaries and save/export geometry', async ({ page }) => {
  const project = await scene(page)
  await card(page, 'a').click()
  await expect(field(page, 'X')).toHaveValue('80')
  await expect(page.getByRole('checkbox', { name: '图片保持比例' })).toHaveCount(0)
  await expect(card(page, 'a').getByText('锚点坐标', { exact: true })).toBeVisible()
  await expect(card(page, 'a').getByTestId('anchor-grid')).toBeHidden()
  await card(page, 'a').getByText('锚点坐标', { exact: true }).click()
  await expect(card(page, 'a').getByTestId('anchor-grid')).toBeVisible()
  await field(page, 'X').focus(); await field(page, 'X').blur()
  await page.getByRole('combobox', { name: '定位点' }).selectOption('topleft')
  await expect(field(page, 'X')).toHaveValue('40')
  expect((await saved(page)).layers).toEqual(project.layers)
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await page.getByRole('combobox', { name: '定位点' }).selectOption('center')
  await edit(page, '宽', '100.5')
  await expect(field(page, '高')).toHaveValue('50.25')
  await expect(field(page, 'X')).toHaveValue('80')
  await edit(page, 'X', '200.375')
  await edit(page, 'Y', '180.625')
  await edit(page, '宽', '100000')
  await expect(field(page, 'X')).toHaveValue('200')
  await expect(page.locator('.toast')).toContainText('实际数值')
  await expect(field(page, '宽')).toHaveValue('400.75')
  await edit(page, '宽', '100.5')
  await edit(page, 'X', '-1000')
  await expect(field(page, 'X')).toHaveValue('50')
  await edit(page, 'X', '200.375')
  await edit(page, '高', '25.125')
  const result = await saved(page)
  expect(result.version).toBe(3)
  expect(result.layers[0]).toMatchObject({ x: 175.25, y: 168.0625, width: 50.25, height: 25.125 })
  expect(result.layers.slice(1)).toEqual(project.layers.slice(1))
  await page.getByTestId('project-input').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(result)) })
  await card(page, 'a').locator('.layer-card-header').click()
  await expect(field(page, '宽')).toHaveValue('50.25')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const coordinates = JSON.parse((await download(page, () => page.getByRole('button', { name: '导出坐标', exact: false }).click())).toString())
  expect(coordinates.layers[0].center).toEqual({ x: 200, y: 181 })
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByRole('button', { name: '导出 Pygame Zero 项目…' }).click()
  await expect(page.getByRole('dialog')).toContainText('cat.pos = (200, 181)')
  const zip = unzipSync(await download(page, () => page.getByRole('button', { name: '下载项目 ZIP', exact: true }).click()))
  expect(strFromU8(zip['pygame_project/main.py']!)).toContain('cat.pos = (200, 181)')
  const image = zip['pygame_project/images/cat.png']!
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength)
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([50, 25])
})

test('canvas dock and per-layer folded anchors keep the layer list focused and preserve exact coordinates', async ({ page }) => {
  const original = await scene(page)
  const dock = page.getByRole('region', { name: '画布属性栏', exact: true })
  await expect(page.locator('.sidebar .selection-properties')).toHaveCount(0)
  await expect(page.locator('.editor-panel .selection-properties')).toHaveCount(1)
  await expect(page.locator('.layer-card .anchor-details')).toHaveCount(3)
  for (const id of ['a', 'b', 'c']) await expect(card(page, id).getByTestId('anchor-grid')).toBeHidden()
  const initial = (await page.getByTestId('stage').boundingBox())!
  await card(page, 'a').getByText('锚点坐标', { exact: true }).click()
  await expect(card(page, 'a').getByTestId('anchor-grid')).toBeVisible()
  await selected(page, ['c'])
  const pointTexts = await card(page, 'a').getByTestId('anchor-grid').locator('b').allTextContents()
  expect(pointTexts.every(text => /^\(\d+, \d+\)$/.test(text))).toBe(true)
  await unfocus(page); await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: '选择属性' })).toHaveCount(0)
  await actor(page, 'a').click()
  await expect(field(page, 'X')).toHaveValue('80')
  await field(page, 'X').focus(); await field(page, 'X').blur()
  await page.getByRole('combobox', { name: '定位点' }).selectOption('topleft')
  await expect(field(page, 'X')).toHaveValue('40')
  await field(page, 'X').focus(); await field(page, 'X').blur()
  await page.getByRole('combobox', { name: '定位点' }).selectOption('center')
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  const current = (await page.getByTestId('stage').boundingBox())!
  expect(current).toEqual(initial)
  const dockBox = (await dock.boundingBox())!, workspace = (await page.locator('.workspace').boundingBox())!
  expect(dockBox.y).toBeGreaterThanOrEqual(workspace.y + workspace.height)
  expect((await saved(page)).layers).toEqual(original.layers)
  // Explicitly replacing the rounded readout is an edit; passive focus/blur is not.
  await field(page, 'X').fill('81'); await field(page, 'X').press('Enter')
  const changed = await saved(page)
  expect(changed.layers[0].x).toBe(41)
})

test('invalid values and input shortcuts never delete, select, move or dirty layers', async ({ page }) => {
  const original = await scene(page)
  await card(page, 'a').click()
  for (const text of ['', 'NaN', 'Infinity', '1e309', '0', '-3']) {
    await edit(page, '宽', text)
    await expect(page.getByRole('alert')).toContainText('有效数字')
    await expect(field(page, '宽')).toHaveValue('80')
  }
  await field(page, 'X').fill('999.5'); await field(page, 'X').press('Escape')
  await expect(field(page, 'X')).toHaveValue('80')
  await selected(page, ['a'])
  await field(page, 'X').press('Control+a')
  await field(page, 'X').press('Backspace')
  await field(page, 'X').press('ArrowLeft')
  await field(page, 'X').press('Escape')
  await expect(page.getByTestId('image-layer')).toHaveCount(3)
  await selected(page, ['a'])
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  expect((await saved(page)).layers).toEqual(original.layers)
})

test('clicking another canvas object commits a pending numeric edit before changing selection', async ({ page }) => {
  await scene(page)
  await card(page, 'a').click()
  await field(page, 'X').fill('150.5')
  await actor(page, 'b').click()
  await selected(page, ['b'])
  const result = await saved(page)
  expect(result.layers[0].x + result.layers[0].width / 2).toBe(150.5)
  await field(page, 'Y').fill('200.75')
  await frame(page, { x: 490, y: 270 }, { x: 620, y: 340 })
  await selected(page, ['c'])
  const framed = await saved(page)
  expect(framed.layers[1].y + framed.layers[1].height / 2).toBe(200.75)
})

test('shape numeric sizing can unlock proportions; pointer sizing still uses Ctrl', async ({ page }) => {
  await scene(page, true)
  await expect(page.getByRole('checkbox', { name: '数值输入保持比例' })).toBeChecked()
  await edit(page, '宽', '60')
  await expect(field(page, '高')).toHaveValue('60')
  await page.getByRole('checkbox', { name: '数值输入保持比例' }).uncheck()
  await page.getByRole('combobox', { name: '定位点' }).selectOption('topleft')
  await edit(page, '高', '90.25')
  await expect(field(page, '宽')).toHaveValue('60')
  const handle = (await page.getByTestId('resize-se').boundingBox())!, stage = (await page.getByTestId('stage').boundingBox())!, scale = stage.width / 800
  await page.keyboard.down('Control')
  await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: handle.x + handle.width / 2 + 20 * scale, y: handle.y + handle.height / 2 })
  await page.keyboard.up('Control')
  const result = await saved(page)
  expect(result.layers[3].width).toBeCloseTo(80, 3)
  expect(result.layers[3].height).toBeCloseTo(90.25, 3)
  expect(result.layers[3]).toMatchObject({ x: 140, y: 340 })
})

test('modifier selection, keyboard selection, group dragging and group coordinates keep common deltas', async ({ page }) => {
  await scene(page, true)
  await card(page, 'a').click()
  await card(page, 'b').click({ modifiers: ['Shift'] })
  await actor(page, 'shape').click({ modifiers: ['Control'] })
  await selected(page, ['a', 'b', 'shape'])
  await expect(page.getByTestId('group-selection')).toBeVisible()
  await expect(page.getByTestId('resize-se')).toHaveCount(0)
  await expect(field(page, '宽')).toHaveAttribute('readonly', '')
  const before = await saved(page)
  const stage = (await page.getByTestId('stage').boundingBox())!, box = (await actor(page, 'a').boundingBox())!, scale = stage.width / 800
  await drag(page, { x: box.x + 10 * scale, y: box.y + 10 * scale }, { x: box.x + 45 * scale, y: box.y + 30 * scale })
  await selected(page, ['a', 'b', 'shape'])
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown')
  const moved = await saved(page)
  for (const index of [0, 1, 3]) {
    expect(moved.layers[index].x - before.layers[index].x).toBeCloseTo(36, 2)
    expect(moved.layers[index].y - before.layers[index].y).toBeCloseTo(30, 2)
    expect(moved.layers[index].x - before.layers[index].x).toBeCloseTo(moved.layers[0].x - before.layers[0].x, 9)
    expect(moved.layers[index].y - before.layers[index].y).toBeCloseTo(moved.layers[0].y - before.layers[0].y, 9)
  }
  expect(moved.layers[2]).toEqual(before.layers[2])
  await page.getByRole('combobox', { name: '定位点' }).selectOption('topleft')
  await edit(page, 'X', '-1000'); await edit(page, 'Y', '10000')
  const edge = await saved(page)
  expect(edge.layers[0].x).toBe(0)
  expect(edge.layers[3].y + edge.layers[3].height).toBe(600)
  expect(edge.layers[1].x - edge.layers[0].x).toBeCloseTo(199.875)
  await actor(page, 'b').click({ modifiers: ['Control'] })
  await selected(page, ['a', 'shape'])
  await card(page, 'c').focus(); await card(page, 'c').press('Shift+Enter')
  await selected(page, ['a', 'c', 'shape'])
  await actor(page, 'shape').click()
  await selected(page, ['shape'])
  await unfocus(page); await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: '选择属性' })).toHaveCount(0)
})

test('marquee selects complete bounds in both directions and adds with modifiers', async ({ page }) => {
  await scene(page, true)
  await frame(page, { x: 20, y: 30 }, { x: 310, y: 170 })
  await selected(page, ['a', 'b'])
  await page.keyboard.down('Shift')
  await frame(page, { x: 620, y: 340 }, { x: 490, y: 270 })
  await page.keyboard.up('Shift')
  await selected(page, ['a', 'b', 'c'])
  // A partially intersected object is not selected.
  await frame(page, { x: 20, y: 30 }, { x: 70, y: 70 })
  await selected(page, [])
  await frame(page, { x: 310, y: 170 }, { x: 20, y: 30 })
  await selected(page, ['a', 'b'])
  const box = (await page.getByTestId('stage').boundingBox())!
  await page.mouse.click(box.x + box.width * .9, box.y + box.height * .9)
  await selected(page, [])
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
})

test('marquee coordinates remain correct after zoom and pan and cancel on pointer loss', async ({ page }) => {
  await scene(page)
  const box = (await page.getByTestId('stage').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -250)
  await expect.poll(async () => (await page.getByTestId('stage').boundingBox())!.width).toBeGreaterThan(box.width * 1.5)
  const workspace = (await page.locator('.workspace').boundingBox())!
  await page.mouse.move(workspace.x + workspace.width / 2, workspace.y + workspace.height / 2)
  await page.mouse.down({ button: 'right' }); await page.mouse.move(workspace.x + workspace.width / 2 + 40, workspace.y + workspace.height / 2 + 20); await page.mouse.up({ button: 'right' })
  // These scene points stay inside the visible viewport after zoom and pan.
  await frame(page, { x: 220, y: 110 }, { x: 320, y: 180 })
  await selected(page, ['b'])
  const current = (await page.getByTestId('stage').boundingBox())!, scale = current.width / 800
  await page.mouse.move(current.x + 350 * scale, current.y + 200 * scale); await page.mouse.down()
  await page.mouse.move(current.x + 650 * scale, current.y + 350 * scale)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  await selected(page, ['b'])
  await expect(page.getByTestId('marquee-selection')).toHaveCount(0)
})

test('all six alignments and unequal-size distributions preserve layer order', async ({ page }) => {
  const original = await scene(page)
  const cases = [
    ['左对齐', 'x', 'width', 0], ['水平居中对齐', 'x', 'width', .5], ['右对齐', 'x', 'width', 1],
    ['顶部对齐', 'y', 'height', 0], ['垂直居中对齐', 'y', 'height', .5], ['底部对齐', 'y', 'height', 1],
  ] as const
  for (const [label, axis, size, fraction] of cases) {
    await page.getByTestId('project-input').setInputFiles({ name: 'again.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) })
    await unfocus(page); await page.keyboard.press('Control+a')
    await page.getByRole('button', { name: label, exact: true }).click()
    const result = await saved(page)
    const expected = axis === 'x' ? 40.125 + (600 - 40.125) * fraction : 50.25 + (330 - 50.25) * fraction
    for (const layer of result.layers) expect(layer[axis] + layer[size] * fraction).toBeCloseTo(expected, 6)
    expect(result.layers.map((layer: { id: string }) => layer.id)).toEqual(['a', 'b', 'c'])
  }
  for (const [axis, size, label] of [['x', 'width', '水平等间距'], ['y', 'height', '垂直等间距']] as const) {
    await page.getByTestId('project-input').setInputFiles({ name: 'again.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) })
    await unfocus(page); await page.keyboard.press('Control+a')
    await page.getByRole('button', { name: label }).click()
    const result = await saved(page)
    expect(result.layers[0]).toEqual(original.layers[0]); expect(result.layers[2]).toEqual(original.layers[2])
    expect(result.layers[1][axis] - result.layers[0][axis] - result.layers[0][size]).toBeCloseTo(result.layers[2][axis] - result.layers[1][axis] - result.layers[1][size], 6)
  }
  await page.getByRole('button', { name: '左对齐', exact: true }).click()
  await expect(page.getByRole('button', { name: '水平等间距' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '水平等间距' })).toHaveAttribute('aria-description', /空间不足/)
  await card(page, 'c').click({ modifiers: ['Control'] })
  await expect(page.getByRole('button', { name: '垂直等间距' })).toBeDisabled()
})

test('batch clipboard keeps snapshots, relative geometry, styles and order across smaller canvases', async ({ page }) => {
  const original = await scene(page, true)
  await unfocus(page); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  let result = await saved(page)
  expect(result.layers).toHaveLength(8)
  expect(result.layers.slice(0, 4)).toEqual(original.layers)
  expect(new Set(result.layers.map((layer: { id: string }) => layer.id)).size).toBe(8)
  result.layers.slice(4).forEach((layer: any, index: number) => {
    expect(layer.name).toBe(original.layers[index]!.name)
    expect(layer.x).toBe(original.layers[index]!.x + 20)
    expect(layer.y).toBe(original.layers[index]!.y + 20)
  })
  await unfocus(page); await page.keyboard.press('Control+x')
  await expect(page.getByTestId('image-layer')).toHaveCount(4)
  await page.keyboard.press('Control+v')
  result = await saved(page)
  expect(result.layers[7]).toMatchObject({ name: '辅助图形', color: '#536bdd', fillColor: '#22c55e', x: 170, y: 370 })
  const smaller = { ...original, background: { ...original.background, width: 280, height: 170 }, layers: [] }
  await page.getByTestId('project-input').setInputFiles({ name: 'small.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(smaller)) })
  await unfocus(page); await page.keyboard.press('Control+v')
  result = await saved(page)
  expect(result.layers).toHaveLength(4)
  const ratio = result.layers[0].width / 80
  expect(ratio).toBeLessThan(1)
  expect(result.layers[1].x - result.layers[0].x).toBeCloseTo((240 - 40.125) * ratio, 6)
  expect(result.layers[3]).toMatchObject({ color: '#536bdd', fillColor: '#22c55e' })
  for (const layer of result.layers) {
    expect(layer.x).toBeGreaterThanOrEqual(0); expect(layer.y).toBeGreaterThanOrEqual(0)
    expect(layer.x + layer.width).toBeLessThanOrEqual(280.000001)
    expect(layer.y + layer.height).toBeLessThanOrEqual(170.000001)
  }
  await page.getByTestId('project-input').setInputFiles({ name: 'small-saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(result)) })
  await unfocus(page); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete')
  await expect(page.getByTestId('image-layer')).toHaveCount(0)
})

test('contextual UI keeps actions discoverable without adding toolbar clutter', async ({ page }) => {
  await scene(page, true)
  const toolbarButtons = await page.locator('.toolbar button').count()
  await card(page, 'a').click()
  await expect(page.getByRole('button', { name: '左对齐', exact: true })).toHaveCount(0)
  await card(page, 'b').click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await expect(page.getByRole('button', { name: '导出选中对象…', exact: false })).toBeDisabled()
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await card(page, 'a').click({ button: 'right' })
  await selected(page, ['a'])
  await page.keyboard.press('Escape')
  await card(page, 'b').click({ modifiers: ['Shift'] })
  await card(page, 'a').getByTestId('edit-name').click()
  await selected(page, ['a'])
  await page.getByRole('textbox', { name: '角色 / 物品名称' }).press('Escape')
  for (const viewport of [{ width: 1280, height: 900 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    await unfocus(page); await page.keyboard.press('Control+a')
    await expect(page.getByRole('button', { name: '水平等间距' })).toBeVisible()
    const list = await page.locator('.layer-list').boundingBox()
    expect(list!.height).toBeGreaterThanOrEqual(100)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  expect(await page.locator('.toolbar button').count()).toBe(toolbarButtons)
  await expect(page.getByTestId('stage')).toHaveCSS('background-image', 'none')
  await expect(page.getByTestId('stage')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await page.screenshot({ path: 'test-results/frame-multiselection.png', fullPage: true })
  await card(page, 'a').click()
  await page.screenshot({ path: 'test-results/frame-precise-properties.png', fullPage: true })
})
