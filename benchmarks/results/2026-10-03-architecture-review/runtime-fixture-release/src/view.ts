import { ExtensionContext } from '../../../../../asyar-sdk/src/view';
import manifest from '../manifest.json';
const context = new ExtensionContext();
context.setExtensionId(manifest.id);
const output = document.querySelector('pre')!;
setInterval(async () => {
  try {
    output.textContent = JSON.stringify(await context.request('status', {}), null, 2);
  } catch (error) {
    output.textContent = String(error);
  }
}, 1000);
