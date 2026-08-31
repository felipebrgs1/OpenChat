import type { TokenResponse } from "@nexo/contracts";

const KEY = "nexo.auth";

let memory: TokenResponse | null = null;

function readStorage(): TokenResponse | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as TokenResponse;
  } catch {
    return null;
  }
}

export function getSession() {
  if (!memory) {
    memory = readStorage();
  }
  return memory;
}

export function setSession(next: TokenResponse | null) {
  memory = next;
  if (typeof localStorage === "undefined") {
    return;
  }
  if (next) {
    localStorage.setItem(KEY, JSON.stringify(next));
  } else {
    localStorage.removeItem(KEY);
  }
}

export function clearSession() {
  setSession(null);
}
