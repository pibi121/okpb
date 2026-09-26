"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** user = парень · admin = лаборатория 1.0 · lab2 = лаборатория 2.0 (воронка) */
export type PeachUiMode = "user" | "admin" | "lab2";

const STORAGE_KEY = "peach-ui-mode";

type Ctx = {
  mode: PeachUiMode;
  setMode: (m: PeachUiMode) => void;
  /** Lab 1.0 full menu */
  isAdmin: boolean;
  /** Lab 2.0 funnel menu */
  isLab2: boolean;
  /** Either lab mode — show lab chrome */
  showLabNav: boolean;
  /** Can edit lab tools (templates, publish) in Lab 1 or 2.0 */
  canLabEdit: boolean;
  labAccess: boolean;
};

const PeachUiModeContext = createContext<Ctx | null>(null);

function readInitial(): PeachUiMode {
  if (typeof window === "undefined") return "user";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "admin" || v === "user" || v === "lab2") return v;
  } catch {
    /* ignore */
  }
  return typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
    ? "admin"
    : "user";
}

export function PeachUiModeProvider({
  children,
  labAccess = false,
}: {
  children: React.ReactNode;
  labAccess?: boolean;
}) {
  const [mode, setModeState] = useState<PeachUiMode>("user");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!labAccess) {
      setModeState("user");
      setReady(true);
      return;
    }
    setModeState(readInitial());
    setReady(true);
  }, [labAccess]);

  const setMode = useCallback(
    (m: PeachUiMode) => {
      if (!labAccess) return;
      setModeState(m);
      try {
        localStorage.setItem(STORAGE_KEY, m);
      } catch {
        /* ignore */
      }
    },
    [labAccess],
  );

  const value = useMemo(
    () => ({
      mode,
      setMode,
      isAdmin: labAccess && mode === "admin",
      isLab2: labAccess && mode === "lab2",
      showLabNav: labAccess && (mode === "admin" || mode === "lab2"),
      canLabEdit: labAccess && (mode === "admin" || mode === "lab2"),
      labAccess,
    }),
    [mode, setMode, labAccess],
  );

  if (!ready) {
    return (
      <PeachUiModeContext.Provider value={value}>
        {children}
      </PeachUiModeContext.Provider>
    );
  }

  return (
    <PeachUiModeContext.Provider value={value}>
      {children}
    </PeachUiModeContext.Provider>
  );
}

export function usePeachUiMode() {
  const ctx = useContext(PeachUiModeContext);
  if (!ctx) throw new Error("usePeachUiMode outside provider");
  return ctx;
}
