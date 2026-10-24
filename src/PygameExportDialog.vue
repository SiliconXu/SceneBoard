<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { analyzePygameProject, buildPygameFiles, savePygameFiles, validProjectName } from './pygame-export'
import type { Project } from './project'
const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: []; locate: [id: string]; saved: [path: string] }>()
const preview = computed(() => analyzePygameProject(props.project.background, props.project.layers))
const name = ref('pygame_project')
const nameInput = ref<HTMLInputElement>()
const error = ref('')
const busy = ref(false)
const desktop = !!window.sceneBoardDesktop
onMounted(() => nameInput.value?.focus())
function close() { if (!busy.value) emit('close') }
async function save() {
  if (busy.value || preview.value.issues.length) return
  error.value = ''
  if (!validProjectName(name.value)) { error.value = '项目名称须为有效文件夹名，最多 100 个字符，不能以空格或句点结尾。'; return }
  busy.value = true
  try {
    const files = await buildPygameFiles(props.project)
    const path = await savePygameFiles(name.value, files)
    if (path) emit('saved', path)
  } catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="close" @keydown.esc.stop="close">
    <section class="modal pygame-dialog" role="dialog" aria-modal="true" aria-labelledby="pygame-title" :aria-busy="busy">
      <h2 id="pygame-title">导出 Pygame Zero 项目</h2>
      <p>只生成场景显示代码。运行前请安装 Python 和 Pygame Zero，可使用 python main.py 启动。</p>
      <label class="project-name">项目名称<input ref="nameInput" v-model="name" aria-label="项目名称" maxlength="100" :disabled="busy" /></label>
      <p>main.py · images/ · {{ preview.imageCount }} 张图片</p>
      <p v-if="project.background.kind === 'color'">纯色背景直接填充 {{ project.background.color }}，不生成 background.png。</p>
      <p v-if="preview.shapeCount">{{ preview.shapeCount }} 个矩形／椭圆为辅助标记，不导出。名称、坐标与选框也不导出。</p>
      <div v-if="preview.issues.length" class="name-issues" role="alert">
        <strong>请修改以下图层名称后重新打开导出：</strong>
        <ul><li v-for="issue in preview.issues" :key="issue.id"><button class="text-button" :disabled="busy" @click="emit('locate', issue.id)">{{ issue.name || '未命名对象' }} · 定位修改</button><span>{{ issue.reason }}</span></li></ul>
        <small>去掉图片扩展名后，使用小写英文字母开头，仅包含小写字母、数字和下划线，不得重名或使用保留名称。</small>
      </div>
      <template v-else><strong class="validation-ok">名称检查通过</strong><pre class="code-preview" aria-label="Python 代码预览" tabindex="0">{{ preview.code }}</pre></template>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="modal-actions"><button class="button" :disabled="busy" @click="close">取消</button><button class="button primary" :disabled="busy || !!preview.issues.length" @click="save">{{ busy ? '正在导出…' : desktop ? '导出项目文件夹…' : '下载项目 ZIP' }}</button></div>
    </section>
  </div>
</template>
