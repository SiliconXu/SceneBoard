const keywords = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '))
const reserved = new Set('screen images sounds music keyboard keymods keys mouse clock animate animation tone exit storage pgzrun draw update on_mouse_down on_mouse_up on_mouse_move on_key_down on_key_up on_music_end background __builtins__ __name__ __file__'.split(' '))
export const deviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
export const resourceName = (name: string) => name.replace(/\.(png|jpe?g|webp)$/i, '')
export function resourceNameIssue(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return '名称须以小写英文字母开头，只包含小写字母、数字和下划线。'
  if (name.length > 100) return '名称不能超过 100 个字符。'
  if (keywords.has(name)) return '不能使用 Python 关键字。'
  if (reserved.has(name)) return '不能使用 Pygame Zero 或生成代码的保留名称。'
  if (deviceName.test(name)) return '不能使用 Windows 保留文件名。'
  return ''
}
