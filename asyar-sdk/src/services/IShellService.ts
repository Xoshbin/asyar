export interface SpawnParams {
    program: string;
    args?: string[];
}

export interface ShellChunk {
    stream: 'stdout' | 'stderr';
    data: string;
}

export interface ShellHandle {
    /**
     * Id of the underlying spawn. Stable across `attach()` calls — persist
     * this in extension storage to reattach after an iframe reload.
     */
    readonly spawnId: string;

    /**
     * Fired when a line of output is received from stdout or stderr.
     */
    onChunk(cb: (chunk: ShellChunk) => void): void;

    /**
     * Fired when the process exits successfully.
     * @param exitCode The numeric exit code if available.
     */
    onDone(cb: (exitCode?: number) => void): void;

    /**
     * Fired if the process fails to start or encounters a runtime error.
     */
    onError(cb: (error: { code: string; message: string }) => void): void;

    /**
     * Kills the running process.
     */
    abort(): void;
}

/**
 * Snapshot of a spawn tracked by the launcher registry, returned from
 * `list()` and `attach()`. Used to re-identify a surviving child process
 * across iframe reloads.
 */
export interface ShellDescriptor {
    spawnId: string;
    program: string;
    args: string[];
    pid: number;
    /** Unix millis. */
    startedAt: number;
}

export interface IShellService {
    /**
     * Spawns an arbitrary OS process and streams its output.
     * Requires the 'shell:spawn' permission in manifest.json.
     * User will be prompted to trust the binary on first use.
     */
    spawn(params: SpawnParams): ShellHandle;

    /**
     * Returns the descriptors of every live spawn tracked for the calling
     * extension — cross-extension ids are never surfaced. Use on extension
     * boot to discover child processes that survived an iframe reload.
     */
    list(): Promise<ShellDescriptor[]>;

    /**
     * Re-subscribes to an existing spawn's event stream, returning a fresh
     * handle. If the process already exited within the registry's retention
     * window the returned handle fires `onDone` immediately with the stored
     * exit code; cross-extension / unknown ids surface via `onError` with
     * `{ code: 'ATTACH_FAILED' }`.
     */
    attach(spawnId: string): ShellHandle;
}
