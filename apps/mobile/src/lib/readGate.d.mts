export type ReadTicket = { readonly turn: number; readonly epoch: number };
export type ReadVerdict = "apply" | "drop" | "reread";

export type ReadGate = {
  beginRead(): ReadTicket | null;
  endRead(ticket: ReadTicket | null): ReadVerdict;
  beginWrite(): void;
  endWrite(): boolean;
};

export function createReadGate(): ReadGate;
