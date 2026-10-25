import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

export async function source(page: Page, mode = 'padding') {
  return page.evaluate(mode => {
    const c = document.createElement('canvas'); c.width = 20; c.height = 12
    const ctx = c.getContext('2d')!
    if (mode === 'portrait' || mode === 'noisy-portrait') {
      ctx.fillStyle = '#ff0000'; ctx.fillRect(8, 1, 3, 10)
      if (mode === 'noisy-portrait') { ctx.fillStyle = `rgba(0,0,0,${1 / 255})`; ctx.fillRect(0, 0, 1, 1); ctx.fillRect(19, 11, 1, 1) }
    }
    else if (mode === 'tolerance') {
      ctx.fillStyle = `rgba(0,0,0,${1 / 255})`; ctx.fillRect(0, 0, 1, 1); ctx.fillRect(19, 11, 1, 1)
      ctx.fillStyle = `rgba(0,0,0,${5 / 255})`; ctx.fillRect(3, 1, 14, 10)
      ctx.clearRect(6, 2, 7, 8); ctx.fillStyle = `rgba(0,0,0,${25 / 255})`; ctx.fillRect(6, 2, 7, 8)
      ctx.clearRect(8, 3, 3, 6); ctx.fillStyle = 'rgba(255,0,0,.5)'; ctx.fillRect(8, 3, 3, 6)
      ctx.clearRect(9, 5, 1, 1); ctx.fillStyle = `rgba(0,255,0,${5 / 255})`; ctx.fillRect(9, 5, 1, 1)
    }
    else if (mode === 'faint') { ctx.fillStyle = `rgba(255,0,0,${5 / 255})`; ctx.fillRect(2, 1, 10, 7) }
    else if (mode === 'opaque') { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 20, 12) }
    else if (mode !== 'empty') {
      ctx.fillStyle = '#ff0000'; ctx.fillRect(2, 1, 4, 4)
      ctx.fillStyle = '#0000ff'; ctx.fillRect(6, 1, 6, 4)
      ctx.fillStyle = 'rgba(0,255,0,.5)'; ctx.fillRect(2, 5, 10, 3)
    }
    return c.toDataURL()
  }, mode)
}
export async function openScene(page: Page, src: string, edits: Record<string, unknown> = {}) {
  await page.getByTestId('project-input').setInputFiles({ name: 'scene.frame.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    version: 4, background: { kind: 'color', name: '背景', color: '#203040', width: 320, height: 240 },
    layers: [ { id: 'hero', kind: 'image', name: 'hero', src, x: 20.25, y: 30.5, width: 40, height: 24, ...edits }, { id: 'shape', kind: 'rectangle', name: '辅助', color: '#ffffff', x: 200, y: 200, width: 20, height: 20 } ],
  })) })
  await expect(page.locator('.toast')).toContainText('项目已恢复')
  await page.locator('[data-card-id="hero"]').click()
  await expect(page.locator('[data-layer-id="hero"] canvas')).toHaveJSProperty('width', Math.max(1, Math.round(Number(edits.width ?? 40))))
}
export async function bytes(page: Page, action: () => Promise<unknown>) {
  const download = page.waitForEvent('download'); await action()
  return readFile((await (await download).path())!)
}
export async function save(page: Page) {
  return JSON.parse((await bytes(page, () => page.getByRole('button', { name: '保存项目' }).click())).toString())
}
export async function pixels(page: Page, data: Uint8Array) {
  return page.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode()
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height
    const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0)
    return { width: c.width, height: c.height, data: [...ctx.getImageData(0, 0, c.width, c.height).data] }
  }, `data:image/png;base64,${Buffer.from(data).toString('base64')}`)
}
export async function objectBytes(page: Page) {
  await page.getByRole('button', { name: '导出', exact: true }).click()
  return bytes(page, () => page.getByRole('button', { name: '导出选中对象' }).click())
}
export async function projectZip(page: Page) {
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByRole('button', { name: '导出 Pygame Zero 项目…' }).click()
  return bytes(page, () => page.getByRole('button', { name: '下载项目 ZIP' }).click())
}

