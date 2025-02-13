export async function* asyncGeneratorFromIterator(asyncIterator) {
  for await (const value of asyncIterator) {
    yield value
  }
}

// Shamelessly stolen from https://github.com/whatwg/streams/issues/1255#issuecomment-2442964298
// This is necessary because AsyncIterators are fickle and if you just wrap them in a try/catch or try to use
// catch/then/finally on a wrapper promise it ultimately generates an unhandled rejection.  JS is so much fun.
export function abortableAsyncIterable(iter, signal = undefined, timeoutMs = undefined) {
  const abortedPromise = new Promise((resolve, reject) => {
    const ABORT_MESSAGE = 'Operation aborted'
    const TIMEOUT_MESSAGE = `Operation exceeded timeout of ${timeoutMs}ms`
    const ABORT_ERROR_NAME = 'AbortError'
    const TIMEOUT_ERROR_NAME = 'TimeoutError'

    let timeoutSignal = undefined
    if (timeoutMs != null) {
      timeoutSignal = AbortSignal.timeout(timeoutMs)
    }

    if (signal?.aborted) {
      reject(new DOMException(ABORT_MESSAGE, ABORT_ERROR_NAME))
    }

    if (timeoutSignal?.aborted) {
      reject(new DOMException(TIMEOUT_MESSAGE, TIMEOUT_ERROR_NAME))
    }

    if (signal != null) {
      signal.addEventListener('abort', () => reject(new DOMException(ABORT_MESSAGE, ABORT_ERROR_NAME)))
    }

    if (timeoutSignal != null) {
      timeoutSignal.addEventListener('abort', () => reject(new DOMException(TIMEOUT_MESSAGE, TIMEOUT_ERROR_NAME)))
    }
  })
  abortedPromise.catch(() => {})

  const abortableIterable = {
    [Symbol.asyncIterator]: () => {
      const inner = iter[Symbol.asyncIterator]()
      const { return: _return, throw: _throw } = inner
      return {
        next: (...args) => Promise.race([inner.next(...args), abortedPromise]),
        return: _return ? (...args) => _return.apply(inner, args) : undefined,
        throw: _throw ? (...args) => _throw.apply(inner, args) : undefined,
      }
    },
  }

  if (Object.prototype.toString.call(iter) === '[object AsyncGenerator]') {
    return asyncGeneratorFromIterator(abortableIterable)
  }

  return abortableIterable
}