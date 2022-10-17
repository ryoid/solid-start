import type { Component, JSX } from "solid-js";
import { createMemo, createSignal, onMount, sharedConfig, splitProps, untrack } from "solid-js";
import { isServer } from "solid-js/web";

// not using Suspense
export default function clientOnly<T extends Component<any>>(
  fn: () => Promise<{
    default: T;
  }>
) {
  if (isServer) return (props: T & { fallback?: () => JSX.Element }) => props.fallback;

  const [comp, setComp] = createSignal<T>();
  let p: Promise<{ default: T }> | undefined;
  return (props: T) => {
    let Comp: T | undefined;
    let m: boolean;
    const [, rest] = splitProps(props, ["fallback"]);
    if ((Comp = comp()) && !sharedConfig.context) return Comp(rest);
    (p || (p = fn())).then(m => setComp(() => m.default));
    const [mounted, setMounted] = createSignal(!sharedConfig.context);
    onMount(() => setMounted(true));
    return createMemo(
      () => (Comp = comp()),
      (m = mounted()),
      untrack(() => (Comp && m ? Comp(rest) : props.fallback))
    );
  };
}