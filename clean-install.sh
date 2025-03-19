#!/bin/bash
echo "Cleaning asyar-api installation..."

# Remove node_modules and build artifacts
rm -rf node_modules
rm -rf dist

# Clear npm cache specifically for this package
pnpm cache delete

# Reinstall dependencies
pnpm install

./clean-install-extensions.sh

echo "SDK clean install complete"
