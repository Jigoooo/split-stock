import type { EventLogger } from './logging/event-logger';

/** electron-updater 통합. packaged 빌드에서만 실제 체크, dev에서는 no-op. */
export async function initAutoUpdater(isPackaged: boolean, logger: EventLogger): Promise<void> {
  if (!isPackaged) {
    logger.log({
      level: 'INFO',
      category: 'SYS',
      message: 'updater.skipped.dev',
    });
    return;
  }

  try {
    const mod = (await import('electron-updater')) as unknown as {
      autoUpdater: {
        on: (ev: string, cb: (info?: unknown) => void) => void;
        checkForUpdatesAndNotify: () => Promise<unknown>;
      };
    };
    const { autoUpdater } = mod;
    autoUpdater.on('checking-for-update', () => {
      logger.log({ level: 'INFO', category: 'SYS', message: 'updater.checking' });
    });
    autoUpdater.on('update-available', (info) => {
      logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'updater.available',
        payload: { info: String(info ?? '') },
      });
    });
    autoUpdater.on('update-not-available', () => {
      logger.log({ level: 'INFO', category: 'SYS', message: 'updater.none' });
    });
    autoUpdater.on('download-progress', (info) => {
      logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'updater.progress',
        payload: { info: String(info ?? '') },
      });
    });
    autoUpdater.on('update-downloaded', () => {
      logger.log({ level: 'INFO', category: 'SYS', message: 'updater.downloaded' });
    });
    autoUpdater.on('error', (err) => {
      logger.log({
        level: 'ERROR',
        category: 'SYS',
        message: 'updater.error',
        payload: { cause: String(err ?? '') },
      });
    });
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (cause) {
    logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'updater.init_failed',
      payload: { cause: String(cause) },
    });
  }
}
