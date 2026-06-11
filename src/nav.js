// Page-level navigation state shared between App (which parses the hash) and
// the bodies (which scroll once their DOM exists). A deep-linked section has
// to wait for BOTH the entity's data and its lazy body chunk — the body's
// mount effect is the one moment that's guaranteed to be after both.
let pendingSection = null;

export const setPendingSection = (s) => { pendingSection = s; };

export function consumePendingSection() {
  const s = pendingSection;
  pendingSection = null;
  return s;
}
