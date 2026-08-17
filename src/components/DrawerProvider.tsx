"use client";

import { createContext, useContext, useState } from "react";
import Drawer, { SupportLinks } from "@/components/Drawer";

const DrawerCtx = createContext<{ open: () => void }>({ open: () => {} });

export function useDrawer() {
  return useContext(DrawerCtx);
}

/**
 * Renders the sliding drawer at the app root — NOT inside the header.
 * The header's backdrop-blur creates a CSS containing block that clips
 * `position: fixed` children, so the drawer must live outside it.
 */
export function DrawerProvider({
  children,
  support,
}: {
  children: React.ReactNode;
  support: SupportLinks;
}) {
  const [isOpen, setOpen] = useState(false);
  return (
    <DrawerCtx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <Drawer open={isOpen} onClose={() => setOpen(false)} support={support} />
    </DrawerCtx.Provider>
  );
}
