// Keep this public handoff reachable while the Friends tab is protected.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return /^wtw:\/\/(?:\/)?friends\/?$/i.test(path) ? '/friend-invite' : path;
}
