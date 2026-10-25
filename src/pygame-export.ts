import { strToU8, zipSync } from 'fflate'
import { assertCanvasSize } from './background'
import { download } from './files'
import { renderImageExport } from './image-export'
import { isImageLayer, type Background, type Layer, type Project, type AnimationGroup } from './project'

export interface ProjectFile { path: string; bytes: Uint8Array }
export { resourceName } from './resource-names'
import { deviceName, resourceName } from './resource-names'
import { analyzeResources, buildAnimationFiles, type ResourceIssue } from './animation'
export type NameIssue = ResourceIssue

export function analyzePygameProject(background: Background, layers: Layer[], animations: AnimationGroup[] = []) {
  const images = layers.filter(isImageLayer)
  const issues = analyzeResources(layers, animations)
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
  return { issues, code, imageCount: images.length + animations.reduce((count, group) => count + group.frames.length, 0) + (background.kind === 'color' ? 0 : 1), shapeCount: layers.length - images.length }
}

export async function buildPygameFiles(project: Project): Promise<ProjectFile[]> {
  const preview = analyzePygameProject(project.background, project.layers, project.animations)
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
  for (const group of project.animations ?? []) files.push(...await buildAnimationFiles(group))
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
