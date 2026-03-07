export function extractImageFilesFromTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return []
  }

  const files = Array.from(dataTransfer.files ?? [])
  return files.filter((file) => file.type.toLowerCase().startsWith('image/'))
}

export function hasImageFileInTransfer(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false
  }
  if (extractImageFilesFromTransfer(dataTransfer).length > 0) {
    return true
  }
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === 'file' && item.type.toLowerCase().startsWith('image/'),
  )
}

