#!/bin/bash
asyar-api/clean-install.sh

echo "Cleaning asyar base installation..."
# Remove node_modules and build artifacts
rm -rf node_modules
rm -rf dist

# Clear npm cache specifically for this package
pnpm cache delete

# Reinstall dependencies
pnpm install
echo "cleaning asyar base completed"

./clean-install-extensions.sh

echo "SDK clean install complete"
