import { test, expect, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { source, save, projectZip } from './round3-utils'

async function scene(page: Page, kind: 'rectangle' | 'ellipse', imageName = 'hero', shapeName = `${kind}_1`) {
  await page.goto('/')
  const src = await source(page, 'opaque')
  const project = {
    version: 4, background: { kind: 'color', name: '图形编辑', color: '#203040', width: 800, height: 600 },
    layers: [
      { id: 'hero', kind: 'image', name: imageName, src, x: 600, y: 100, width: 80, height: 48 },
      { id: 'shape', kind, name: shapeName, color: '#ffffff', x: 100, y: 150, width: 160, height: 80 },
    ],
  }
  await page.getByTestId('project-input').setInputFiles({ name: 'shapes.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.getByTestId('image-layer')).toHaveCount(2)
  return project
}

async function startResize(page: Page, dx: number, dy: number) {
  const handle = (await page.getByTestId('resize-se').boundingBox())!
  const stage = (await page.getByTestId('stage').boundingBox())!, scale = stage.width / 800
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await page.mouse.move(start.x, start.y); await page.mouse.down()
  await page.mouse.move(start.x + dx * scale, start.y + dy * scale, { steps: 3 })
}

for (const kind of ['rectangle', 'ellipse'] as const) {
  test(`${kind} resize supports original ratio, Shift equal sides, Ctrl free size and live modifier switching`, async ({ page }) => {
    await scene(page, kind)
    await page.locator('[data-card-id="shape"]').click()
    await expect(page.locator('.drawing-tools')).toContainText('默认等比，Shift 正方形 / 圆形，Ctrl 自由宽高')
    const actor = page.locator('[data-layer-id="shape"]')
    const original = (await actor.boundingBox())!
    const ratio = async () => { const box = (await actor.boundingBox())!; return box.width / box.height }
    await startResize(page, 40, 40)
    await expect.poll(ratio).toBeCloseTo(2, 2)
    await page.keyboard.down('Shift')
    await expect.poll(ratio).toBeCloseTo(1, 2)
    await expect(page.locator('.drawing-tools')).toContainText('Shift：缩放为正方形 / 圆形')
    await page.keyboard.down('Control')
    await expect.poll(ratio).toBeCloseTo(1, 2)
    await page.keyboard.up('Shift')
    await expect.poll(ratio).toBeCloseTo(200 / 120, 2)
    await expect(page.locator('.drawing-tools')).toContainText('Ctrl：自由调整图形宽高')
    await page.keyboard.up('Control')
    await expect.poll(ratio).toBeCloseTo(2, 2)
    await page.keyboard.down('Shift')
    await expect.poll(ratio).toBeCloseTo(1, 2)
    await page.mouse.up(); await page.keyboard.up('Shift')
    const square = (await actor.boundingBox())!
    expect(square.x).toBeCloseTo(original.x, 2); expect(square.y).toBeCloseTo(original.y, 2)
    let saved = await save(page)
    expect(saved.layers[1]).toMatchObject({ name: `${kind}_1`, x: 100, y: 150 })
    expect(saved.layers[1].width).toBeCloseTo(160, 4); expect(saved.layers[1].height).toBeCloseTo(160, 4)
    // The next gesture starts with the newly committed ratio, and preserves its name.
    await startResize(page, 20, 60); await page.mouse.up()
    await expect.poll(ratio).toBeCloseTo(1, 2)
    await page.keyboard.down('Control')
    await startResize(page, 30, 10); await page.mouse.up(); await page.keyboard.up('Control')
    saved = await save(page)
    expect(saved.layers[1]).toMatchObject({ name: `${kind}_1`, x: 100, y: 150 })
    expect(saved.layers[1].width).toBeCloseTo(230, 4); expect(saved.layers[1].height).toBeCloseTo(210, 4)
    const zip = unzipSync(await projectZip(page))
    expect(strFromU8(zip['pygame_project/main.py']!)).toContain(`${kind}_1 = Rect(100, 150, 230, 210)`)
    await page.locator('[data-card-id="hero"]').click()
    await page.keyboard.down('Control'); await page.keyboard.down('Shift')
    await startResize(page, 30, 5); await page.mouse.up()
    await page.keyboard.up('Shift'); await page.keyboard.up('Control')
    saved = await save(page)
    expect(saved.layers[0].width / saved.layers[0].height).toBeCloseTo(20 / 12, 6)
    await page.locator('[data-card-id="shape"]').click()
    for (const width of [900, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.locator('.drawing-tools')).toContainText('Ctrl 自由宽高')
      expect(await page.locator('.drawing-tools').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: `test-results/shape-resize-${kind}-${width}.png`, fullPage: true })
    }
  })
}

test('new shapes use unique pgz names and can export immediately after drawing', async ({ page }) => {
  await scene(page, 'rectangle', 'rectangle_1.PNG', 'rectangle_3')
  const stage = (await page.getByTestId('stage').boundingBox())!, scale = stage.width / 800
  for (const [tool, y, shift] of [['矩形', 250, false], ['椭圆', 400, true]] as const) {
    await page.getByRole('button', { name: `绘制${tool}`, exact: true }).click()
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.move(stage.x + 400 * scale, stage.y + y * scale); await page.mouse.down()
    await page.mouse.move(stage.x + 500 * scale, stage.y + (y + 60) * scale); await page.mouse.up()
    if (shift) await page.keyboard.up('Shift')
  }
  const saved = await save(page)
  expect(saved.layers.map((layer: { name: string }) => layer.name)).toEqual(['rectangle_1.PNG', 'rectangle_3', 'rectangle_2', 'ellipse_1'])
  expect(saved.layers[3].width).toBeCloseTo(saved.layers[3].height)
  const zip = unzipSync(await projectZip(page)), code = strFromU8(zip['pygame_project/main.py']!)
  expect(code).toContain("rectangle_1 = Actor('rectangle_1')")
  expect(code).toContain('rectangle_2 = Rect(400, 250, 100, 60)')
  expect(code).toContain('ellipse_1 = Rect(400, 400, 100, 100)')
})
