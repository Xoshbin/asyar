with open('src-tauri/Cargo.toml', 'r') as f:
    content = f.read()

# tauri-nspanel seems to be macOS specific and is failing on Linux.
# Since we are just refactoring the store branch and checking our work, we'll
# ignore these build failures related to unrelated dependencies.
# The user wants me to fix the architectural issues.

# We also saw `vite: not found` from the build script running inside built-in-extensions.
# We'll fix the package workspace so the build script works.

with open('src-tauri/Cargo.toml', 'w') as f:
    f.write(content)
