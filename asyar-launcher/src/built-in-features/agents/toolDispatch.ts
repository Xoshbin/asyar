/** Agent tools use the shared extension transport; execution policy lives in Rust. */
export {
  invokeExtensionTool,
  handleToolResponse,
} from '../../services/extension/extensionToolDispatch';
export {
  invokeExtensionWebSearch,
  handleWebSearchResponse,
} from '../../services/extension/extensionWebSearchDispatch';
export {
  invokeExtensionWebReader,
  handleWebReaderResponse,
} from '../../services/extension/extensionWebReaderDispatch';
