import { strToU8, zipSync } from 'fflate'
import { assertCanvasSize } from './background'
import { download } from './files'
import { renderImageExport } from './image-export'
import { isImageLayer, type Background, type Layer, type Project } from './project'

export interface ProjectFile { path: string; bytes: Uint8Array }
export interface NameIssue { id: string; name: string; reason: string }
const keywords = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '))
const reserved = new Set('screen images sounds music keyboard keymods keys mouse clock animate animation tone exit storage pgzrun draw update on_mouse_down on_mouse_up on_mouse_move on_key_down on_key_up on_music_end background __builtins__ __name__ __file__'.split(' '))
const deviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export const resourceName = (name: string) => name.replace(/\.(png|jpe?g|webp)$/i, '')

export function analyzePygameProject(background: Background, layers: Layer[]) {
  const images = layers.filter(isImageLayer)
  const counts = new Map<string, number>()
  for (const layer of images) { const name = resourceName(layer.name); counts.set(name, (counts.get(name) ?? 0) + 1) }
  const issues: NameIssue[] = []
  for (const layer of images) {
    const name = resourceName(layer.name)
    let reason = ''
    if (!/^[a-z][a-z0-9_]*$/.test(name)) reason = '名称须以小写英文字母开头，只包含小写字母、数字和下划线。'
    else if (name.length > 100) reason = '名称不能超过 100 个字符。'
    else if (keywords.has(name)) reason = '不能使用 Python 关键字。'
    else if (reserved.has(name)) reason = '不能使用 Pygame Zero 或生成代码的保留名称。'
    else if (deviceName.test(name)) reason = '不能使用 Windows 保留文件名。'
    else if (counts.get(name)! > 1) reason = '去掉图片扩展名后与其他图片名称重复。'
    if (reason) issues.push({ id: layer.id, name: layer.name, reason })
  }
  let code = ''
  if (!issues.length) {
    const lines = ['import pgzrun', '', '# 窗口大小', `WIDTH = ${background.width}`, `HEIGHT = ${background.height}`, '']
    if (images.length) {
      lines.push('# 创建角色并设置中心位置')
      for (const layer of images) {
        const name = resourceName(layer.name)
        lines.push(`${name} = Actor('${name}')`, `${name}.pos = (${Math.round(layer.x + layer.width / 2)}, ${Math.round(layer.y + layer.height / 2)})`, '')
      }
    }
    lines.push('# 绘制场景', 'def draw():', background.kind === 'color' ? `    screen.fill('${background.color}')` : "    screen.blit('background', (0, 0))")
    for (const layer of images) lines.push(`    ${resourceName(layer.name)}.draw()`)
    lines.push('', '', 'pgzrun.go()', '')
    code = lines.join('\n')
  }
  return { issues, code, imageCount: images.length + (background.kind === 'color' ? 0 : 1), shapeCount: layers.length - images.length }
}

export async function buildPygameFiles(project: Project): Promise<ProjectFile[]> {
  const preview = analyzePygameProject(project.background, project.layers)
  if (preview.issues.length) throw new Error('请先修改不符合要求的图片名称。')
  assertCanvasSize(project.background)
  const files: ProjectFile[] = [{ path: 'main.py', bytes: strToU8(preview.code) }]
  if (project.background.kind !== 'color') {
    const bg = project.background
    const { blob } = await renderImageExport({ ...bg, id: 'background', x: 0, y: 0 }, 'image/png')
    files.push({ path: 'images/background.png', bytes: new Uint8Array(await blob.arrayBuffer()) })
  }
  for (const layer of project.layers) {
    if (!isImageLayer(layer)) continue
    const { blob } = await renderImageExport(layer, 'image/png')
    files.push({ path: `images/${resourceName(layer.name)}.png`, bytes: new Uint8Array(await blob.arrayBuffer()) })
  }
  return files
}

export function validProjectName(name: string) {
  return name.length > 0 && name.length <= 100 && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && name !== '.' && name !== '..' && !deviceName.test(name.split('.')[0]!)
}

export function packPygameZip(name: string, files: ProjectFile[]) {
  if (!validProjectName(name)) throw new Error('项目文件夹名称无效。')
  const entries: Record<string, Uint8Array> = { [`${name}/images/`]: new Uint8Array() }
  for (const file of files) entries[`${name}/${file.path}`] = file.bytes
  return zipSync(entries, { level: 0 })
}

export async function savePygameFiles(name: string, files: ProjectFile[]): Promise<string | null> {
  if (window.sceneBoardDesktop) return window.sceneBoardDesktop.savePygameProject(name, files)
  const bytes = packPygameZip(name, files)
  return await download(new Blob([bytes], { type: 'application/zip' }), `${name}.zip`) ? `${name}.zip` : null
}
