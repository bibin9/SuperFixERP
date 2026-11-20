// The project ships without @types/react-dom; only createPortal is used (QuickAdd's popup sits outside the page's form).
declare module "react-dom" {
  export function createPortal(children: import("react").ReactNode, container: Element | DocumentFragment): import("react").ReactPortal;
}
