export function getTag(tags: string[][], name: string): string | undefined {
  return tags.find((tag) => tag[0] === name)?.[1] ?? undefined
}

export function getTags(tags: string[][], name: string): string[][] {
  return tags.filter((tag) => tag[0] === name)
}

export function hasTag(tags: string[][], name: string): boolean {
  return tags.some((tag) => tag[0] === name)
}

export function buildTagMap(tags: string[][]): Map<string, string> {
  const map = new Map<string, string>()
  for (const tag of tags) {
    const [name, value] = tag
    if (name !== undefined && !map.has(name) && value !== undefined) {
      map.set(name, value)
    }
  }
  return map
}
