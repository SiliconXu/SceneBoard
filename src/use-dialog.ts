import { nextTick, onBeforeUnmount, onMounted, type Ref } from 'vue'

export function useDialog(element: Ref<HTMLElement | undefined>, close: () => void) {
  const origin = document.activeElement as HTMLElement | null
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key !== 'Tab' || !element.value) return
    const controls = Array.from(element.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"], summary')).filter(item => item.getClientRects().length)
    const first = controls[0], last = controls.at(-1)
    if (!first) { event.preventDefault(); element.value.focus(); return }
    if (event.shiftKey && (document.activeElement === first || !element.value.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && (document.activeElement === last || !element.value.contains(document.activeElement))) { event.preventDefault(); first.focus() }
  }
  onMounted(() => {
    element.value?.addEventListener('keydown', keydown)
    const target = element.value?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled),select:not(:disabled)') ?? element.value
    target?.focus()
  })
  onBeforeUnmount(() => { element.value?.removeEventListener('keydown', keydown); void nextTick(() => { if (origin?.isConnected) origin.focus({ preventScroll: true }) }) })
}
