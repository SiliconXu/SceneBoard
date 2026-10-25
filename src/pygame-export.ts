import { strToU8, zipSync } from 'fflate'
import { assertCanvasSize } from './background'
import { download } from './files'
import { renderImageExport } from './image-export'
import { isImageLayer, type Background, type Layer, type Project, type AnimationGroup } from './project'

export interface ProjectFile { path: string; bytes: Uint8Array }
export { resourceName } from './resource-names'
import { deviceName, resourceName } from './resource-names'
import { analyzeResources, animationFrameName, buildAnimationFiles, type ResourceIssue } from './animation'
export type NameIssue = ResourceIssue

function animationExample(groups: AnimationGroup[]): string[] {
  if (!groups.length) return []
  const lines = ['# 动画素材：帧顺序与 FPS 来自编辑器', '_animation_frames = {']
  for (const group of groups) {
    const frames = group.frames.map((_, index) => `'${animationFrameName(group, index)}'`)
    lines.push(`    '${group.name}': [${frames.join(', ')}],`)
  }
  lines.push('}', '_animation_fps = {')
  for (const group of groups) lines.push(`    '${group.name}': ${group.fps},`)
  lines.push('}', '',
    '# 动画播放示例：默认不启用，不会自动创建角色或改变场景。',
    '# 将 YOUR_ACTOR 替换为已有角色变量，删除暂不播放的组，再取消下面代码的注释。',
    '# 同一角色通常只绑定一组；没有角色时需先创建 Actor，并在 draw() 中绘制。',
    '# 如果已有 update(dt)，请合并函数内容，保持只有一个 update。',
    '# 动画使用导出帧的统一原始尺寸，可能与场景图片的缩放尺寸不同。')
  const example = ['_animation_targets = {', ...groups.map(group => `    '${group.name}': YOUR_ACTOR,`),
    '}', '_animation_time = 0.0', '', 'def update(dt):',
    '    global _animation_time', '    _animation_time += dt',
    '    for _name, _actor in _animation_targets.items():',
    '        _frames = _animation_frames[_name]',
    '        _actor.image = _frames[int(_animation_time * _animation_fps[_name]) % len(_frames)]']
  lines.push(...example.map(line => `# ${line}`.trimEnd()), '# 动画播放示例结束', '')
  return lines
}

export function analyzePygameProject(background: Background, layers: Layer[], animations: AnimationGroup[] = []) {
  const images = layers.filter(isImageLayer)
  const shapes = layers.filter(layer => !isImageLayer(layer))
  const issues = analyzeResources(layers, animations, { includeShapes: true })
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
    if (shapes.length) {
      lines.push('# 碰撞区域：Rect(左上角 X, 左上角 Y, 宽, 高)')
      for (const shape of shapes) {
        if (shape.kind === 'ellipse') lines.push('# 圆形／椭圆的外接矩形碰撞区域')
        lines.push(`${shape.name} = Rect(${Math.round(shape.x)}, ${Math.round(shape.y)}, ${Math.max(1, Math.round(shape.width))}, ${Math.max(1, Math.round(shape.height))})`, '')
      }
    }
    lines.push('# 绘制场景', 'def draw():', background.kind === 'color' ? `    screen.fill('${background.color}')` : "    screen.blit('background', (0, 0))")
    for (const layer of images) lines.push(`    ${resourceName(layer.name)}.draw()`)
    lines.push('', '', ...animationExample(animations), 'pgzrun.go()', '')
    code = lines.join('\n')
  }
  return { issues, code, imageCount: images.length + animations.reduce((count, group) => count + group.frames.length, 0) + (background.kind === 'color' ? 0 : 1), shapeCount: layers.length - images.length }
}

export async function buildPygameFiles(project: Project): Promise<ProjectFile[]> {
  const preview = analyzePygameProject(project.background, project.layers, project.animations)
  if (preview.issues.length) throw new Error('请先修改不符合要求的图层或动画素材名称。')
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
