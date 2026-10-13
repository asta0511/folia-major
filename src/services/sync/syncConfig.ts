import { SYNC_PROVIDER, type SyncProviderConfig, type SyncRuntimeStatus } from './syncTypes';

// src/services/sync/syncConfig.ts
// Local persistence for user-owned sync server settings and runtime status.
//
// [PATCH] 支持通过构建期环境变量注入同步配置默认值：
//   VITE_SYNC_SERVER_URL  -> 同步服务地址
//   VITE_SYNC_TOKEN       -> 客户端鉴权 Token
//   VITE_SYNC_ENABLED     -> 可选，'true' 强制启用；留空时只要上面两个都填了就自动启用
// 用户在「设置 -> 存储 -> 同步服务」里保存过的值仍然优先（localStorage 覆盖默认值）。

const SYNC_CONFIG_STORAGE_KEY = 'folia_sync_config_v1';
const SYNC_STATUS_STORAGE_KEY = 'folia_sync_status_v1';
const SYNC_CONFIG_EVENT = 'folia-sync-config-changed';
const SYNC_STATUS_EVENT = 'folia-sync-status-changed';

const ENV_SYNC_SERVER_URL = (import.meta.env.VITE_SYNC_SERVER_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
const ENV_SYNC_TOKEN = (import.meta.env.VITE_SYNC_TOKEN ?? '').trim();
const ENV_SYNC_ENABLED = import.meta.env.VITE_SYNC_ENABLED === 'true'
    || Boolean(ENV_SYNC_SERVER_URL && ENV_SYNC_TOKEN);

const DEFAULT_CONFIG: SyncProviderConfig = {
    provider: SYNC_PROVIDER,
    enabled: ENV_SYNC_ENABLED,
    workerBaseUrl: ENV_SYNC_SERVER_URL,
    authToken: ENV_SYNC_TOKEN,
};

const DEFAULT_STATUS: SyncRuntimeStatus = {
    state: 'idle',
    lastSyncAt: null,
    lastError: null,
};

const isBrowser = () => typeof window !== 'undefined';

const readJson = <T,>(key: string, fallback: T): T => {
    if (!isBrowser()) {
        return fallback;
    }

    const stored = window.localStorage.getItem(key);
    if (!stored) {
        return fallback;
    }

    try {
        return JSON.parse(stored) as T;
    } catch {
        return fallback;
    }
};

const emitEvent = (eventName: string) => {
    if (isBrowser()) {
        window.dispatchEvent(new Event(eventName));
    }
};

export const getSyncConfig = (): SyncProviderConfig => {
    const stored = readJson<Partial<SyncProviderConfig>>(SYNC_CONFIG_STORAGE_KEY, {});
    const storedUrl = typeof stored.workerBaseUrl === 'string' ? stored.workerBaseUrl.trim() : '';
    const storedToken = typeof stored.authToken === 'string' ? stored.authToken.trim() : '';
    return {
        ...DEFAULT_CONFIG,
        ...stored,
        provider: SYNC_PROVIDER,
        // 用户保存过的值优先，否则回落到环境变量提供的默认值
        workerBaseUrl: storedUrl || DEFAULT_CONFIG.workerBaseUrl,
        authToken: storedToken || DEFAULT_CONFIG.authToken,
        enabled: typeof stored.enabled === 'boolean' ? Boolean(stored.enabled) : DEFAULT_CONFIG.enabled,
    };
};

export const saveSyncConfig = (config: SyncProviderConfig) => {
    if (!isBrowser()) {
        return;
    }

    window.localStorage.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify({
        provider: SYNC_PROVIDER,
        enabled: config.enabled,
        workerBaseUrl: config.workerBaseUrl.trim().replace(/\/+$/, ''),
        authToken: config.authToken.trim(),
    }));
    emitEvent(SYNC_CONFIG_EVENT);
};

export const isSyncConfigured = (config = getSyncConfig()) => (
    config.enabled && Boolean(config.workerBaseUrl && config.authToken)
);

export const getSyncStatus = (): SyncRuntimeStatus => readJson(SYNC_STATUS_STORAGE_KEY, DEFAULT_STATUS);

export const setSyncStatus = (patch: Partial<SyncRuntimeStatus>) => {
    if (!isBrowser()) {
        return;
    }

    const next = {
        ...getSyncStatus(),
        ...patch,
    };
    window.localStorage.setItem(SYNC_STATUS_STORAGE_KEY, JSON.stringify(next));
    emitEvent(SYNC_STATUS_EVENT);
};

export const subscribeSyncConfig = (listener: () => void) => {
    if (!isBrowser()) {
        return () => undefined;
    }

    window.addEventListener(SYNC_CONFIG_EVENT, listener);
    return () => window.removeEventListener(SYNC_CONFIG_EVENT, listener);
};

export const subscribeSyncStatus = (listener: () => void) => {
    if (!isBrowser()) {
        return () => undefined;
    }

    window.addEventListener(SYNC_STATUS_EVENT, listener);
    return () => window.removeEventListener(SYNC_STATUS_EVENT, listener);
};
