#!/bin/bash
echo "Cleaning asyar-api extensions..."
cd src/extensions

# Iterate through each directory in extensions
for dir in */; do
    if [ -d "$dir" ]; then
        echo "--------------------------------------------------"
        echo "Processing extension: $dir"
        cd "$dir"
        
        # Remove node_modules and build artifacts
        rm -rf node_modules
        rm -rf dist

        # Clear npm cache specifically for this package
        pnpm cache delete

        # Reinstall dependencies
        pnpm install

        cd ..
        echo "Completed cleaning: $dir"
        echo "--------------------------------------------------"
    fi
done

echo "All extensions clean install complete"
