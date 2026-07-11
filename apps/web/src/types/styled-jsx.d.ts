import "react";

declare module "react" {
  // The generic parameter must match React's declaration for module augmentation.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface StyleHTMLAttributes<T> {
    jsx?: boolean;
    global?: boolean;
  }
}
