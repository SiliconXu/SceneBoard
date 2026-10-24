export {}
declare global {
  interface Window {
    sceneBoardDesktop?: {
      savePygameProject(name: string, files: { path: string; bytes: Uint8Array }[]): Promise<string | null>
      save(filename: string, bytes: Uint8Array): Promise<boolean>
      copyText(text: string): Promise<void>
    }
  }
}
