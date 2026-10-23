import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function sourceImage(page: Page, mime = 'image/png') {
  return page.evaluate(mime => {
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 12, 20)
    ctx.fillStyle = 'rgba(0,255,0,.5)'; ctx.fillRect(12, 0, 16, 20)
    return canvas.toDataURL(mime, 1)
  }, mime)
}

async function openProject(page: Page, src: string, width: number, height: number) {
  const bg = await sourceImage(page)
  await page.getByTestId('project-input').setInputFiles({ name: 'objects.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    version: 2, background: { name: 'bg.png', src: bg, width: 40, height: 20 },
    layers: [
      { id: 'target', kind: 'image', name: 'renamed.jpeg', src, x: 0, y: 0, width, height },
      { id: 'other', kind: 'image', name: 'other', src: bg, x: 0, y: 0, width: 10, height: 5 },
      { id: 'shape', kind: 'rectangle', name: 'shape', color: '#ff0000', x: 0, y: 0, width: 5, height: 5 },
    ],
  })) })
  await expect(page.getByTestId('layer-card')).toHaveCount(3)
}

async function downloadImage(page: Page, action: () => Promise<unknown>) {
  const pending = page.waitForEvent('download'); await action(); const file = await pending
  const bytes = await readFile((await file.path())!)
  return { bytes, filename: file.suggestedFilename() }
}

async function inspect(page: Page, bytes: Buffer, mime: string) {
  return page.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
    const pixel = (x: number) => Array.from(ctx.getImageData(Math.floor(image.width * x), Math.floor(image.height / 2), 1, 1).data)
    return { width: image.width, height: image.height, opaque: pixel(.1), half: pixel(.5), transparent: pixel(.9) }
  }, `data:${mime};base64,${bytes.toString('base64')}`)
}

for (const size of [{ width: 80, height: 40 }, { width: 10.4, height: 5.2 }]) {
  test(`PNG object export preserves transparent and soft pixels at ${size.width}px`, async ({ page }) => {
    await page.goto('/')
    // Source is 40x20; enlarge the project background so both up/down scaling fit.
    const src = await sourceImage(page)
    const bg = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 100; c.height = 100; return c.toDataURL() })
    const { width, height } = size
    await page.getByTestId('project-input').setInputFiles({ name: 'test.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      version: 2, background: { name: 'bg', src: bg, width: 100, height: 100 }, layers: [
        { id: 'target', kind: 'image', name: 'renamed.jpeg', src, x: 5, y: 5, width, height },
        { id: 'other', kind: 'image', name: 'other', src, x: 0, y: 0, width: 10, height: 5 },
      ],
    })) })
    await expect(page.getByTestId('layer-card').first()).toHaveAttribute('aria-pressed', 'true')
    const target = page.locator('[data-card-id="target"]')
    await target.click({ button: 'right' })
    await expect(target).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('menu')).toContainText(`${Math.round(width)} × ${Math.round(height)} px · PNG`)
    const result = await downloadImage(page, () => page.getByRole('menuitem', { name: '导出此对象' }).click())
    expect(result.filename).toBe(`renamed-${Math.round(width)}x${Math.round(height)}.png`)
    expect(result.bytes.subarray(1, 4).toString()).toBe('PNG')
    const pixels = await inspect(page, result.bytes, 'image/png')
    expect(pixels.width).toBe(Math.round(width)); expect(pixels.height).toBe(Math.round(height))
    expect(pixels.opaque).toEqual([255, 0, 0, 255])
    expect(pixels.half).toEqual([0, 255, 0, 128])
    expect(pixels.transparent[3]).toBe(0)
    await expect(page.locator('.unsaved-dot')).toHaveCount(0)
    // View zoom and composition annotation settings do not alter an object export.
    await page.locator('.workspace').hover(); await page.mouse.wheel(0, -250)
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByLabel('包含名称', { exact: true }).check()
    await page.getByLabel('包含坐标', { exact: true }).check()
    const second = await downloadImage(page, () => page.getByRole('button', { name: '导出选中对象' }).click())
    expect(await inspect(page, second.bytes, 'image/png')).toEqual(pixels)
    await target.click({ button: 'right' }); await expect(page.getByRole('menu')).toBeVisible()
    await page.screenshot({ path: `test-results/object-export-${Math.round(width)}.png`, fullPage: true })
    await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(target).toHaveAttribute('aria-pressed', 'true')
    await target.click({ button: 'right' }); await page.locator('.sidebar-title').click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await target.click({ button: 'right' }); await page.locator('.layer-list').dispatchEvent('scroll')
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
}

for (const format of ['jpeg', 'webp']) {
  test(`restored ${format} exports with its real format, independent of name`, async ({ page }) => {
    await page.goto('/')
    const src = await sourceImage(page, `image/${format}`)
    expect(src).toMatch(new RegExp(`^data:image/${format};`))
    await openProject(page, src, 20, 10)
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await expect(page.getByRole('button', { name: '导出选中对象' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.locator('[data-card-id="shape"]').click({ button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.locator('[data-card-id="target"]').click()
    await page.getByRole('button', { name: '导出', exact: true }).click()
    const result = await downloadImage(page, () => page.getByRole('button', { name: '导出选中对象' }).click())
    expect(result.filename).toBe(`renamed-20x10.${format === 'jpeg' ? 'jpg' : 'webp'}`)
    if (format === 'jpeg') expect([...result.bytes.subarray(0, 3)]).toEqual([255, 216, 255])
    else { expect(result.bytes.subarray(0, 4).toString()).toBe('RIFF'); expect(result.bytes.subarray(8, 12).toString()).toBe('WEBP') }
    const pixels = await inspect(page, result.bytes, `image/${format}`)
    expect([pixels.width, pixels.height]).toEqual([20, 10])
    if (format === 'webp') { expect(pixels.half[3]).toBe(128); expect(pixels.transparent[3]).toBe(0) }
  })
}

test('context menu stays inside viewport and text fields keep their context menu', async ({ page }) => {
  await page.goto('/'); await openProject(page, await sourceImage(page), 20, 10)
  const target = page.locator('[data-card-id="target"]')
  await target.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1278, clientY: 898, button: 2 })))
  const box = (await page.getByRole('menu').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(8); expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.x + box.width).toBeLessThanOrEqual(1272); expect(box.y + box.height).toBeLessThanOrEqual(892)
  await page.keyboard.press('Escape')
  await target.getByTestId('edit-name').click()
  await page.getByRole('textbox', { name: '角色 / 物品名称' }).dispatchEvent('contextmenu', { button: 2 })
  await expect(page.getByRole('menu')).toHaveCount(0)
})
