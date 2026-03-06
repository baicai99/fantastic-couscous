const IMAGE_DB_NAME = 'm3-image-assets-db'
const IMAGE_DB_VERSION = 1
const IMAGE_STORE = 'image-assets'

interface ImageAssetRecord {
  id: string
  blob: Blob
  createdAt: number
  updatedAt: number
  size: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null)
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(IMAGE_STORE)) {
          db.createObjectStore(IMAGE_STORE, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
  }

  return dbPromise
}

export async function putImageBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb()
  if (!db) {
    return
  }

  const now = Date.now()
  const record: ImageAssetRecord = {
    id,
    blob,
    createdAt: now,
    updatedAt: now,
    size: blob.size,
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction(IMAGE_STORE, 'readwrite')
    const store = tx.objectStore(IMAGE_STORE)
    store.put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

export async function getImageBlob(id: string): Promise<Blob | null> {
  const db = await openDb()
  if (!db) {
    return null
  }

  return new Promise((resolve) => {
    const tx = db.transaction(IMAGE_STORE, 'readonly')
    const store = tx.objectStore(IMAGE_STORE)
    const request = store.get(id)
    request.onsuccess = () => {
      const value = request.result as ImageAssetRecord | undefined
      resolve(value?.blob ?? null)
    }
    request.onerror = () => resolve(null)
  })
}

export async function deleteImageBlob(id: string): Promise<void> {
  const db = await openDb()
  if (!db) {
    return
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction(IMAGE_STORE, 'readwrite')
    const store = tx.objectStore(IMAGE_STORE)
    store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}
