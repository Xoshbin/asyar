export interface RaycastCommand {
  name: string;
  title: string;
  description?: string;
  mode: 'view' | 'no-view' | 'menu-bar';
  icon?: string;
  preferences?: RaycastPreference[];
}

export interface RaycastPreference {
  name: string;
  title: string;
  description?: string;
  type: 'textfield' | 'password' | 'checkbox' | 'dropdown' | 'appPicker' | 'file';
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  data?: Array<{ title: string; value: string }>;
  label?: string;
}

export interface RaycastPackageJson {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  author?: string;
  icon?: string;
  categories?: string[];
  commands?: RaycastCommand[];
  preferences?: RaycastPreference[];
}

export interface AsyarPreferenceItem {
  name: string;
  type: 'text' | 'password' | 'checkbox' | 'select' | 'number';
  title: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: Array<{ title: string; value: string }>;
}

export interface AsyarCommandItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  mode: 'view' | 'background';
  component?: string;
}

export interface AsyarManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  type: 'extension';
  asyarSdk: string;
  searchable: boolean;
  background?: {
    main: string;
  };
  permissions: string[];
  preferences?: AsyarPreferenceItem[];
  commands: AsyarCommandItem[];
}

export interface AdaptOptions {
  idPrefix?: string;
  sdkVersion?: string;
}

/**
 * Translates a Raycast extension `package.json` into an Asyar `manifest.json`.
 */
export function adaptRaycastPackageJson(
  pkg: RaycastPackageJson,
  options?: AdaptOptions,
): AsyarManifest {
  const idPrefix = options?.idPrefix ?? 'org.asyar.raycast';
  const sdkVersion = options?.sdkVersion ?? '^4.11.0';

  const id = `${idPrefix}.${pkg.name}`;
  const name = pkg.title || pkg.name;
  const version = pkg.version || '1.0.0';
  const description = pkg.description || '';
  const author = pkg.author || 'Raycast Community';
  const icon = pkg.icon || 'icon.png';

  const commands: AsyarCommandItem[] = (pkg.commands || []).map((cmd) => {
    const isView = cmd.mode === 'view';
    return {
      id: cmd.name,
      name: cmd.title || cmd.name,
      description: cmd.description,
      icon: cmd.icon,
      mode: isView ? 'view' : 'background',
      component: isView ? cmd.name : undefined,
    };
  });

  const preferences: AsyarPreferenceItem[] = (pkg.preferences || []).map((pref) => {
    let type: AsyarPreferenceItem['type'] = 'text';
    let options: Array<{ title: string; value: string }> | undefined = undefined;

    switch (pref.type) {
      case 'password':
        type = 'password';
        break;
      case 'checkbox':
        type = 'checkbox';
        break;
      case 'dropdown':
        type = 'select';
        options = (pref.data || []).map((item) => ({
          title: item.title,
          value: item.value,
        }));
        break;
      case 'textfield':
      case 'appPicker':
      case 'file':
      default:
        type = typeof pref.default === 'number' ? 'number' : 'text';
        break;
    }

    return {
      name: pref.name,
      title: pref.title,
      description: pref.description,
      type,
      default: pref.default,
      required: pref.required,
      options,
    };
  });

  // Automatically infer essential Asyar permissions for Raycast extensions
  const permissions: string[] = [
    'clipboard:read',
    'clipboard:write',
    'storage:read',
    'storage:write',
    'shell:open-url',
    'network',
    'feedback:report',
  ];

  // Check if OAuth is declared or used
  const hasOAuth = pkg.preferences?.some((p) => p.name.toLowerCase().includes('oauth')) || false;
  if (hasOAuth) {
    permissions.push('oauth:use');
  }

  const hasBackground = commands.some((c) => c.mode === 'background');

  return {
    id,
    name,
    version,
    description,
    author,
    icon,
    type: 'extension',
    asyarSdk: sdkVersion,
    searchable: true,
    background: hasBackground
      ? {
          main: 'dist/worker.js',
        }
      : undefined,
    permissions,
    preferences: preferences.length > 0 ? preferences : undefined,
    commands,
  };
}
