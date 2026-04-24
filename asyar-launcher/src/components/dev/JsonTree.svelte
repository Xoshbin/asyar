<script lang="ts">
  type Props = {
    value: unknown;
    depth?: number;
    maxDepth?: number;
  };

  let { value, depth = 0, maxDepth = 3 }: Props = $props();

  let open = $state(depth < maxDepth);

  function typeOf(v: unknown): 'null' | 'object' | 'array' | 'string' | 'number' | 'boolean' | 'other' {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'object') return 'object';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    return 'other';
  }

  const t = $derived(typeOf(value));
  const isComposite = $derived(t === 'object' || t === 'array');

  function entries(obj: unknown): [string, unknown][] {
    if (Array.isArray(obj)) return obj.map((v, i) => [String(i), v] as [string, unknown]);
    if (obj && typeof obj === 'object') return Object.entries(obj as Record<string, unknown>);
    return [];
  }

  function summary(v: unknown, kind: typeof t): string {
    if (kind === 'array') {
      const arr = v as unknown[];
      return `Array(${arr.length})`;
    }
    if (kind === 'object') {
      const obj = v as Record<string, unknown>;
      return `{…${Object.keys(obj).length}}`;
    }
    return '';
  }
</script>

{#if !isComposite}
  <span class="json-{t}">{#if t === 'string'}"{value}"{:else if t === 'null'}null{:else}{String(value)}{/if}</span>
{:else}
  <span class="tree">
    <button
      type="button"
      class="toggle"
      class:open
      onclick={() => (open = !open)}
      aria-label="Toggle"
    >
      {open ? '▾' : '▸'} <span class="summary">{summary(value, t)}</span>
    </button>
    {#if open}
      <ul class="children">
        {#each entries(value) as [k, v] (k)}
          <li>
            <span class="key">{k}:</span>
            <svelte:self value={v} depth={depth + 1} {maxDepth} />
          </li>
        {/each}
      </ul>
    {/if}
  </span>
{/if}

<style>
  .tree {
    display: inline-block;
  }
  .toggle {
    background: transparent;
    border: 0;
    color: var(--color-text-muted, #888);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
  }
  .summary {
    color: var(--color-text-muted, #777);
    font-style: italic;
  }
  .children {
    list-style: none;
    margin: 0 0 0 14px;
    padding: 0;
  }
  .children li {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
    line-height: 1.5;
  }
  .key {
    color: var(--color-text-accent, #8ab4f8);
    margin-right: 4px;
  }
  .json-string {
    color: #a5d6a7;
  }
  .json-number {
    color: #ffab91;
  }
  .json-boolean {
    color: #ce93d8;
  }
  .json-null {
    color: #888;
    font-style: italic;
  }
  .json-other {
    color: #bbb;
  }
</style>
