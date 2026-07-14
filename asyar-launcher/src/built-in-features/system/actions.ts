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
  const logOutName = os === 'windows' ? 'Sign Out' : 'Log Out';
  return {
    sleep: {
      id: 'sleep',
      name: 'Sleep',
      description: 'Put the computer to sleep',
      icon: 'icon:moon',
    },
    hibernate: {
      id: 'hibernate',
      name: 'Hibernate',
      description: 'Hibernate the computer',
      icon: 'icon:moon',
    },
    lockScreen: {
      id: 'lockScreen',
      name: 'Lock Screen',
      description: 'Lock the screen',
      icon: 'icon:lock',
    },
    logOut: {
      id: 'logOut',
      name: logOutName,
      description: 'End the current session',
      icon: 'icon:log-out',
      confirm: {
        title: logOutName,
        message: `Are you sure you want to ${logOutName.toLowerCase()}? Unsaved work may be lost.`,
        confirmText: logOutName,
      },
    },
    restart: {
      id: 'restart',
      name: 'Restart',
      description: 'Restart the computer',
      icon: 'icon:refresh',
      confirm: {
        title: 'Restart',
        message: 'Are you sure you want to restart the computer?',
        confirmText: 'Restart',
      },
    },
    shutDown: {
      id: 'shutDown',
      name: 'Shut Down',
      description: 'Shut down the computer',
      icon: 'icon:power',
      confirm: {
        title: 'Shut Down',
        message: 'Are you sure you want to shut down the computer?',
        confirmText: 'Shut Down',
      },
    },
  };
}
