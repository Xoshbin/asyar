/** Agent tools use the shared extension transport; execution policy lives in Rust. */
export {
  invokeExtensionTool,
  handleToolResponse,
} from '../../services/extension/extensionToolDispatch';
