import re

with open('src/services/extension/extensionManager.ts', 'r') as f:
    content = f.read()

# Add getManifest method to ExtensionManager
manifest_method = """
  public getManifest(id: string): ExtensionManifest | undefined {
    return this.manifestsById.get(id);
  }

"""
content = re.sub(r'(public getLoadedExtensionModule.*?\{.*?\})', r'\1\n' + manifest_method, content, flags=re.DOTALL)

with open('src/services/extension/extensionManager.ts', 'w') as f:
    f.write(content)
