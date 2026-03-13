import re

with open('src-tauri/src/lib.rs', 'r') as f:
    content = f.read()

# Add Mutex and HashMap imports if missing
imports = """
use std::collections::HashMap;
use std::sync::Mutex;
"""
if "use std::collections::HashMap;" not in content:
    content = content.replace("use tauri::{Listener, Manager};", "use tauri::{Listener, Manager};\n" + imports)

# Setup state in run() function
setup_state = ".manage(command::ExtensionRegistry(Mutex::new(HashMap::new())))"
if "ExtensionRegistry" not in content:
    content = content.replace(".setup(setup_app)", setup_state + "\n        .setup(setup_app)")

# Add commands to generate_handler
commands_to_add = "command::spawn_headless_extension,\n            command::kill_extension,"
if "command::spawn_headless_extension," not in content:
    content = content.replace("command::write_binary_file_recursive,", "command::write_binary_file_recursive,\n            " + commands_to_add)

with open('src-tauri/src/lib.rs', 'w') as f:
    f.write(content)
