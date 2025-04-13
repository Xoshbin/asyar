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

# Navigate back to the project root or appropriate base directory
# Assuming the script was run from the project root, we are now in src/
cd .. 
# Now navigate to built-in extensions relative to src
cd built-in-extensions

# Iterate through each directory in built-in-extensions
for dir in */; do
    if [ -d "$dir" ]; then
        echo "--------------------------------------------------"
        echo "Processing built-in-extension: $dir"
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

# Navigate back from src/built-in-extensions before finishing
cd ../..

echo "All extensions clean install complete"

