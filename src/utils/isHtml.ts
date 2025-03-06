export function isHtml(content: any): boolean {
  if (typeof content === "string") {
    // Check if it looks like HTML (basic tag check)
    return /<(?=.*? .*?\/?>|.+?>)[a-z]+.*?>/i.test(content);
  }

  if (typeof content === "object" && content !== null) {
    //check if it is a dom node
    if (content instanceof Node) {
      return true;
    }
  }

  return false;
}
