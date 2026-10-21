export class ProviderTimeoutError extends Error {
  constructor() {
    super('Places provider timed out');
  }
}

/** Reject even if an injected transport ignores abort. Always remove timer/listener. */
export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms = 3000,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new Error('Places request aborted'));
    };
    if (parent?.aborted) cancel();
    else parent?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([
      interrupted,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('Places request aborted');
        return work(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
  }
}
