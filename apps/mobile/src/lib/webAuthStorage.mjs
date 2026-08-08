function getDefaultSessionStorage() {
  try {
    const storage = globalThis.sessionStorage;
    if (
      storage &&
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function" &&
      typeof storage.removeItem === "function"
    ) {
      return storage;
    }
  } catch {
    // Some embedded/private browsers expose sessionStorage but deny access.
  }

  return null;
}

export function createBrowserAuthStorage(storage = getDefaultSessionStorage()) {
  const memory = new Map();
  const shadowedKeys = new Set();

  return {
    async getItem(key) {
      if (shadowedKeys.has(key)) {
        return memory.get(key) ?? null;
      }

      if (storage) {
        try {
          const value = storage.getItem(key);
          if (typeof value === "string") {
            memory.set(key, value);
            return value;
          }

          memory.delete(key);
          return null;
        } catch {
          // Keep the storage reference so a later logout can retry removal.
        }
      }

      return memory.get(key) ?? null;
    },

    async setItem(key, value) {
      memory.set(key, value);

      if (storage) {
        try {
          storage.setItem(key, value);
          shadowedKeys.delete(key);
        } catch {
          // The durable value may still be an older refresh token. Hide it
          // from this client and remove it before falling back to memory.
          shadowedKeys.add(key);
          try {
            storage.removeItem(key);
          } catch {
            // An inaccessible store cannot be trusted for persistence. The
            // current tab remains usable through the in-memory value.
          }
        }
      }
    },

    async removeItem(key) {
      memory.delete(key);
      shadowedKeys.add(key);

      if (storage) {
        try {
          storage.removeItem(key);
          shadowedKeys.delete(key);
        } catch {
          // Keep the tombstone in this client and retry on a later removal.
        }
      }
    },
  };
}
