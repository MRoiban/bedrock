/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { cva } from "class-variance-authority";
export const menuContentVariants = cva("onyx-menu-content onyx-floating");
export const menuItemVariants = cva("onyx-menu-item", {
  variants: {
    inset: { true: "onyx-menu-inset", false: "" },
    tone: { danger: "onyx-menu-danger", neutral: "" },
  },
  defaultVariants: { tone: "neutral", inset: false },
});
export const menuLabelVariants = cva("onyx-menu-label", {
  variants: { inset: { true: "onyx-menu-inset", false: "" } },
});
export const menuSeparatorVariants = cva("onyx-menu-separator");
export const menuShortcutVariants = cva("onyx-menu-shortcut");
