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

export interface IShellService {
    /**
     * Spawns an arbitrary OS process and streams its output.
     * Requires the 'shell:spawn' permission in manifest.json.
     * User will be prompted to trust the binary on first use.
     */
    spawn(params: SpawnParams): ShellHandle;
}
