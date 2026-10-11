function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

/** Display manifest declarations only; never resolves or reads a secret. */
export function describeSecretRefs(args: unknown): string[] {
  try {
    if (!Array.isArray(args)) return [];
    return args.flatMap((ref): string[] => {
      if (!record(ref) || !Array.isArray(ref.sources) || typeof ref.header !== 'string') return [];
      const hosts = strings(ref.hosts);
      const sources = ref.sources.flatMap((source): string[] => {
        if (!record(source) || typeof source.pointer !== 'string') return [];
        if (source.type === 'jsonFile' && typeof source.path === 'string') {
          return [`at \`${source.pointer}\` in \`${source.path}\``];
        }
        if (source.type === 'keychain' && typeof source.service === 'string') {
          const account =
            typeof source.account === 'string' ? ` (account “${source.account}”)` : '';
          return [`the Keychain item “${source.service}”${account} at \`${source.pointer}\``];
        }
        return [];
      });
      if (!sources.length || !hosts.length) return [];
      const methods = ref.methods === undefined ? ['GET'] : strings(ref.methods);
      const paths = strings(ref.pathPrefixes);
      const firstSource = sources[0].startsWith('the Keychain item')
        ? `in ${sources[0]}`
        : sources[0];
      const sourceText =
        firstSource +
        sources
          .slice(1)
          .map((source) => ` (or ${source})`)
          .join('');
      const keychain = ref.sources.some((source) => record(source) && source.type === 'keychain');
      return [
        `Sends the secret ${sourceText} to ${hosts.join(', ')} — ${methods.join(', ')} ${paths.length ? paths.join(', ') : '(all paths)'} — as the ${ref.header} header.${keychain ? ' macOS may ask you to allow Asyar to read this Keychain item.' : ''}`,
      ];
    });
  } catch {
    return [];
  }
}
