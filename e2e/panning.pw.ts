import { test, expect, type Page } from '@playwright/test'
import { source, save } from './round3-utils'

async function scene(page: Page) {
  await page.goto('/')
  const src = await source(page, 'opaque')
  const project = {
    version: 4, background: { kind: 'color', name: '地图平移', color: '#203040', width: 800, height: 600 },
    layers: [
      { id: 'hero', kind: 'image', name: 'hero', src, x: 360, y: 270, width: 80, height: 48 },
      { id: 'shape', kind: 'rectangle', name: 'rectangle_1', color: '#ffffff', x: 100, y: 100, width: 120, height: 80 },
    ],
  }
  await page.getByTestId('project-input').setInputFiles({ name: 'pan.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.getByTestId('image-layer')).toHaveCount(2)
  const stage = (await page.getByTestId('stage').boundingBox())!
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
  await page.mouse.wheel(0, -500)
  await expect.poll(async () => (await page.getByTestId('stage').boundingBox())!.width).toBeGreaterThan(stage.width * 2)
  const workspace = (await page.locator('.workspace').boundingBox())!
  return { project, point: { x: workspace.x + workspace.width / 2, y: workspace.y + workspace.height / 2 } }
}

test('Space-left and middle pan preserve selection and geometry; right drag no longer pans', async ({ page }) => {
  const { project, point } = await scene(page)
  const workspace = page.locator('.workspace'), stage = page.getByTestId('stage')
  await page.locator('[data-card-id="hero"]').click()
  await page.mouse.move(point.x, point.y)
  const initial = (await stage.boundingBox())!
  await page.keyboard.down('Space')
  await expect(workspace).toHaveCSS('cursor', 'grab')
  await page.mouse.down()
  await expect(workspace).toHaveCSS('cursor', 'grabbing')
  await page.mouse.move(point.x + 40, point.y + 20); await page.mouse.up()
  await expect(workspace).toHaveCSS('cursor', 'grab')
  await page.keyboard.up('Space')
  let box = (await stage.boundingBox())!
  expect(box.x - initial.x).toBeCloseTo(40, 1); expect(box.y - initial.y).toBeCloseTo(20, 1)
  await page.mouse.move(point.x, point.y); await page.mouse.down({ button: 'middle' })
  await page.mouse.move(point.x - 20, point.y - 10); await page.mouse.up({ button: 'middle' })
  box = (await stage.boundingBox())!
  expect(box.x - initial.x).toBeCloseTo(20, 1); expect(box.y - initial.y).toBeCloseTo(10, 1)
  await page.mouse.move(point.x, point.y); await page.mouse.down({ button: 'right' })
  await page.mouse.move(point.x + 50, point.y + 30); await page.mouse.up({ button: 'right' })
  const afterRight = (await stage.boundingBox())!
  expect(afterRight.x).toBeCloseTo(box.x, 2); expect(afterRight.y).toBeCloseTo(box.y, 2)
  await expect(page.locator('[data-layer-id="hero"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(workspace).not.toHaveClass(/pan-ready|panning/)
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  expect((await save(page)).layers).toEqual(project.layers)
  await expect(page.locator('.editor-footer')).toContainText('空格＋左键 / 中键拖动地图')
  await page.screenshot({ path: 'test-results/map-pan-shortcuts.png', fullPage: true })
})

test('temporary pan leaves each drawing tool active without drawing or changing selection', async ({ page }) => {
  const { project, point } = await scene(page)
  for (const name of ['绘制矩形', '绘制椭圆']) {
    const tool = page.getByRole('button', { name, exact: true })
    await tool.click()
    await page.mouse.move(point.x, point.y); await page.keyboard.down('Space'); await page.mouse.down()
    await page.mouse.move(point.x + 30, point.y + 20); await page.mouse.up(); await page.keyboard.up('Space')
    await expect(tool).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(point.x, point.y); await page.mouse.down({ button: 'middle' })
    await page.mouse.move(point.x - 30, point.y - 20); await page.mouse.up({ button: 'middle' })
    await expect(tool).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.shape-preview')).toHaveCount(0)
    await expect(page.getByTestId('marquee-selection')).toHaveCount(0)
    await expect(page.getByTestId('image-layer')).toHaveCount(2)
  }
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  expect((await save(page)).layers).toEqual(project.layers)
  // Releasing Space returns to the drawing tool, which works on the next drag.
  const stage = (await page.getByTestId('stage').boundingBox())!, scale = stage.width / 800
  await page.mouse.move(point.x, point.y); await page.mouse.down()
  await page.mouse.move(point.x + 60, point.y + 40); await page.mouse.up()
  await expect(page.getByTestId('image-layer')).toHaveCount(3)
  const drawn = (await save(page)).layers[2]
  expect(drawn.kind).toBe('ellipse')
  expect(drawn.width).toBeCloseTo(60 / scale, 3); expect(drawn.height).toBeCloseTo(40 / scale, 3)
})

test('Space release, cancellation and blur end panning without leaving a stuck hand tool', async ({ page }) => {
  const { point } = await scene(page)
  const workspace = page.locator('.workspace'), stage = page.getByTestId('stage')
  await workspace.evaluate(element => element.addEventListener('pointerdown', event => { (element as HTMLElement).dataset.pointer = String((event as PointerEvent).pointerId) }, { capture: true }))
  for (const end of ['space', 'cancel', 'blur']) {
    await page.mouse.move(point.x, point.y); await page.keyboard.down('Space'); await page.mouse.down()
    await page.mouse.move(point.x + 15, point.y + 10)
    await expect(workspace).toHaveClass(/panning/)
    if (end === 'space') await page.keyboard.up('Space')
    else if (end === 'cancel') await workspace.dispatchEvent('pointercancel', { pointerId: Number(await workspace.getAttribute('data-pointer')) })
    else await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    const stopped = (await stage.boundingBox())!
    await page.mouse.move(point.x + 40, point.y + 30)
    expect((await stage.boundingBox())!.x).toBeCloseTo(stopped.x, 2)
    await page.mouse.up(); await page.keyboard.up('Space')
    await expect(workspace).not.toHaveClass(/pan-ready|panning/)
  }
  // Releasing Space must not terminate a drag started with the middle button.
  await page.mouse.move(point.x, point.y); await page.keyboard.down('Space'); await page.mouse.down({ button: 'middle' })
  await page.mouse.move(point.x + 10, point.y + 10); await page.keyboard.up('Space')
  await expect(workspace).toHaveClass(/panning/)
  await page.mouse.up({ button: 'middle' }); await expect(workspace).not.toHaveClass(/panning/)
})

test('spaces still edit names and numeric fields, and sidebar keyboard selection remains available', async ({ page }) => {
  const { point } = await scene(page)
  await page.locator('[data-card-id="hero"]').getByTestId('edit-name').click()
  const name = page.getByLabel('角色 / 物品名称')
  await name.fill('hero'); await name.press('End'); await name.press('Space'); await name.press('h')
  await expect(name).toHaveValue('hero h')
  await expect(page.locator('.workspace')).not.toHaveClass(/pan-ready/)
  await name.press('Escape')
  const x = page.getByRole('textbox', { name: 'X（原图像素）', exact: true })
  await x.fill('400'); await x.press('End'); await x.press('Space')
  await expect(x).toHaveValue('400 '); await x.press('Escape'); await x.blur()
  const shapeCard = page.locator('[data-card-id="shape"]')
  await page.mouse.move(1000, 150); await shapeCard.focus(); await page.keyboard.press('Space')
  await expect(shapeCard).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(point.x, point.y); await page.keyboard.down('Space')
  await expect(page.locator('.workspace')).toHaveClass(/pan-ready/)
  await page.keyboard.up('Space')
  await expect(page.locator('.workspace')).not.toHaveClass(/pan-ready/)
})
