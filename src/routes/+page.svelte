<div class="fixed inset-x-0 top-0 z-50">
  <div class="w-full relative border-b-[0.5px] border-gray-400/20">
    <input
      type="text"
      autoComplete="off"
      spellCheck={false}
      placeholder="Search or type a command..."
      class="w-full text-white text-lg outline-none placeholder-gray-400 px-8 py-5"
    />
    <div class="absolute right-6 top-1/2 -translate-y-1/2">
      <kbd class="px-2.5 py-1.5 text-xs text-gray-400 rounded">⌘K</kbd>
    </div>
  </div>
</div>

<div class="pt-[72px] min-h-screen">
  <div class="w-full overflow-hidden">
    <div class="max-h-[calc(100vh-72px)] overflow-y-auto">
      <div class="category-section">
        <button
            type="button"
            class="w-full text-left px-8 py-4 flex flex-col gap-1.5 cursor-pointer transition-colors border-b-[0.5px] border-gray-700/20 last:border-0 hover:bg-gray-700/10"
          >
            <div class="text-white">result.title</div>
            <div class="text-gray-400 text-sm">category.name</div>
          </button>
      </div>
    </div>
  </div>
</div>