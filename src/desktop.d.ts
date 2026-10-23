export {}
declare global {
  interface Window {
    sceneBoardDesktop?: {
      save(filename: string, bytes: Uint8Array): Promise<boolean>
      copyText(text: string): Promise<void>
    }
  }
}
