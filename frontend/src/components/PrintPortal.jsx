import { createPortal } from 'react-dom';

// Renders its children directly under <body>, sibling to the modal that
// requested the print — not nested inside it. Printing straight out of a
// modal (position:fixed backdrop + a max-height/overflow-y:auto card) left
// that invisible ancestor chain still occupying layout height during
// print, which the browser paginated into extra blank sheets after the one
// real page of content. A portal has no such ancestors to fight with.
export default function PrintPortal({ children }) {
  return createPortal(
    <div className="print-portal-root">{children}</div>,
    document.body
  );
}
