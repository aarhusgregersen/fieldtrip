import type { AnyFlow } from "@fieldtrip/core";
import { createContext, type ReactNode, useContext } from "react";
import { type FlowController, useFlow, type UseFlowOptions } from "./use-flow.js";

export interface FlowContext<FL extends AnyFlow> {
  readonly FlowProvider: (props: UseFlowOptions<FL> & { readonly children: ReactNode }) => ReactNode;
  readonly useFlowContext: () => FlowController<FL>;
}

// One context per flow, so step components deep in the tree get the flow's own types.
export function createFlowContext<FL extends AnyFlow>(flow: FL): FlowContext<FL> {
  const Context = createContext<FlowController<FL> | null>(null);

  function FlowProvider({ children, ...options }: UseFlowOptions<FL> & { readonly children: ReactNode }) {
    return <Context.Provider value={useFlow(flow, options)}>{children}</Context.Provider>;
  }

  function useFlowContext() {
    const controller = useContext(Context);
    if (!controller) throw new Error("useFlowContext must be used inside its FlowProvider");
    return controller;
  }

  return { FlowProvider, useFlowContext };
}
