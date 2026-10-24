const { app, BrowserWindow, dialog, ipcMain, clipboard } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// Unpacked distribution: everything writable lives beside SceneBoard.exe.
const root = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..', '.portable-dev')
const directories = { appData: 'data', userData: 'data/profile', sessionData: 'data/session', temp: 'data/temp', crashDumps: 'data/crashes' }
try {
  for (const [name, relative] of Object.entries(directories)) {
    const directory = path.join(root, relative)
    fs.mkdirSync(directory, { recursive: true })
    app.setPath(name, directory)
  }
  fs.mkdirSync(path.join(root, 'data/logs'), { recursive: true })
  app.setAppLogsPath(path.join(root, 'data/logs'))
  for (const folder of ['projects', 'exports']) fs.mkdirSync(path.join(root, folder), { recursive: true })
  process.env.TEMP = process.env.TMP = app.getPath('temp')
} catch {
  dialog.showErrorBox('SceneBoard 无法启动', '程序目录不可写。请将整个 SceneBoard 文件夹放到可写的 U 盘或文件夹中再运行。')
  app.exit(1)
}
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
const pageUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href
let mainWindow

function assertLocal(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== pageUrl) throw new Error('无效的页面请求。')
}

app.whenReady().then(() => {
  ipcMain.handle('portable:pygame-project', async (event, name, files) => {
    assertLocal(event)
    const { validateFiles, writeProject } = require('./project-export.cjs')
    validateFiles(files)
    if (typeof name !== 'string' || name.length > 100 || !/^[^<>:"/\\|?*\x00-\x1f]+$/.test(name)) throw new Error('项目文件夹名称无效。')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 Pygame Zero 项目文件夹', defaultPath: path.join(root, 'exports', name),
      buttonLabel: '创建项目文件夹', properties: ['createDirectory', 'dontAddToRecent'],
    })
    if (result.canceled || !result.filePath) return null
    return writeProject(root, result.filePath, files)
  })
  ipcMain.handle('portable:save', async (event, filename, bytes) => {
    assertLocal(event)
    if (typeof filename !== 'string' || filename.length > 250 || !(bytes instanceof Uint8Array)) throw new Error('保存文件的数据无效。')
    const safeName = path.basename(filename).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    const project = safeName.endsWith('.frame.json')
    const extension = path.extname(safeName).slice(1).toLowerCase()
    const formats = { json: 'JSON 文件', png: 'PNG 图片', jpg: 'JPEG 图片', jpeg: 'JPEG 图片', webp: 'WebP 图片' }
    if (!Object.hasOwn(formats, extension)) throw new Error('不支持的文件类型。')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: project ? '保存项目到便携目录' : '导出到便携目录',
      defaultPath: path.join(root, project ? 'projects' : 'exports', safeName),
      filters: [{ name: formats[extension], extensions: [extension] }],
    })
    if (result.canceled || !result.filePath) return false
    const realRoot = await fsp.realpath(root)
    const realParent = await fsp.realpath(path.dirname(result.filePath))
    const relative = path.relative(realRoot, realParent)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('便携版只能保存到程序所在文件夹或其子文件夹中。')
    // Replace files by rename, so an interrupted write cannot corrupt a saved project.
    const target = path.join(realParent, path.basename(result.filePath))
    const temporary = path.join(realParent, `.sceneboard-${require('node:crypto').randomUUID()}.tmp`)
    try {
      await fsp.writeFile(temporary, bytes, { flag: 'wx' })
      await fsp.rename(temporary, target)
    } finally { await fsp.unlink(temporary).catch(() => {}) }
    return true
  })
  ipcMain.handle('portable:clipboard', (event, text) => {
    assertLocal(event)
    if (typeof text !== 'string') throw new Error('剪贴板数据无效。')
    clipboard.writeText(text)
  })
  mainWindow = new BrowserWindow({
    width: 1280, height: 900, minWidth: 800, minHeight: 650, title: 'SceneBoard',
    icon: path.join(__dirname, '..', 'src', 'logo.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  mainWindow.removeMenu()
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(mainWindow, { type: 'question', buttons: ['继续编辑', '放弃更改并关闭'], defaultId: 0, cancelId: 0, title: '项目尚未保存', message: '当前项目有未保存的更改。是否放弃更改并关闭？' })
    if (choice === 1) event.preventDefault()
  })
  mainWindow.loadURL(pageUrl)
})
app.on('window-all-closed', () => app.quit())
