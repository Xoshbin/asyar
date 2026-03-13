with open('src/routes/+page.svelte', 'r') as f:
    content = f.read()

content = content.replace("import { onMount, onDestroy } from 'svelte';", "import { onMount, onDestroy } from 'svelte';\nimport ExtensionIframe from '../components/extension/ExtensionIframe.svelte';")
content = content.replace("manifest={extensionManager.getManifest($activeView.split('/')[0])}", "manifest={extensionManager.getManifest ? extensionManager.getManifest($activeView.split('/')[0]) : null}")

with open('src/routes/+page.svelte', 'w') as f:
    f.write(content)
