import type { SerializedDockview } from 'dockview';

export const ALPHA_LAYOUT_STORAGE_KEY = 'api-spec-studio.alpha-dockview-layout.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
    return null;
  }
  return globalThis.localStorage;
}

export function isSerializedDockviewLayout(value: unknown): value is SerializedDockview {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as {
    grid?: { root?: unknown; height?: unknown; width?: unknown; orientation?: unknown };
    panels?: unknown;
  };

  return Boolean(
    candidate.grid &&
    typeof candidate.grid === 'object' &&
    candidate.grid.root &&
    typeof candidate.grid.height === 'number' &&
    typeof candidate.grid.width === 'number' &&
    (candidate.grid.orientation === 'horizontal' || candidate.grid.orientation === 'vertical') &&
    candidate.panels &&
    typeof candidate.panels === 'object',
  );
}

export function loadDockviewLayout(
  storage?: StorageLike,
  key = ALPHA_LAYOUT_STORAGE_KEY,
): SerializedDockview | null {
  try {
    const target = resolveStorage(storage);
    const raw = target?.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return isSerializedDockviewLayout(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDockviewLayout(
  layout: SerializedDockview,
  storage?: StorageLike,
  key = ALPHA_LAYOUT_STORAGE_KEY,
): boolean {
  try {
    const target = resolveStorage(storage);
    if (!target || !isSerializedDockviewLayout(layout)) {
      return false;
    }

    target.setItem(key, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export function clearDockviewLayout(storage?: StorageLike, key = ALPHA_LAYOUT_STORAGE_KEY): boolean {
  try {
    const target = resolveStorage(storage);
    if (!target) {
      return false;
    }

    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
