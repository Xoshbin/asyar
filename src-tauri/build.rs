use std::path::{Path, PathBuf};
use std::process::Command;
use fs_extra::dir::{copy, CopyOptions};
use fs_extra::file::{copy as copy_file, CopyOptions as FileCopyOptions}; // Use fs_extra for file copy too

fn main() {
    // --- Build each built-in extension ---
    let base_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let extensions_source_dir = base_dir.join("../src/built-in-extensions");

    println!("cargo:rerun-if-changed={}", extensions_source_dir.display());

    for entry in std::fs::read_dir(&extensions_source_dir).expect("Failed to read extensions source directory") {
        let entry = entry.expect("Failed to read directory entry");
        let path = entry.path();

        if path.is_dir() {
            let extension_name = path.file_name().unwrap().to_str().unwrap();
            println!("cargo:rerun-if-changed={}", path.display());
            println!("--- Building extension: {} ---", extension_name);

            // Assuming pnpm build is the command
            let build_status = Command::new("pnpm")
                .arg("build")
                .current_dir(&path) // Run command inside the extension's directory
                .status()
                .expect(&format!("Failed to execute build command for extension: {}", extension_name));

            if !build_status.success() {
                panic!("Build failed for extension: {}", extension_name);
            }
            println!("--- Finished building extension: {} ---", extension_name);
        }
    }

    // --- Copy built extensions and manifests to src-tauri staging area ---
    let staging_dest_dir = base_dir.join("built-in-extensions"); // Copy directly into src-tauri

    // Clean previous staging area
    if staging_dest_dir.exists() {
        fs_extra::dir::remove(&staging_dest_dir).expect("Failed to remove existing staging directory");
    }
    std::fs::create_dir_all(&staging_dest_dir).expect("Failed to create staging directory");


    // Copy the *build output* (assuming it's in a 'dist' folder) and manifest.json from each extension
    for entry in std::fs::read_dir(&extensions_source_dir).expect("Failed to read extensions source directory again") {
         let entry = entry.expect("Failed to read directory entry");
         let source_ext_path = entry.path(); // e.g., ../src/built-in-extensions/store

         if source_ext_path.is_dir() {
            let extension_name = source_ext_path.file_name().unwrap().to_str().unwrap();
            let target_ext_staging_path = staging_dest_dir.join(extension_name); // e.g., ./built-in-extensions/store

            // Ensure target directory exists for this extension
            std::fs::create_dir_all(&target_ext_staging_path)
                .expect(&format!("Failed to create staging directory for {}", extension_name));

            // 1. Copy 'dist' contents if it exists
            let extension_build_output = source_ext_path.join("dist"); // *** ASSUMPTION: Build output is in 'dist' ***
            if extension_build_output.exists() && extension_build_output.is_dir() {
                 println!("--- Copying build output for: {} ---", extension_name);
                 let options = CopyOptions::new().overwrite(true).content_only(true); // Copy contents of 'dist'
                 copy(&extension_build_output, &target_ext_staging_path, &options)
                    .expect("Failed to copy build output"); // Simplified expect
            } else {
                 eprintln!("Warning: Build output directory 'dist' not found for extension: {}. Only manifest might be copied.", extension_name);
            }

            // 2. Copy 'manifest.json' if it exists
            let manifest_src = source_ext_path.join("manifest.json");
            if manifest_src.exists() {
                println!("--- Copying manifest.json for: {} ---", extension_name);
                let manifest_dest = target_ext_staging_path.join("manifest.json");
                let options = FileCopyOptions::new().overwrite(true);
                copy_file(&manifest_src, &manifest_dest, &options)
                    // .expect(&format!("Failed to copy manifest.json for extension: {}", extension_name));
                    .expect("Failed to copy manifest.json"); // Simplified expect message; Added semicolon
             } else {
                 eprintln!("Warning: manifest.json not found for extension: {}. This extension might not load correctly.", extension_name);
            }
         }
    }


    // --- Run default Tauri build ---
    tauri_build::build()
}
