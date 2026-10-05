import { t } from '../../services/i18n';
import type { SystemActionId } from '../../lib/ipc/commands';

export interface SystemActionSpec {
  id: SystemActionId;
  name: string;
  description: string;
  icon: string;
  /** Present on destructive actions — shown as a danger confirm dialog. */
  confirm?: {
    title: string;
    message: string;
    confirmText: string;
  };
}

/**
 * Display metadata for every action the Rust backend can report. Which of
 * these actually get registered is decided by `system_actions_supported`
 * at activation — e.g. `hibernate` only appears on machines where the OS
 * has it enabled.
 *
 * @param os `platform()` from `@tauri-apps/plugin-os` — Windows says
 * "Sign Out" where everything else says "Log Out".
 */
export function systemActionSpecs(os: string): Record<SystemActionId, SystemActionSpec> {
  const logOutName =
    os === 'windows' ? t('features.system.sign_out') : t('features.system.log_out');
  return {
    sleep: {
      id: 'sleep',
      name: t('features.system.sleep'),
      description: t('features.system.sleep_desc'),
      icon: 'icon:moon',
    },
    hibernate: {
      id: 'hibernate',
      name: t('features.system.hibernate'),
      description: t('features.system.hibernate_desc'),
      icon: 'icon:moon',
    },
    lockScreen: {
      id: 'lockScreen',
      name: t('features.system.lock'),
      description: t('features.system.lock_desc'),
      icon: 'icon:lock',
    },
    logOut: {
      id: 'logOut',
      name: logOutName,
      description: t('features.system.log_out_desc'),
      icon: 'icon:log-out',
      confirm: {
        title: logOutName,
        message: t('features.system.log_out_confirm', { action: logOutName.toLowerCase() }),
        confirmText: logOutName,
      },
    },
    restart: {
      id: 'restart',
      name: t('features.system.restart'),
      description: t('features.system.restart_desc'),
      icon: 'icon:refresh',
      confirm: {
        title: t('features.system.restart'),
        message: t('features.system.restart_confirm'),
        confirmText: t('features.system.restart'),
      },
    },
    shutDown: {
      id: 'shutDown',
      name: t('features.system.shut_down'),
      description: t('features.system.shut_down_desc'),
      icon: 'icon:power',
      confirm: {
        title: t('features.system.shut_down'),
        message: t('features.system.shut_down_confirm'),
        confirmText: t('features.system.shut_down'),
      },
    },
  };
}
