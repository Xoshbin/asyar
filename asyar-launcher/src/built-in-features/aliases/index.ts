export { aliasService, AliasService } from './aliasService';
export { aliasStore, type ItemAlias } from './aliasStore.svelte';
export { default as AliasCapture } from './AliasCapture.svelte';
export {
  validateAlias,
  normalizeAlias,
  ALIAS_REGEX,
  ALIAS_MAX_LEN,
  type ValidateResult,
} from './aliasValidation';
