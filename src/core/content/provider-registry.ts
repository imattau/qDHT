import { FilesystemProvider } from './filesystem-provider.js'
import { HttpProvider } from './http-provider.js'
import type { ContentProvider } from './provider.js'

export class ContentProviderRegistry {
  private providers: ContentProvider[] = []

  constructor() {
    this.register(new FilesystemProvider())
    this.register(new HttpProvider())
  }

  register(provider: ContentProvider): void {
    this.providers.push(provider)
  }

  getForUrl(url: string): ContentProvider | null {
    return this.providers.find((provider) => provider.supports(url)) ?? null
  }

  all(): ContentProvider[] {
    return [...this.providers]
  }
}
