import { createContext, forwardRef, useContext, type PropsWithChildren } from "react";
import {
  Platform, StyleSheet, Text as NativeText, TextInput as NativeTextInput,
  type TextProps, type TextInputProps,
} from "react-native";
import { resolveAppFont, type AppFontSelection } from "../../lib/appFonts";

const FontAvailability = createContext(false);
const InheritedTextFont = createContext<AppFontSelection>({ weight: 400 });
const systemFamily = Platform.OS === "ios" ? "System" : Platform.OS === "web" ? "system-ui" : "sans-serif";

export function AppFontProvider({ loaded, children }: PropsWithChildren<{ loaded: boolean }>) {
  return <FontAvailability.Provider value={loaded}>{children}</FontAvailability.Provider>;
}

export function useAppFontsLoaded() { return useContext(FontAvailability); }

// React 19 JSX는 Text.defaultProps의 기본 style을 적용하지 않아 명시적으로 합성한다.
export const Text = forwardRef<NativeText, TextProps>(function AppText({ style, children, ...props }, ref) {
  const resolved = resolveAppFont(StyleSheet.flatten(style), useAppFontsLoaded(), systemFamily, useContext(InheritedTextFont));
  return <NativeText {...props} ref={ref} style={[style, resolved.style]}>
    <InheritedTextFont.Provider value={resolved.selection}>{children}</InheritedTextFont.Provider>
  </NativeText>;
});
export type Text = NativeText;

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function AppTextInput({ style, ...props }, ref) {
  const resolved = resolveAppFont(StyleSheet.flatten(style), useAppFontsLoaded(), systemFamily);
  return <NativeTextInput {...props} ref={ref} style={[style, resolved.style]} />;
});
export type TextInput = NativeTextInput;
